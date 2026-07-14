/**
 * Registry canónico de los 22 proveedores IA soportados por Weaver.
 *
 * Cada entrada incluye: id, label, desc, familia de adaptador, URL base,
 * URL de docs, banderas (noApiKey) y modelos sugeridos.
 *
 * Los modelos son una lista curada, no exhaustiva; los adaptadores pueden
 * ampliarla consultando la API del proveedor cuando el usuario configure su
 * API key.
 */

import type { ProviderId, ProviderInfo } from './types';

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'google',
    label: 'Google Gemini',
    desc: 'Gemini 1.5 Pro / Flash',
    family: 'google-gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    models: [
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', contextWindow: 2_097_152, supportsTools: true, supportsStreaming: true },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', contextWindow: 1_048_576, supportsTools: true, supportsStreaming: true },
      { id: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (exp)', contextWindow: 1_048_576, supportsTools: true, supportsStreaming: true },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', contextWindow: 1_048_576, supportsTools: true, supportsStreaming: true },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', contextWindow: 2_097_152, supportsTools: true, supportsStreaming: true },
    ],
  },
  {
    id: 'cohere',
    label: 'Cohere',
    desc: 'Command R+, Command A (v2 API)',
    family: 'cohere',
    baseUrl: 'https://api.cohere.com/v2',
    docsUrl: 'https://dashboard.cohere.com/api-keys',
    models: [
      { id: 'command-r-plus', label: 'Command R+', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'command-r', label: 'Command R', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'command-a-03-2025', label: 'Command A (v2)', contextWindow: 256_000, supportsTools: true, supportsStreaming: true },
    ],
  },
  {
    id: 'grok',
    label: 'xAI (Grok)',
    desc: 'Grok-1, Grok-2',
    family: 'openai-compat',
    baseUrl: 'https://api.x.ai/v1',
    docsUrl: 'https://x.ai/api',
    models: [
      { id: 'grok-2', label: 'Grok-2', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
      { id: 'grok-2-mini', label: 'Grok-2 mini', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
      { id: 'grok-beta', label: 'Grok-1 (beta)', contextWindow: 131_072, supportsStreaming: true },
    ],
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    desc: 'Sonar models with search',
    family: 'openai-compat',
    baseUrl: 'https://api.perplexity.ai',
    docsUrl: 'https://docs.perplexity.ai',
    models: [
      { id: 'sonar-pro', label: 'Sonar Pro', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
      { id: 'sonar', label: 'Sonar', contextWindow: 127_072, supportsStreaming: true },
      { id: 'sonar-reasoning', label: 'Sonar Reasoning', contextWindow: 127_072, supportsStreaming: true, isReasoning: true },
    ],
  },
  {
    id: 'together',
    label: 'Together AI',
    desc: 'Llama, Qwen, Mistral gateway',
    family: 'openai-compat',
    baseUrl: 'https://api.together.xyz/v1',
    docsUrl: 'https://docs.together.ai',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', label: 'Qwen 2.5 72B', contextWindow: 32_768, supportsTools: true, supportsStreaming: true },
      { id: 'mistralai/Mixtral-8x7B-Instruct-v0.1', label: 'Mixtral 8x7B', contextWindow: 32_768, supportsStreaming: true },
    ],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    desc: 'Fastest Llama-3 inference',
    family: 'openai-compat',
    baseUrl: 'https://api.cerebras.ai/v1',
    docsUrl: 'https://cerebras.ai',
    models: [
      { id: 'llama3.1-8b', label: 'Llama 3.1 8B (Cerebras)', contextWindow: 8_192, supportsStreaming: true },
      { id: 'llama3.1-70b', label: 'Llama 3.1 70B (Cerebras)', contextWindow: 128_000, supportsStreaming: true },
    ],
  },
  {
    id: 'qwen',
    label: 'Qwen (Alibaba)',
    desc: 'Qwen-2.5-72B, Qwen-VL',
    family: 'openai-compat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
    models: [
      { id: 'qwen-plus', label: 'Qwen Plus', contextWindow: 131_072, supportsTools: true, supportsStreaming: true },
      { id: 'qwen-max', label: 'Qwen Max', contextWindow: 32_768, supportsTools: true, supportsStreaming: true },
      { id: 'qwen-turbo', label: 'Qwen Turbo', contextWindow: 1_000_000, supportsStreaming: true },
    ],
  },
  {
    id: 'glm',
    label: 'Zhipu (GLM)',
    desc: 'GLM-4',
    family: 'openai-compat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'glm-4-plus', label: 'GLM-4 Plus', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'glm-4', label: 'GLM-4', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'glm-4-flash', label: 'GLM-4 Flash', contextWindow: 128_000, supportsStreaming: true },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    desc: 'Ultra-fast inference (LPU)',
    family: 'openai-compat',
    baseUrl: 'https://api.groq.com/openai/v1',
    docsUrl: 'https://console.groq.com/keys',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', contextWindow: 32_768, supportsStreaming: true },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    desc: 'GPT-4o, o1, o3…',
    family: 'openai-compat',
    baseUrl: 'https://api.openai.com/v1',
    docsUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'o1', label: 'o1', contextWindow: 200_000, supportsStreaming: true, isReasoning: true },
      { id: 'o3-mini', label: 'o3-mini', contextWindow: 200_000, supportsTools: true, supportsStreaming: true, isReasoning: true },
    ],
  },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    desc: 'GPT-4o, o1, o3 via Azure deployment',
    family: 'openai-compat',
    baseUrl: 'https://{resource}.openai.azure.com/openai',
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o (deployment)', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini (deployment)', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    desc: 'Claude Sonnet / Opus',
    family: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
      { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    desc: 'Multi-model gateway',
    family: 'openai-compat',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/keys',
    models: [
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet (OR)', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
      { id: 'openai/gpt-4o', label: 'GPT-4o (OR)', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'google/gemini-pro-1.5', label: 'Gemini 1.5 Pro (OR)', contextWindow: 2_097_152, supportsStreaming: true },
    ],
  },
  {
    id: 'lightning',
    label: 'Lightning AI',
    desc: 'OpenAI-compatible gateway',
    family: 'openai-compat',
    baseUrl: 'https://api.lightning.ai/v1',
    docsUrl: 'https://lightning.ai/docs/overview/studios',
    models: [
      { id: 'lit-gpt-4o', label: 'Lit GPT-4o', contextWindow: 128_000, supportsStreaming: true },
    ],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    desc: 'NVIDIA hosted models',
    family: 'openai-compat',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    docsUrl: 'https://build.nvidia.com',
    models: [
      { id: 'meta/llama-3.1-70b-instruct', label: 'Llama 3.1 70B (NIM)', contextWindow: 128_000, supportsStreaming: true },
      { id: 'meta/llama-3.1-405b-instruct', label: 'Llama 3.1 405B (NIM)', contextWindow: 128_000, supportsStreaming: true },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    desc: 'DeepSeek-V3 / R1',
    family: 'openai-compat',
    baseUrl: 'https://api.deepseek.com/v1',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3', contextWindow: 64_000, supportsTools: true, supportsStreaming: true },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1', contextWindow: 64_000, supportsStreaming: true, isReasoning: true },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    desc: 'Mixtral, Mistral-Large',
    family: 'openai-compat',
    baseUrl: 'https://api.mistral.ai/v1',
    docsUrl: 'https://console.mistral.ai/api-keys',
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'open-mixtral-8x7b', label: 'Mixtral 8x7B', contextWindow: 32_000, supportsStreaming: true },
      { id: 'mistral-small-latest', label: 'Mistral Small', contextWindow: 32_000, supportsStreaming: true },
    ],
  },
  {
    id: 'meta',
    label: 'Meta (Llama)',
    desc: 'Llama 3.x via API',
    family: 'openai-compat',
    baseUrl: 'https://api.together.xyz/v1', // Meta no expone API propia; vía partners
    docsUrl: 'https://llama.meta.com/get-started',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'meta-llama/Llama-3.1-8B-Instruct', label: 'Llama 3.1 8B', contextWindow: 128_000, supportsStreaming: true },
    ],
  },
  {
    id: 'vertexai',
    label: 'Google Vertex AI',
    desc: 'Claude / Gemini / Llama via Vertex (Bearer token)',
    family: 'vertexai',
    baseUrl: 'https://{LOCATION}-aiplatform.googleapis.com/v1',
    docsUrl: 'https://cloud.google.com/vertex-ai/docs',
    models: [
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro (Vertex)', contextWindow: 2_097_152, supportsTools: true, supportsStreaming: true },
      { id: 'claude-3-5-sonnet@20241022', label: 'Claude 3.5 Sonnet (Vertex)', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
    ],
  },
  {
    id: 'bedrock',
    label: 'Amazon Bedrock',
    desc: 'Claude / Llama / Titan via AWS Bedrock',
    family: 'bedrock',
    baseUrl: 'https://bedrock-runtime.{REGION}.amazonaws.com',
    docsUrl: 'https://docs.aws.amazon.com/bedrock',
    models: [
      { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet (Bedrock)', contextWindow: 200_000, supportsTools: true, supportsStreaming: true },
      { id: 'meta.llama3-1-70b-instruct-v1:0', label: 'Llama 3.1 70B (Bedrock)', contextWindow: 128_000, supportsStreaming: true },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    desc: 'Local models, no API key',
    family: 'ollama',
    baseUrl: 'http://localhost:11434',
    docsUrl: 'https://ollama.com',
    noApiKey: true,
    models: [
      { id: 'llama3.3', label: 'Llama 3.3 (local)', contextWindow: 128_000, supportsTools: true, supportsStreaming: true },
      { id: 'qwen2.5', label: 'Qwen 2.5 (local)', contextWindow: 32_768, supportsStreaming: true },
      { id: 'deepseek-r1', label: 'DeepSeek R1 (local)', contextWindow: 64_000, supportsStreaming: true, isReasoning: true },
    ],
  },
  {
    id: 'huggingface',
    label: 'HuggingFace',
    desc: 'Download & run HF models via Ollama',
    family: 'ollama',
    baseUrl: 'http://localhost:11434',
    docsUrl: 'https://huggingface.co/settings/tokens',
    models: [
      { id: 'hf.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF', label: 'Qwen2.5 Coder 7B (HF)', contextWindow: 32_768, supportsStreaming: true },
    ],
  },
];

export function getProvider(id: ProviderId): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export const DEFAULT_PROVIDER: ProviderId = 'openai';
export const DEFAULT_MODEL = 'gpt-4o-mini';
