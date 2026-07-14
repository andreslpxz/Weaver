/**
 * Adaptador para Google Gemini API.
 * Cubre: google (Gemini).
 */

import type {
  ChatOptions,
  LLMProvider,
  ModelInfo,
  ProviderInfo,
  StreamChunk,
} from '../types';

export class GeminiProvider implements LLMProvider {
  constructor(public info: ProviderInfo, private apiKey: string | undefined) {}

  async stream(opts: ChatOptions): Promise<AsyncIterable<StreamChunk>> {
    if (!this.apiKey) throw new Error('Google Gemini requiere API key');

    const url = `${this.info.baseUrl}/v1beta/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse&key=${this.apiKey}`;
    const body = {
      contents: opts.messages
        .filter((m) => m.role !== 'system')
        .map((m) => {
          // Multimodal: Gemini usa parts con inline_data para imágenes.
          const parts: unknown[] = [];
          if (m.content) parts.push({ text: m.content });
          if (m.images) {
            for (const img of m.images) {
              const base64 = img.dataUrl.split(',')[1] ?? '';
              parts.push({
                inline_data: {
                  mime_type: img.mime,
                  data: base64,
                },
              });
            }
          }
          return {
            role: m.role === 'assistant' ? 'model' : 'user',
            parts,
          };
        }),
      systemInstruction: opts.messages.find((m) => m.role === 'system')?.content
        ? { parts: [{ text: opts.messages.find((m) => m.role === 'system')!.content }] }
        : undefined,
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        maxOutputTokens: opts.maxTokens ?? 8192,
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
      throw new Error(`Gemini ${resp.status}: ${text.slice(0, 200)}`);
    }
    return this.parseSSE(resp.body, opts.onChunk);
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.info.models;
  }

  private async *parseSSE(
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
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          try {
            const ev = JSON.parse(data);
            const text = ev?.candidates?.[0]?.content?.parts
              ?.map((p: { text?: string }) => p.text ?? '')
              .join('');
            if (text) {
              yield emit({ type: 'delta', content: text }, onChunk);
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
