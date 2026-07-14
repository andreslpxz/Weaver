/**
 * Adaptador para Anthropic Messages API.
 * Cubre: anthropic. (Bedrock y VertexAI tienen sus propios adapters TBD.)
 */

import type {
  ChatOptions,
  LLMProvider,
  ModelInfo,
  ProviderInfo,
  StreamChunk,
  ToolCall,
} from '../types';

interface AnthropicEvent {
  type: string;
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
  content_block?: { type: string; id?: string; name?: string };
  index?: number;
}

export class AnthropicProvider implements LLMProvider {
  constructor(public info: ProviderInfo, private apiKey: string | undefined) {}

  async stream(opts: ChatOptions): Promise<AsyncIterable<StreamChunk>> {
    if (!this.apiKey) throw new Error('Anthropic requiere API key');

    // Multimodal: convertir mensajes con imágenes al formato Anthropic.
    const body = {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4096,
      messages: opts.messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          if (m.images && m.images.length > 0 && m.role === 'user') {
            const content: unknown[] = [];
            if (m.content) content.push({ type: 'text', text: m.content });
            for (const img of m.images) {
              // Anthropic espera: { type: 'image', source: { type: 'base64', media_type, data } }
              const base64 = img.dataUrl.split(',')[1] ?? '';
              content.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: img.mime,
                  data: base64,
                },
              });
            }
            return { role: m.role, content };
          }
          return { role: m.role, content: m.content };
        }),
      system: opts.messages.find((m) => m.role === 'system')?.content,
      stream: true,
      ...(opts.tools && opts.tools.length > 0
        ? { tools: opts.tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) }
        : {}),
    };

    const resp = await fetch(`${this.info.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Anthropic ${resp.status}: ${text.slice(0, 200)}`);
    }
    return this.parseSSE(resp.body, opts.onChunk);
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.info.models;
  }

  // ---------------------------------------------------------------------------

  private async *parseSSE(
    body: ReadableStream<Uint8Array>,
    onChunk?: (c: StreamChunk) => void,
  ): AsyncIterable<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls: Map<number, ToolCall> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          try {
            const ev = JSON.parse(data) as AnthropicEvent;
            if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
              const idx = ev.index ?? 0;
              toolCalls.set(idx, {
                id: ev.content_block.id ?? `call_${idx}`,
                type: 'function',
                function: { name: ev.content_block.name ?? '', arguments: '' },
              });
            } else if (ev.type === 'content_block_delta') {
              if (ev.delta?.type === 'text_delta' && ev.delta.text) {
                yield emit({ type: 'delta', content: ev.delta.text }, onChunk);
              } else if (ev.delta?.type === 'input_json_delta' && ev.delta.partial_json) {
                const idx = ev.index ?? 0;
                const tc = toolCalls.get(idx);
                if (tc) tc.function.arguments += ev.delta.partial_json;
              }
            } else if (ev.type === 'message_start' || ev.type === 'message_delta') {
              const u = ev.message?.usage ?? ev.usage;
              if (u) {
                yield emit(
                  { type: 'usage', input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 },
                  onChunk,
                );
              }
            } else if (ev.type === 'message_stop') {
              for (const tc of toolCalls.values()) {
                yield emit({ type: 'tool_call', tool_call: tc }, onChunk);
              }
              yield emit({ type: 'done' }, onChunk);
              return;
            }
          } catch {
            // ignore
          }
        }
      }
      yield emit({ type: 'done' }, onChunk);
    } finally {
      reader.releaseLock();
    }
  }
}

function emit<T extends StreamChunk>(chunk: T, onChunk?: (c: StreamChunk) => void): T {
  onChunk?.(chunk);
  return chunk;
}
