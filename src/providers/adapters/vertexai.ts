/**
 * Adaptador para Google Vertex AI.
 *
 * Vertex AI expone Gemini, Claude (vía partner) y Llama con autenticación
 * OAuth2 (Bearer token). En el navegador esto se traduce en:
 *   - El usuario pega su access token (gcloud auth print-access-token) en
 *     Configuración > API Keys > vertexai.
 *   - El token dura ~1h; debe refrescarse manualmente.
 *
 * En modo Tauri: TODO añadir comando `vertexai_invoke` que use Application Default
 * Credentials para refrescar automáticamente.
 *
 * Modelos soportados:
 *   - Gemini: /v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent
 *   - Claude: /v1/projects/{project}/locations/{location}/publishers/anthropic/models/{model}:streamRawPredict
 *
 * El apiKey formato esperado: "<access_token>:<project_id>:<location>"
 */

import type {
  ChatOptions,
  LLMProvider,
  ModelInfo,
  ProviderInfo,
  StreamChunk,
} from '../types';

export class VertexAIProvider implements LLMProvider {
  constructor(public info: ProviderInfo, private apiKey: string | undefined) {}

  async stream(opts: ChatOptions): Promise<AsyncIterable<StreamChunk>> {
    if (!this.apiKey) throw new Error('VertexAI requiere access token configurado');
    const parts = this.apiKey.split(':');
    if (parts.length < 3) {
      throw new Error(
        'Formato esperado para VertexAI: <access_token>:<project_id>:<location>\n' +
          'Ej: ya29.xxx:my-project-123:us-central1\n' +
          'Obtén el token con: gcloud auth print-access-token',
      );
    }
    const [token, project, location] = parts;

    // Detectar tipo de modelo por el ID.
    const model = opts.model.toLowerCase();
    if (model.startsWith('gemini')) {
      return this.streamGemini(opts, token, project, location);
    }
    if (model.includes('claude')) {
      return this.streamClaude(opts, token, project, location);
    }
    throw new Error(`Modelo no soportado en VertexAI: ${opts.model}`);
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.info.models;
  }

  private async *streamGemini(
    opts: ChatOptions,
    token: string,
    project: string,
    location: string,
  ): AsyncIterable<StreamChunk> {
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`;
    const body = {
      contents: opts.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
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
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => '');
      throw new Error(`VertexAI Gemini ${resp.status}: ${t.slice(0, 200)}`);
    }

    const reader = resp.body.getReader();
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
              const chunk: StreamChunk = { type: 'delta', content: text };
              opts.onChunk?.(chunk);
              yield chunk;
            }
          } catch { /* ignore */ }
        }
      }
      const done: StreamChunk = { type: 'done' };
      opts.onChunk?.(done);
      yield done;
    } finally {
      reader.releaseLock();
    }
  }

  private async *streamClaude(
    opts: ChatOptions,
    token: string,
    project: string,
    location: string,
  ): AsyncIterable<StreamChunk> {
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/anthropic/models/${encodeURIComponent(opts.model)}:streamRawPredict`;
    const body = {
      anthropic_version: 'vertex-2023-10-16',
      messages: opts.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content })),
      system: opts.messages.find((m) => m.role === 'system')?.content,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
    };
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!resp.ok || !resp.body) {
      const t = await resp.text().catch(() => '');
      throw new Error(`VertexAI Claude ${resp.status}: ${t.slice(0, 200)}`);
    }

    const reader = resp.body.getReader();
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
            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
              const chunk: StreamChunk = { type: 'delta', content: ev.delta.text };
              opts.onChunk?.(chunk);
              yield chunk;
            } else if (ev.type === 'message_stop') {
              const done: StreamChunk = { type: 'done' };
              opts.onChunk?.(done);
              yield done;
              return;
            }
          } catch { /* ignore */ }
        }
      }
      const done: StreamChunk = { type: 'done' };
      opts.onChunk?.(done);
      yield done;
    } finally {
      reader.releaseLock();
    }
  }
}
