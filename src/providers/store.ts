/**
 * Store de API keys. Delega al keyring del OS vía Tauri IPC.
 *
 * API:
 *   get(providerId) → string | undefined
 *   set(providerId, key) → void
 *   delete(providerId) → void
 *   listWithKeys() → ProviderId[]
 *   mask(key) → string  (para mostrar en UI)
 */

import { keyring as keyringApi } from '@/lib/tauri';
import type { ProviderId } from './types';

/** Cache en memoria para evitar invocar Tauri en cada llamada. */
const cache = new Map<ProviderId, string | undefined>();
const known = new Set<ProviderId>();
let initialized = false;

async function ensureInit() {
  if (initialized) return;
  initialized = true;
  try {
    const list = await keyringApi.listProviders();
    for (const p of list) known.add(p as ProviderId);
  } catch {
    // Tauri no disponible (probablemente en `vite dev` puro sin backend).
  }
}

export const apiKeyStore = {
  async get(providerId: ProviderId): Promise<string | undefined> {
    if (cache.has(providerId)) return cache.get(providerId);
    await ensureInit();
    try {
      const raw = await keyringApi.getApiKeyRaw(providerId);
      if (raw) {
        cache.set(providerId, raw);
        known.add(providerId);
        return raw;
      }
      cache.set(providerId, undefined);
      return undefined;
    } catch {
      cache.set(providerId, undefined);
      return undefined;
    }
  },

  async set(providerId: ProviderId, apiKey: string): Promise<void> {
    cache.set(providerId, apiKey);
    known.add(providerId);
    await keyringApi.setApiKey(providerId, apiKey);
  },

  async delete(providerId: ProviderId): Promise<void> {
    cache.set(providerId, undefined);
    known.delete(providerId);
    await keyringApi.deleteApiKey(providerId);
  },

  has(providerId: ProviderId): boolean {
    return known.has(providerId);
  },

  listKnown(): ProviderId[] {
    return [...known];
  },

  /** Comprueba si una API key es válida (best-effort: intenta listar modelos). */
  async test(providerId: ProviderId, apiKey: string): Promise<{ ok: boolean; message: string }> {
    // La implementación real la hace el adaptador al hacer `listModels(apiKey)`.
    // Aquí solo devolvemos ok=true si la string no está vacía.
    if (!apiKey || apiKey.length < 8) {
      return { ok: false, message: 'API key demasiado corta' };
    }
    return { ok: true, message: 'Parece válida (prueba real al primer uso)' };
  },
};

export function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
