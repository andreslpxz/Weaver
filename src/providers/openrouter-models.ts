/**
 * OpenRouter como fuente de modelos en tiempo real.
 *
 * OpenRouter es un agregador que lista 343+ modelos de OpenAI, Anthropic,
 * Google, Meta, DeepSeek, Mistral, xAI, etc. en un solo endpoint PÚBLICO
 * (sin auth) con metadata rica: context window, pricing, capabilities.
 *
 * Endpoint: GET https://openrouter.ai/api/v1/models
 * Cache:    5 min en edge (cache-control: max-age=300)
 * CORS:     access-control-allow-origin: *
 *
 * Usamos esto como fuente principal para mantener el catálogo de modelos
 * actualizado sin requerir que el usuario configure API keys.
 */

import type { ModelInfo, ModelPricing } from './types';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_KEY = 'weaver:openrouter:models';
const CACHE_TIMESTAMP_KEY = 'weaver:openrouter:models:ts';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

/** Respuesta cruda de OpenRouter (parcial, solo campos que usamos). */
interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    request?: string;
  };
  supported_parameters?: string[];
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
}

interface OpenRouterResponse {
  data: OpenRouterModel[];
}

/**
 * Obtiene la lista de modelos de OpenRouter.
 *
 * Usa cache local de 5 min para no spammear la API. Si el cache está
 * expirado o no existe, hace fetch. Si el fetch falla, devuelve el
 * cache viejo (si existe) o array vacío.
 */
export async function fetchOpenRouterModels(opts?: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
}): Promise<ModelInfo[]> {
  // Verificar cache primero.
  if (!opts?.forceRefresh) {
    const cached = readCache();
    if (cached) {
      return cached;
    }
  }

  try {
    const resp = await fetch(OPENROUTER_MODELS_URL, {
      signal: opts?.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) {
      throw new Error(`OpenRouter ${resp.status}: ${resp.statusText}`);
    }
    const json = (await resp.json()) as OpenRouterResponse;
    const models = json.data.map(convertOpenRouterModel).filter(Boolean) as ModelInfo[];

    // Ordenar: modelos FREE primero, luego por label alfabético.
    // Esto hace que los modelos gratuitos sean fáciles de encontrar en el
    // model picker sin tener que hacer scroll por 300+ modelos de pago.
    models.sort((a, b) => {
      // Free primero.
      const aFree = a.isFree ? 0 : 1;
      const bFree = b.isFree ? 0 : 1;
      if (aFree !== bFree) return aFree - bFree;
      // Dentro del mismo grupo (free/paid), ordenar alfabéticamente por label.
      return a.label.localeCompare(b.label);
    });

    // Guardar en cache.
    writeCache(models);
    return models;
  } catch (e) {
    // Si el fetch falla, intentar devolver cache viejo aunque esté expirado.
    const stale = readCache(true);
    if (stale) {
      console.warn('[OpenRouter] fetch falló, usando cache stale:', e);
      return stale;
    }
    throw e;
  }
}

/**
 * Convierte un modelo de OpenRouter al formato ModelInfo de Weaver.
 */
function convertOpenRouterModel(m: OpenRouterModel): ModelInfo | null {
  if (!m.id) return null;

  const contextWindow = m.context_length ?? m.top_provider?.context_length ?? 128_000;
  const supportedParams = m.supported_parameters ?? [];

  // Detectar capabilities.
  const supportsTools = supportedParams.includes('tools') ||
    supportedParams.includes('tool_choice');
  const inputModalities = m.architecture?.input_modalities ?? [];
  const supportsVision = inputModalities.includes('image');

  // Detectar reasoning models (heurística).
  const isReasoning = /o1|o3|reasoning|thinker|deepseek-r/.test(m.id.toLowerCase());

  // Pricing (OpenRouter devuelve strings en USD por token).
  let pricing: ModelPricing | undefined;
  let isFree = false;
  if (m.pricing) {
    pricing = {};
    if (m.pricing.prompt) pricing.prompt = parseFloat(m.pricing.prompt);
    if (m.pricing.completion) pricing.completion = parseFloat(m.pricing.completion);
    if (m.pricing.input_cache_read) pricing.inputCacheRead = parseFloat(m.pricing.input_cache_read);
    if (m.pricing.request) pricing.request = parseFloat(m.pricing.request);

    // Detectar free: todos los precios son 0 Y el id termina en ":free"
    // (OpenRouter marca los modelos gratuitos con el sufijo :free).
    const allZero =
      (pricing.prompt ?? 1) === 0 &&
      (pricing.completion ?? 1) === 0 &&
      (pricing.request ?? 0) === 0;
    isFree = allZero || m.id.toLowerCase().endsWith(':free');

    // Si todo es 0 o NaN, no incluir pricing (pero keep isFree).
    if (Object.values(pricing).every((v) => !v || isNaN(v))) {
      pricing = undefined;
    }
  } else if (m.id.toLowerCase().endsWith(':free')) {
    isFree = true;
  }

  // Detectar proveedor real desde el ID (ej. "openai/gpt-4o" → "openai").
  const sourceProvider = m.id.includes('/') ? m.id.split('/')[0] : undefined;

  // Label legible: usar m.name si existe, si no derivar del ID.
  // Si el modelo es free y el label no indica "(free)", añadirlo.
  let label = m.name || m.id.split('/').pop() || m.id;
  if (isFree && !/free|gratis/i.test(label)) {
    label = `${label} (free)`;
  }

  return {
    id: m.id,
    label,
    contextWindow,
    supportsTools,
    supportsStreaming: true, // OpenRouter soporta streaming en todos.
    supportsVision,
    isReasoning,
    modality: m.architecture?.modality,
    pricing,
    sourceProvider,
    isFree,
  };
}

// ── Cache helpers ─────────────────────────────────────────────────────────

function readCache(allowStale = false): ModelInfo[] | null {
  try {
    const ts = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!ts) return null;
    const age = Date.now() - parseInt(ts, 10);
    if (!allowStale && age > CACHE_TTL_MS) return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ModelInfo[];
  } catch {
    return null;
  }
}

