/**
 * Stream + encadenamiento automático para superar el límite de output
 * del LLM (típicamente 8,192 tokens ≈ 6,000 palabras).
 *
 * Mecánica de encadenamiento:
 *   1. El system prompt pide al modelo emitir `<<CONTINUE>>` al final si
 *      necesita más espacio, y `<<END>>` cuando termine.
 *   2. `streamChat()` emite los deltas en vivo al callback `onDelta`, PERO
 *      filtra cualquier ocurrencia de los marcadores (no llegan al usuario).
 *   3. Si tras cerrar el stream quedó un `<<CONTINUE>>` pendiente, se lanza
 *      una nueva inferencia con un mensaje usuario pidiendo continuar.
 *   4. `streamUntilDone()` orquesta todo y devuelve el texto final limpio.
 *
 * Los marcadores NUNCA se muestran al usuario.
 */

import type { LLMProvider, Message, Tool } from '@/providers/types';

export const CONTINUE_MARKER = '<<CONTINUE>>';
export const END_MARKER = '<<END>>';

export interface StreamResult {
  text: string;
  reasoning?: string;
  toolCalls: import('@/providers/types').ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  /** True si el modelo emitió <<CONTINUE>> (necesita más espacio). */
  needsContinue: boolean;
  /** True si el modelo emitió <<END>> (terminó). */
  ended: boolean;
}

class ThinkTagStreamFilter {
  private inThink = false;
  private buffer = '';

  constructor(
    private onContent: (text: string) => void,
    private onReasoning: (text: string) => void,
  ) {}

  feed(text: string) {
    this.buffer += text;
    this.processBuffer();
  }

  flush() {
    if (this.buffer) {
      if (this.inThink) {
        this.onReasoning(this.buffer);
      } else {
        this.onContent(this.buffer);
      }
      this.buffer = '';
    }
  }

  private processBuffer() {
    while (this.buffer.length > 0) {
      if (!this.inThink) {
        const startIdx = this.buffer.indexOf('<think>');
        if (startIdx !== -1) {
          const content = this.buffer.slice(0, startIdx);
          if (content) this.onContent(content);
          this.buffer = this.buffer.slice(startIdx + 7);
          this.inThink = true;
          continue;
        }
        let partialMatch = 0;
        for (let i = 1; i < 7 && i <= this.buffer.length; i++) {
          if ('<think>'.startsWith(this.buffer.slice(-i))) {
            partialMatch = i;
            break;
          }
        }
        if (partialMatch > 0) {
          const safeContent = this.buffer.slice(0, this.buffer.length - partialMatch);
          if (safeContent) this.onContent(safeContent);
          this.buffer = this.buffer.slice(this.buffer.length - partialMatch);
          break;
        }
        this.onContent(this.buffer);
        this.buffer = '';
      } else {
        const endIdx = this.buffer.indexOf('</think>');
        if (endIdx !== -1) {
          const reasoning = this.buffer.slice(0, endIdx);
          if (reasoning) this.onReasoning(reasoning);
          this.buffer = this.buffer.slice(endIdx + 8);
          this.inThink = false;
          continue;
        }
        let partialMatch = 0;
        for (let i = 1; i < 8 && i <= this.buffer.length; i++) {
          if ('</think>'.startsWith(this.buffer.slice(-i))) {
            partialMatch = i;
            break;
          }
        }
        if (partialMatch > 0) {
          const safeReasoning = this.buffer.slice(0, this.buffer.length - partialMatch);
          if (safeReasoning) this.onReasoning(safeReasoning);
          this.buffer = this.buffer.slice(this.buffer.length - partialMatch);
          break;
        }
        this.onReasoning(this.buffer);
        this.buffer = '';
      }
    }
  }
}

/** Quita todos los marcadores de encadenamiento de un texto. */
export function stripMarkers(text: string): string {
  return text
    .replace(/<<CONTINUE>>/g, '')
    .replace(/<<END>>/g, '')
    .replace(/\s*;\s*$/m, '') // limpiar punto y coma suelto que a veces queda
}

