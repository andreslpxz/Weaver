/**
 * Fetch individual de modelos por proveedor usando la API key del usuario.
 *
 * Cada proveedor expone GET /v1/models (o similar) que devuelve la lista
 * de modelos disponibles para esa API key. Esto es útil cuando el usuario
 * quiere usar sus keys directas en vez de OpenRouter.
 *
 * Endpoints por proveedor:
 * - OpenAI:       GET https://api.openai.com/v1/models
 * - OpenRouter:   GET https://openrouter.ai/api/v1/models (público, ver openrouter-models.ts)
 * - Groq:         GET https://api.groq.com/openai/v1/models
 * - Together AI:  GET https://api.together.xyz/v1/models
 * - Anthropic:    GET https://api.anthropic.com/v1/models (header especial)
 * - Google Gemini:GET https://generativelanguage.googleapis.com/v1beta/models?key=KEY
 * - Cohere:       GET https://api.cohere.com/v1/models
 * - Mistral:      GET https://api.mistral.ai/v1/models
 * - DeepSeek:     GET https://api.deepseek.com/models (sin /v1!)
 * - xAI/Grok:     GET https://api.x.ai/v1/models
 * - Perplexity:   GET https://api.perplexity.ai/v1/models
 * - Cerebras:     GET https://api.cerebras.ai/v1/models (o /public/v1/models sin key)
 */

import type { ModelInfo, ProviderId } from './types';
import { PROVIDERS } from './registry';
import { apiKeyStore } from './store';

/**
 * Obtiene la lista de modelos de un proveedor usando su API key.
 *
 * Fusiona los modelos curados del registry con los que devuelve la API
 * del proveedor. Los modelos remotos tienen prioridad (más actualizados).
 */
export async function fetchProviderModels(
  providerId: ProviderId,
  opts?: { signal?: AbortSignal },
): Promise<ModelInfo[]> {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return [];

  // Para OpenRouter, usar el módulo dedicado (público, sin key).
  if (providerId === 'openrouter') {
    const { fetchOpenRouterModels } = await import('./openrouter-models');
    return fetchOpenRouterModels({ signal: opts?.signal });
  }

  // Para Ollama, usar el endpoint local sin auth.
  if (providerId === 'ollama') {
    return fetchOllamaModels(provider.baseUrl, opts?.signal);
  }

  // Para Cerebras, intentar el endpoint público primero.
  if (providerId === 'cerebras') {
    return fetchCerebrasModels(opts?.signal);
  }

  // Para el resto, necesitamos API key.
  const apiKey = await apiKeyStore.get(providerId);
  if (!apiKey) {
    // Sin key, devolver solo los modelos curados del registry.
    return provider.models;
  }

  try {
    const remoteModels = await fetchModelsForProvider(providerId, provider.baseUrl, apiKey, opts?.signal);
    // Fusionar: los remotos tienen prioridad, pero mantener los curados
    // que no estén en la lista remota (por si la API no los devuelve todos).
    const remoteIds = new Set(remoteModels.map((m) => m.id));
    const curated = provider.models.filter((m) => !remoteIds.has(m.id));
    return [...remoteModels, ...curated];
  } catch (e) {
    console.warn(`[provider-models] fetch falló para ${providerId}:`, e);
    // Si falla, devolver los modelos curados.
    return provider.models;
  }
}

// ============================================================================
// Fetchers por proveedor
// ============================================================================