function writeCache(models: ModelInfo[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(models));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } catch {
    // localStorage lleno o no disponible — ignorar.
  }
}

/**
 * Obtiene modelos de OpenRouter filtrados por proveedor.
 * Útil para cuando el usuario selecciona "OpenAI" en el model picker
 * y queremos mostrar los modelos de OpenAI disponibles en OpenRouter.
 */
export async function fetchOpenRouterModelsByProvider(
  providerId: string,
  opts?: { forceRefresh?: boolean; signal?: AbortSignal },
): Promise<ModelInfo[]> {
  const all = await fetchOpenRouterModels(opts);
  // Normalizar providerId para matching (ej. "openai" → "openai").
  const normalized = providerId.toLowerCase();
  return all.filter((m) => {
    if (!m.sourceProvider) return false;
    return m.sourceProvider.toLowerCase() === normalized;
  });
}

/**
 * Timestamp del último fetch exitoso (para mostrar en UI).
 */
export function getOpenRouterCacheTimestamp(): Date | null {
  const ts = localStorage.getItem(CACHE_TIMESTAMP_KEY);
  if (!ts) return null;
  return new Date(parseInt(ts, 10));
}

/**
 * Formatea un precio en USD por token a un string legible.
 * Ej: 0.0000015 → "$1.50/M tokens"
 */
export function formatPricing(pricePerToken?: number): string | null {
  if (pricePerToken === undefined || pricePerToken === null || isNaN(pricePerToken)) {
    return null;
  }
  if (pricePerToken === 0) return 'gratis';
  // Convertir a USD por millón de tokens.
  const perMillion = pricePerToken * 1_000_000;
  if (perMillion < 0.01) {
    return `$${perMillion.toFixed(3)}/M`;
  }
  return `$${perMillion.toFixed(2)}/M`;
}

/**
 * Formatea el context window a un string legible.
 * Ej: 128000 → "128k", 2097152 → "2M"
 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  return `${Math.round(tokens / 1000)}k`;
}
