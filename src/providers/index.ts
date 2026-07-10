/**
 * Fábrica de proveedores: dado un ProviderId y una API key opcional,
 * devuelve la instancia del adaptador correcto.
 *
 * El store de API keys vive en `./store.ts` y usa el keyring del OS vía
 * los comandos Tauri (`keyring_*`).
 */

import type { LLMProvider, ProviderId } from './types';
import { getProvider } from './registry';
import { OpenAICompatProvider } from './adapters/openai-compat';
import { AnthropicProvider } from './adapters/anthropic';
import { GeminiProvider } from './adapters/gemini';
import { OllamaProvider } from './adapters/ollama';
import { apiKeyStore } from './store';

export async function createProvider(id: ProviderId): Promise<LLMProvider> {
  const info = getProvider(id);
  if (!info) throw new Error(`Proveedor desconocido: ${id}`);

  // Ollama/HuggingFace no necesitan API key.
  if (info.family === 'ollama') {
    return new OllamaProvider(info);
  }

  const apiKey = info.noApiKey ? undefined : await apiKeyStore.get(id);

  switch (info.family) {
    case 'openai-compat':
      return new OpenAICompatProvider(info, apiKey);
    case 'anthropic':
      return new AnthropicProvider(info, apiKey);
    case 'google-gemini':
      return new GeminiProvider(info, apiKey);
    case 'vertexai':
      throw new Error('VertexAI adapter aún no implementado (TODO Fase 6)');
    case 'bedrock':
      throw new Error('Bedrock adapter aún no implementado (TODO Fase 6)');
    default:
      throw new Error(`Familia no soportada: ${info.family}`);
  }
}

export * from './registry';
export * from './types';
export * from './store';