/** Stream estándar (sin auto-encadenamiento). Filtra marcadores. */
export async function streamChat(
  provider: LLMProvider,
  model: string,
  messages: Message[],
  opts: {
    tools?: Tool[];
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
    onReasoningDelta?: (reasoningDelta: string) => void;
  } = {},
): Promise<StreamResult> {
  let rawText = '';
  let rawReasoning = '';
  const toolCalls: StreamResult['toolCalls'] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };

  let pending = '';

  const thinkFilter = new ThinkTagStreamFilter(
    (content) => {
      pending += content;
      const { emit, keep } = splitSafe(pending);
      if (emit) opts.onDelta?.(emit);
      rawText += emit;
      pending = keep;
    },
    (reasoning) => {
      rawReasoning += reasoning;
      opts.onReasoningDelta?.(reasoning);
    },
  );

  const iter = await provider.stream({
    model,
    messages,
    tools: opts.tools,
    signal: opts.signal,
  });

  for await (const chunk of iter) {
    if (chunk.type === 'reasoning_delta' && chunk.content) {
      rawReasoning += chunk.content;
      opts.onReasoningDelta?.(chunk.content);
    }
    if (chunk.type === 'delta' && chunk.content) {
      thinkFilter.feed(chunk.content);
    }
    if (chunk.type === 'tool_call') toolCalls.push(chunk.tool_call);
    if (chunk.type === 'usage') {
      usage = { inputTokens: chunk.input_tokens, outputTokens: chunk.output_tokens };
    }
  }

  thinkFilter.flush();

  // Flush final: cualquier cosa que quede en pending y NO sea marcador se emite.
  // Si es marcador (parcial o completo), se descarta.
  const remaining = pending.replace(/<<CONTINUE>>/g, '').replace(/<<END>>/g, '');
  if (remaining) {
    opts.onDelta?.(remaining);
    rawText += remaining;
  }
  rawText = stripMarkers(rawText);

  return {
    text: rawText,
    reasoning: rawReasoning || undefined,
    toolCalls,
    usage,
    needsContinue: pending.includes('CONTINUE') || rawText === '' && toolCalls.length === 0 && messages.length > 1,
    ended: pending.includes('END') || pending.includes('<<END>>'),
  };
}

/**
 * Divide `pending` en dos partes:
 *   - `emit`: texto seguro para mostrar (sin marcadores parciales al final)
 *   - `keep`: sufijo que podría ser inicio de un marcador (retener hasta próximo chunk)
 *
 * Lógica:
 *   1. Quita marcadores completos `<<CONTINUE>>` y `<<END>>`.
 *   2. Si el sufijo termina con un prefijo de algún marcador, lo retiene.
 */
function splitSafe(pending: string): { emit: string; keep: string } {
  let s = pending;
  // Quitar marcadores completos.
  s = s.replace(/<<CONTINUE>>/g, '').replace(/<<END>>/g, '');

  // Buscar el sufijo más largo que sea prefijo de un marcador.
  const markers = ['<<CONTINUE>>', '<<END>>'];
  let keepLen = 0;
  for (const m of markers) {
    for (let len = Math.min(s.length, m.length - 1); len > 0; len--) {
      if (s.endsWith(m.slice(0, len))) {
        keepLen = Math.max(keepLen, len);
        break;
      }
    }
  }

  if (keepLen === 0) return { emit: s, keep: '' };
  return { emit: s.slice(0, s.length - keepLen), keep: s.slice(s.length - keepLen) };
}

/**
 * Stream con encadenamiento automático hasta `<<END>>` o sin marcador.
 * Filtra TODOS los marcadores del texto final que ve el usuario.
 */
export async function streamUntilDone(
  provider: LLMProvider,
  model: string,
  messages: Message[],
  opts: {
    maxChains?: number;
    tools?: Tool[];
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
  } = {},
): Promise<string> {
  const maxChains = opts.maxChains ?? 5;
  let fullText = '';
  let convo = [...messages];

  for (let chain = 0; chain < maxChains; chain++) {
    const result = await streamChat(provider, model, convo, {
      tools: opts.tools,
      signal: opts.signal,
      onDelta: opts.onDelta,
    });

    fullText += result.text;

    if (result.ended || !result.needsContinue) {
      return fullText;
    }

    // Continuar: pedimos al modelo seguir desde donde se quedó.
    convo = [
      ...convo,
      {
        role: 'assistant',
        content: result.text + '\n' + CONTINUE_MARKER,
      },
      {
        role: 'user',
        content:
          'Continúa tu respuesta anterior exactamente desde donde la dejaste. No repitas lo ya dicho. Si terminaste, emite <<END>>.',
      },
    ];
  }

  return fullText;
}
