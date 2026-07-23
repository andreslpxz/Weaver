/**
 * Fábrica de proveedores: dado un ProviderId y una API key opcional,
 * devuelve la instancia del adaptador correcto.
 *
 * El store de API keys vive en `./store.ts` y usa el keyring del OS vía
 * los comandos Tauri (`keyring_*`).
 *
 * Para colaboración local en proyectos, se puede pasar `apiKeyOverride`
 * para usar la API key miembro-específica (ver `apiKeyStore.getForMember`).
 */

import type { LLMProvider, ProviderId } from './types';
import { getProvider } from './registry';
import { OpenAICompatProvider } from './adapters/openai-compat';
import { AnthropicProvider } from './adapters/anthropic';
import { GeminiProvider } from './adapters/gemini';
import { OllamaProvider } from './adapters/ollama';
import { BedrockProvider } from './adapters/bedrock';
import { VertexAIProvider } from './adapters/vertexai';
import { apiKeyStore } from './store';

export interface CreateProviderOpts {
  /** Si se pasa, se usa en lugar de la key global del keyring.
   *  Útil para miembros de proyecto que tienen su propia key. */
  apiKeyOverride?: string;
}

export async function createProvider(
  id: ProviderId,
  opts?: CreateProviderOpts,
): Promise<LLMProvider> {
  const info = getProvider(id);
  if (!info) throw new Error(`Proveedor desconocido: ${id}`);

  // Ollama/HuggingFace no necesitan API key.
  if (info.family === 'ollama') {
    return new OllamaProvider(info);
  }

  const apiKey = info.noApiKey
    ? undefined
    : opts?.apiKeyOverride ?? (await apiKeyStore.get(id));

  switch (info.family) {
    case 'openai-compat':
      return new OpenAICompatProvider(info, apiKey);
    case 'anthropic':
      return new AnthropicProvider(info, apiKey);
    case 'google-gemini':
      return new GeminiProvider(info, apiKey);
    case 'vertexai':
      return new VertexAIProvider(info, apiKey);
    case 'bedrock':
      return new BedrockProvider(info, apiKey);
    default:
      throw new Error(`Familia no soportada: ${info.family}`);
  }
}

export * from './registry';
export * from './types';
export * from './store';