/** OpenAI-compatible: GET {baseUrl}/v1/models con Bearer token. */
async function fetchOpenAICompat(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  const resp = await fetch(`${baseUrl}/v1/models`, {
    signal,
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const json = (await resp.json()) as { data?: Array<{ id: string; owned_by?: string }> };
  return (json.data ?? []).map((m) => ({
    id: m.id,
    label: m.id,
    contextWindow: 128_000, // OpenAI no devuelve context en este endpoint.
    supportsStreaming: true,
    sourceProvider: m.owned_by,
  }));
}

/** Anthropic: headers especiales (x-api-key + anthropic-version). */
async function fetchAnthropicModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const resp = await fetch('https://api.anthropic.com/v1/models', {
    signal,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const json = (await resp.json()) as { data?: Array<{ id: string; display_name?: string }> };
  return (json.data ?? []).map((m) => ({
    id: m.id,
    label: m.display_name || m.id,
    contextWindow: 200_000, // Anthropic no devuelve context en este endpoint.
    supportsTools: true,
    supportsStreaming: true,
  }));
}

/** Google Gemini: API key como query param, formato propio. */
async function fetchGeminiModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    { signal },
  );
  if (!resp.ok) throw new Error(`${resp.status}`);
  const json = (await resp.json()) as {
    models?: Array<{
      name: string; // "models/gemini-2.0-flash"
      displayName?: string;
      inputTokenLimit?: number;
      outputTokenLimit?: number;
      supportedGenerationMethods?: string[];
    }>;
  };
  return (json.models ?? []).map((m) => ({
    id: m.name.replace('models/', ''),
    label: m.displayName || m.name,
    contextWindow: m.inputTokenLimit ?? 1_000_000,
    supportsTools: m.supportedGenerationMethods?.includes('generateContent') ?? true,
    supportsStreaming: true,
  }));
}

/** Cohere: formato propio con endpoints y context_length. */
async function fetchCohereModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const resp = await fetch('https://api.cohere.com/v1/models', {
    signal,
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const json = (await resp.json()) as {
    models?: Array<{
      name: string;
      endpoints?: string[];
      context_length?: number;
      token_limit?: number;
    }>;
  };
  return (json.models ?? [])
    .filter((m) => m.endpoints?.includes('chat'))
    .map((m) => ({
      id: m.name,
      label: m.name,
      contextWindow: m.context_length ?? m.token_limit ?? 128_000,
      supportsTools: true,
      supportsStreaming: true,
    }));
}

/** DeepSeek: sin /v1 en el path. */
async function fetchDeepSeekModels(apiKey: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const resp = await fetch('https://api.deepseek.com/models', {
    signal,
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const json = (await resp.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => ({
    id: m.id,
    label: m.id,
    contextWindow: 64_000,
    supportsTools: true,
    supportsStreaming: true,
  }));
}

/**
 * Ollama: endpoint local sin auth.
 *
 * Ollama expone GET /api/tags que devuelve los modelos instalados.
 * Problema: por defecto Ollama NO permite CORS desde otros orígenes.
 * Si Weaver corre en localhost:1420 y Ollama en localhost:11434,
 * el navegador bloquea el request por CORS.
 *
 * Solución: intentar fetch directo primero, y si falla por CORS,
 * usar un proxy CORS público como fallback.
 *
 * Alternativa para el usuario: configurar OLLAMA_ORIGINS=* al arrancar Ollama:
 *   OLLAMA_ORIGINS="*" ollama serve
 */
async function fetchOllamaModels(baseUrl: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  // Intentar fetch directo primero.
  try {
    const resp = await fetch(`${baseUrl}/api/tags`, { signal });
    if (resp.ok) {
      const json = (await resp.json()) as OllamaTagsResponse;
      return parseOllamaModels(json);
    }
  } catch (e) {
    // Probablemente CORS. Intentar con proxy.
    console.warn('[ollama] fetch directo falló (¿CORS?), intentando proxy:', e);
  }

  // Fallback: usar proxy CORS público.
  const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(`${baseUrl}/api/tags`)}`;
  try {
    const resp = await fetch(proxyUrl, { signal });
    if (!resp.ok) throw new Error(`proxy ${resp.status}`);
    const json = (await resp.json()) as OllamaTagsResponse;
    return parseOllamaModels(json);
  } catch (e) {
    console.warn('[ollama] proxy también falló:', e);
    throw new Error(
      'No se pudo conectar a Ollama. Verifica que esté corriendo en ' +
      baseUrl + '. Si el problema es CORS, ejecuta: OLLAMA_ORIGINS="*" ollama serve',
    );
  }
}

interface OllamaTagsResponse {
  models?: Array<{
    name: string;
    model?: string;
    modified_at?: string;
    size?: number;
    details?: {
      parameter_size?: string;
      quantization_level?: string;
      family?: string;
      context_length?: number;
    };
  }>;
}

/** Convierte la respuesta de Ollama a ModelInfo con metadata enriquecida. */
function parseOllamaModels(json: OllamaTagsResponse): ModelInfo[] {
  return (json.models ?? []).map((m) => {
    const name = m.name || m.model || 'unknown';
    // Ollama no devuelve context_length en /api/tags, pero podemos
    // inferirlo de la familia del modelo.
    const family = m.details?.family;
    const contextWindow = m.details?.context_length ?? inferContextWindow(name, family);

    // Label legible: "llama3.3:70b" → "Llama 3.3 (70b)"
    const label = formatOllamaLabel(name, m.details?.parameter_size);

    return {
      id: name,
      label,
      contextWindow,
      supportsStreaming: true,
      supportsTools: true, // Ollama soporta tools en la mayoría de modelos.
      modality: 'text->text',
      sourceProvider: 'ollama',
    };
  });
}

/** Infiere el context window basándose en el nombre/familia del modelo. */
function inferContextWindow(name: string, family?: string): number {
  const lower = name.toLowerCase();
  // Modelos conocidos:
  if (lower.includes('llama3.3') || lower.includes('llama-3.3')) return 128_000;
  if (lower.includes('llama3.1') || lower.includes('llama-3.1')) return 128_000;
  if (lower.includes('llama3') || lower.includes('llama-3')) return 8_192;
  if (lower.includes('qwen2.5')) return 128_000;
  if (lower.includes('qwen2')) return 32_768;
  if (lower.includes('mistral') || lower.includes('mixtral')) return 32_768;
  if (lower.includes('phi3') || lower.includes('phi-3')) return 128_000;
  if (lower.includes('deepseek')) return 64_000;
  if (lower.includes('gemma2')) return 8_192;
  if (lower.includes('codellama')) return 16_384;
  // Default razonable.
  return 8_192;
}

/** Formatea el label de un modelo de Ollama. */
function formatOllamaLabel(name: string, parameterSize?: string): string {
  // "llama3.3:70b" → "Llama 3.3 (70b)"
  // "qwen2.5:7b" → "Qwen 2.5 (7b)"
  // "ornith:9b" → "Ornith (9b)"
  const [base, tag] = name.split(':');
  // Capitalizar primera letra.
  const display = base.charAt(0).toUpperCase() + base.slice(1);
  const size = tag || parameterSize;
  return size ? `${display} (${size})` : display;
}

/** Cerebras: endpoint público sin auth. */
async function fetchCerebrasModels(signal?: AbortSignal): Promise<ModelInfo[]> {
  const resp = await fetch('https://api.cerebras.ai/public/v1/models', { signal });
  if (!resp.ok) throw new Error(`${resp.status}`);
  const json = (await resp.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => ({
    id: m.id,
    label: m.id,
    contextWindow: 128_000,
    supportsTools: true,
    supportsStreaming: true,
  }));
}

/** Dispatcher: llama al fetcher correcto según el proveedor. */
async function fetchModelsForProvider(
  providerId: ProviderId,
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelInfo[]> {
  switch (providerId) {
    case 'anthropic':
      return fetchAnthropicModels(apiKey, signal);
    case 'google':
      return fetchGeminiModels(apiKey, signal);
    case 'cohere':
      return fetchCohereModels(apiKey, signal);
    case 'deepseek':
      return fetchDeepSeekModels(apiKey, signal);
    case 'ollama':
      return fetchOllamaModels(baseUrl, signal);
    case 'cerebras':
      return fetchCerebrasModels(signal);
    // OpenAI-compatibles: openai, groq, together, mistral, grok, perplexity, etc.
    default:
      return fetchOpenAICompat(baseUrl, apiKey, signal);
  }
}
