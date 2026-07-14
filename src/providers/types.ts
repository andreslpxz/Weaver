/**
 * Tipos compartidos del sistema de proveedores IA.
 */

export type ProviderId =
  | 'google' | 'cohere' | 'grok' | 'perplexity'
  | 'together' | 'cerebras' | 'qwen' | 'glm' | 'groq'
  | 'openai' | 'azure' | 'anthropic'
  | 'openrouter' | 'lightning' | 'nvidia'
  | 'deepseek' | 'mistral' | 'meta'
  | 'vertexai' | 'bedrock'
  | 'ollama' | 'huggingface';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  desc: string;
  /** Familia de adaptador a usar. */
  family:
    | 'openai-compat' // POST /v1/chat/completions
    | 'anthropic'     // POST /v1/messages
    | 'google-gemini' // POST /v1beta/models/{model}:streamGenerateContent
    | 'cohere'        // POST /v2/chat
    | 'ollama'        // POST /api/chat
    | 'vertexai'      // POST /v1/projects/.../publishers/.../models
    | 'bedrock';      // POST /model/{model}/invoke (AWS SigV4)
  /** URL base por defecto del proveedor. */
  baseUrl: string;
  /** URL de docs para obtener API key. */
  docsUrl: string;
  /** Si true, el proveedor NO requiere API key (ej. Ollama local). */
  noApiKey?: boolean;
  /** Models sugeridos (pueden ampliarse vía API). */
  models: ModelInfo[];
}

export interface ModelInfo {
  id: string;       // ID a pasar al API (ej. "gpt-4o-mini")
  label: string;    // Etiqueta legible (ej. "GPT-4o mini")
  contextWindow: number; // tokens
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  isReasoning?: boolean;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AttachmentRef {
  id: string;
  name: string;
  kind: 'text' | 'image' | 'binary';
  size: number;
  mime: string;
  truncated?: boolean;
}

/** Imagen embebida como data URL base64 (multimodal real). */
export interface ImageContent {
  /** Data URL completa: "data:image/png;base64,iVBOR..." */
  dataUrl: string;
  /** MIME: image/png | image/jpeg | image/gif | image/webp */
  mime: string;
  /** Nombre original del archivo (para logging/debug). */
  name: string;
}

export interface Message {
  role: MessageRole;
  /** Content del mensaje. Puede ser null cuando el asistente hace tool_calls
   *  (algunos proveedores como OpenAI requieren null explícito, no string vacío). */
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  /** Referencias a adjuntos (no el contenido crudo, que vive en attachments[]) */
  attachments?: AttachmentRef[];
  /** Imágenes embebidas para modelos multimodales (GPT-4o, Gemini, Claude). */
  images?: ImageContent[];
  /** Razonamiento/chain-of-thought mostrado colapsable. */
  reasoning?: string;
  /** ID único del mensaje (para copy/regenerate). */
  id?: string;
  /** Marca de tiempo. */
  ts?: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type StreamChunk =
  | { type: 'delta'; content: string }
  | { type: 'tool_call'; tool_call: ToolCall }
  | { type: 'usage'; input_tokens: number; output_tokens: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ChatOptions {
  model: string;
  messages: Message[];
  tools?: Tool[];
  temperature?: number;
  maxTokens?: number;
  /** AbortSignal para cancelar el stream. */
  signal?: AbortSignal;
  /** Callback invocado en cada chunk delta. */
  onChunk?: (chunk: StreamChunk) => void;
}

export interface LLMProvider {
  info: ProviderInfo;
  /** Crea un stream de chat. Devuelve un async iterable de chunks. */
  stream(opts: ChatOptions): Promise<AsyncIterable<StreamChunk>>;
  /** Lista los modelos disponibles para este proveedor (con API key si aplica). */
  listModels(apiKey?: string): Promise<ModelInfo[]>;
}
