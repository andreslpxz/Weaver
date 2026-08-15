/**
 * Adaptador para la familia OpenAI-compatible (POST /v1/chat/completions).
 * Cubre: openai, azure, together, cerebras, groq, nvidia, lightning,
 *        deepseek, openrouter, perplexity, mistral, grok, qwen, glm, meta.
 */

import type {
  ChatOptions,
  LLMProvider,
  ModelInfo,
  ProviderInfo,
  StreamChunk,
  ToolCall,
} from '../types';

interface OpenAIChatChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAICompatProvider implements LLMProvider {
  constructor(public info: ProviderInfo, private apiKey: string | undefined) {}

  async stream(opts: ChatOptions): Promise<AsyncIterable<StreamChunk>> {
    const apiKey = this.apiKey;
    if (!apiKey && !this.info.noApiKey) {
      throw new Error(`Provider ${this.info.id} requiere API key`);
    }

    const url = this.endpoint();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    // OpenRouter pide headers opcionales para attribution.
    if (this.info.id === 'openrouter') {
      headers['HTTP-Referer'] = 'https://weaver.app';
      headers['X-Title'] = 'Weaver';
    }

    const body = this.buildBody(opts);

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${this.info.id} ${resp.status}: ${text.slice(0, 200)}`);
    }

    return this.parseSSE(resp.body, opts.onChunk);
  }

  async listModels(apiKey?: string): Promise<ModelInfo[]> {
    // Si no hay API key, devolver la lista curada.
    if (!apiKey && !this.info.noApiKey) return this.info.models;
    // Algunos proveedores exponen GET /v1/models.
    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const url = `${this.info.baseUrl}/models`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) return this.info.models;
      const json = (await resp.json()) as { data?: Array<{ id: string }> };
      const remote = (json.data ?? []).map((m) => ({
        id: m.id,
        label: m.id,
        contextWindow: 128_000,
        supportsStreaming: true,
      }));
      // Merge: preferir los curados (con label amable) pero añadir los remotos.
      const known = new Set(this.info.models.map((m) => m.id));
      return [...this.info.models, ...remote.filter((m) => !known.has(m.id))];
    } catch {
      return this.info.models;
    }
  }

  // ---------------------------------------------------------------------------

  private endpoint(): string {
    if (this.info.id === 'azure') {
      // Azure usa /deployments/{deployment}/chat/completions?api-version=...
      // El "model" se interpreta como deployment name.
      throw new Error('Azure endpoint requiere configuración de resource+deployment (TODO)');
    }
    return `${this.info.baseUrl}/chat/completions`;
  }

  private buildBody(opts: ChatOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages.map((m) => {
        // Multimodal: si el mensaje tiene imágenes, enviar content como array.
        if (m.images && m.images.length > 0 && (m.role === 'user' || m.role === 'assistant')) {
          const content: unknown[] = [];
          if (m.content) content.push({ type: 'text', text: m.content });
          for (const img of m.images) {
            content.push({
              type: 'image_url',
              image_url: { url: img.dataUrl, detail: 'auto' },
            });
          }
          return { role: m.role, content };
        }
        return {
          role: m.role,
          content: m.content,
          ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
          ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        };
      }),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (opts.temperature !== undefined) body['temperature'] = opts.temperature;
    if (opts.maxTokens !== undefined) body['max_tokens'] = opts.maxTokens;
    if (opts.tools && opts.tools.length > 0) {
      body['tools'] = opts.tools;
    }
    return body;
  }

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
          if (!line || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') {
            // Emitir tool_calls acumulados.
            for (const tc of toolCalls.values()) {
              yield emit({ type: 'tool_call', tool_call: tc }, onChunk);
            }
            yield emit({ type: 'done' }, onChunk);
            return;
          }
          try {
            const chunk = JSON.parse(data) as OpenAIChatChunk;
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              yield emit({ type: 'delta', content: delta.content }, onChunk);
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing =
                  toolCalls.get(tc.index) ??
                  {
                    id: tc.id ?? `call_${tc.index}`,
                    type: 'function' as const,
                    function: { name: '', arguments: '' },
                  };
                if (tc.function?.name) existing.function.name += tc.function.name;
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
                toolCalls.set(tc.index, existing);
              }
            }
            if (chunk.usage) {
              yield emit(
                {
                  type: 'usage',
                  input_tokens: chunk.usage.prompt_tokens ?? 0,
                  output_tokens: chunk.usage.completion_tokens ?? 0,
                },
                onChunk,
              );
            }
          } catch {
            // ignore parse errors
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
