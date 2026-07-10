/**
 * Utilidades de streaming con encadenamiento automático.
 *
 * Encadenamiento: el sistema está diseñado para superar el límite de output
 * del LLM (típicamente 8,192 tokens ≈ 6,000 palabras). Cuando el LLM emite
 * el marcador `<<CONTINUE>>`, el frontend reenvía con un mensaje usuario
 * pidiendo continuar, y concatena los fragmentos.
 *
 * Esto funciona con cualquier proveedor (OpenAI-compat, Anthropic, Gemini,
 * Ollama) porque opera sobre el contenido delta, no sobre APIs específicas.
 */

import type { LLMProvider, Message, StreamChunk } from '@/providers/types';
import { CONTINUE_MARKER, END_MARKER } from '@/agent/types';

export interface StreamResult {
  text: string;
  toolCalls: StreamChunk extends never ? never : Extract<StreamChunk, { type: 'tool_call' }>['tool_call'][];
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * Stream estándar (sin encadenamiento). Devuelve todo el texto + tool calls.
 */
export async function streamChat(
  provider: LLMProvider,
  model: string,
  messages: Message[],
  opts: { tools?: LLMProvider extends never ? never : Parameters<LLMProvider['stream']>[0]['tools']; signal?: AbortSignal; onDelta?: (delta: string) => void } = {},
): Promise<StreamResult> {
  let text = '';
  const toolCalls: StreamResult['toolCalls'] = [];
  let usage = { inputTokens: 0, outputTokens: 0 };

  const iter = await provider.stream({
    model,
    messages,
    tools: opts.tools as any,
    signal: opts.signal,
    onChunk: (c) => {
      if (c.type === 'delta' && c.content) opts.onDelta?.(c.content);
      if (c.type === 'usage') usage = { inputTokens: c.input_tokens, outputTokens: c.output_tokens };
    },
  });

  for await (const chunk of iter) {
    if (chunk.type === 'delta' && chunk.content) text += chunk.content;
    if (chunk.type === 'tool_call') toolCalls.push(chunk.tool_call);
    if (chunk.type === 'usage') usage = { inputTokens: chunk.input_tokens, outputTokens: chunk.output_tokens };
  }

  return { text, toolCalls, usage };
}

/**
 * Stream con encadenamiento automático hasta que el LLM emita `<<END>>`
 * o no haya más contenido (sin marcador de continue).
 */
export async function streamUntilDone(
  provider: LLMProvider,
  model: string,
  messages: Message[],
  opts: { maxChains?: number; tools?: Parameters<LLMProvider['stream']>[0]['tools']; signal?: AbortSignal; onDelta?: (delta: string) => void } = {},
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
    let chunk = result.text;

    // Detectar marcadores.
    const continueIdx = chunk.lastIndexOf(CONTINUE_MARKER);
    const endIdx = chunk.lastIndexOf(END_MARKER);

    if (endIdx >= 0) {
      fullText += chunk.slice(0, endIdx);
      return fullText;
    }

    if (continueIdx >= 0) {
      const before = chunk.slice(0, continueIdx);
      fullText += before;
      // Reenviar pidiendo continuar.
      convo = [
        ...convo,
        { role: 'assistant', content: before + '\n' + CONTINUE_MARKER },
        {
          role: 'user',
          content:
            'Continúa tu respuesta anterior exactamente desde donde la dejaste. No repitas lo ya dicho. Si terminaste, emite <<END>>.',
        },
      ];
      continue;
    }

    // Sin marcador: asumir que terminó.
    fullText += chunk;
    return fullText;
  }

  // Si llegamos al límite de cadenas, devolver lo acumulado.
  return fullText;
}
