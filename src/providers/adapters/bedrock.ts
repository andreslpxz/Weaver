/**
 * Adaptador para AWS Bedrock (Anthropic Claude / Llama / Titan).
 *
 * Mecánica: AWS Bedrock usa SigV4 para firmar las peticiones. En el navegador
 * no podemos firmar con la access key + secret key directamente de forma segura
 * (expondría credenciales), así que:
 *   - En modo Tauri: el frontend pasa las credenciales al backend Rust que firma
 *     la petición (TODO: añadir comando `bedrock_invoke` en Rust).
 *   - En modo navegador: este adaptador pide al usuario que configure un
 *     "Bedrock proxy URL" (un endpoint tipo OpenAI-compat que redirige a Bedrock
 *     con las firmas correctas). Ejemplo: usar `bedrock-proxy` open source.
 *
 * Por ahora este adaptador implementa el modo proxy (OpenAI-compat en una URL
 * configurable). La firma SigV4 nativa en el navegador está pendiente.
 *
 * Configuración necesaria (en Configuración > API Keys > bedrock):
 *   - apiKey: <access_key_id>:<secret_access_key>:<region>  (Tauri)
 *   - o proxy URL (navegador)
 */

import type {
  ChatOptions,
  LLMProvider,
  ModelInfo,
  ProviderInfo,
  StreamChunk,
  ToolCall,
} from '../types';
import { apiKeyStore } from '../store';
import { runtime } from '@/lib/tauri';

export class BedrockProvider implements LLMProvider {
  constructor(public info: ProviderInfo, private apiKey: string | undefined) {}

  async stream(opts: ChatOptions): Promise<AsyncIterable<StreamChunk>> {
    if (!this.apiKey) throw new Error('Bedrock requiere credenciales configuradas');

    // apiKey formato: "<access_key>:<secret>:<region>" o "<proxy_url>" en navegador.
    const parts = this.apiKey.split(':');
    if (parts.length < 3 && runtime.isBrowser) {
      // Asumir proxy URL.
      return this.streamViaProxy(opts, this.apiKey);
    }

    // En Tauri, las credenciales deben ir al backend para firma SigV4.
    if (runtime.isTauri) {
      return this.streamViaTauri(opts);
    }

    throw new Error(
      'Bedrock en navegador requiere un proxy URL. Configura la URL del proxy en API Keys > bedrock, o usa Weaver en modo Tauri para firma SigV4 nativa.',
    );
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.info.models;
  }

  private async *streamViaProxy(opts: ChatOptions, proxyUrl: string): AsyncIterable<StreamChunk> {
    const body = this.buildBody(opts);
    const resp = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey ?? '',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => '');
      throw new Error(`Bedrock proxy ${resp.status}: ${t.slice(0, 200)}`);
    }
    yield* parseOpenAIStream(resp.body, opts.onChunk);
  }

  private async *streamViaTauri(opts: ChatOptions): AsyncIterable<StreamChunk> {
    // TODO: implementar comando Tauri `bedrock_invoke` que firme SigV4 en Rust.
    throw new Error('Bedrock vía Tauri (SigV4 nativo) está pendiente. Usa un proxy URL por ahora.');
  }

  private buildBody(opts: ChatOptions): Record<string, unknown> {
    return {
      model: opts.model,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
    };
  }
}

async function* parseOpenAIStream(
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
        if (data === '[DONE]') {
          for (const tc of toolCalls.values()) yield emit({ type: 'tool_call', tool_call: tc }, onChunk);
          yield emit({ type: 'done' }, onChunk);
          return;
        }
        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) yield emit({ type: 'delta', content: delta.content }, onChunk);
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const ex = toolCalls.get(tc.index) ?? { id: tc.id ?? `call_${tc.index}`, type: 'function', function: { name: '', arguments: '' } };
              if (tc.function?.name) ex.function.name += tc.function.name;
              if (tc.function?.arguments) ex.function.arguments += tc.function.arguments;
              toolCalls.set(tc.index, ex);
            }
          }
        } catch { /* ignore */ }
      }
    }
    yield emit({ type: 'done' }, onChunk);
  } finally {
    reader.releaseLock();
  }
}

function emit<T extends StreamChunk>(chunk: T, onChunk?: (c: StreamChunk) => void): T {
  onChunk?.(chunk);
  return chunk;
}

void apiKeyStore;
