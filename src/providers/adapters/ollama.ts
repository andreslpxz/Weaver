/**
 * Adaptador para Ollama local (POST /api/chat con NDJSON streaming).
 * Cubre: ollama, huggingface (vía Ollama).
 */

import type {
  ChatOptions,
  LLMProvider,
  ModelInfo,
  ProviderInfo,
  StreamChunk,
} from '../types';

export class OllamaProvider implements LLMProvider {
  constructor(public info: ProviderInfo) {}

  async stream(opts: ChatOptions): Promise<AsyncIterable<StreamChunk>> {
    const url = `${this.info.baseUrl}/api/chat`;
    const body = {
      model: opts.model,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      options: {
        temperature: opts.temperature ?? 0.7,
        num_predict: opts.maxTokens ?? 8192,
      },
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Ollama ${resp.status}: ${text.slice(0, 200)}`);
    }
    return this.parseNDJSON(resp.body, opts.onChunk);
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const resp = await fetch(`${this.info.baseUrl}/api/tags`);
      if (!resp.ok) return this.info.models;
      const json = (await resp.json()) as { models?: Array<{ name: string; details?: { parameter_size?: string } }> };
      return (json.models ?? []).map((m) => ({
        id: m.name,
        label: m.name,
        contextWindow: 128_000,
        supportsStreaming: true,
      }));
    } catch {
      return this.info.models;
    }
  }

  private async *parseNDJSON(
    body: ReadableStream<Uint8Array>,
    onChunk?: (c: StreamChunk) => void,
  ): AsyncIterable<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev?.message?.content) {
              yield emit({ type: 'delta', content: ev.message.content }, onChunk);
            }
            if (ev?.done) {
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
