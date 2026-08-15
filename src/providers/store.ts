/**
 * Store de API keys. Delega al keyring del OS vía Tauri IPC.
 *
 * API:
 *   get(providerId) → string | undefined
 *   set(providerId, key) → void
 *   delete(providerId) → void
 *   listWithKeys() → ProviderId[]
 *   mask(key) → string  (para mostrar en UI)
 *
 * Variante por miembro de proyecto (colaboración local):
 *   getForMember(memberId, providerId) → string | undefined
 *     Devuelve la key específica del miembro si existe; si no, cae al
 *     keyring global (para que un miembro sin key propia pueda seguir
 *     usando la key del dueño si así se desea).
 *   setForMember(memberId, providerId, key) → void
 *   deleteForMember(memberId, providerId) → void
 *   hasForMember(memberId, providerId) → boolean
 *
 * Las keys miembro-específicas se guardan en el keyring del OS bajo el
 * id compuesto `member:<memberId>:<providerId>`. Esto las aísla
 * totalmente de la key global del mismo provider.
 */

import { keyring as keyringApi } from '@/lib/tauri';
import type { ProviderId } from './types';

/** Cache en memoria para evitar invocar Tauri en cada llamada. */
const cache = new Map<string, string | undefined>();
const known = new Set<string>();
let initialized = false;

async function ensureInit() {
  if (initialized) return;
  initialized = true;
  try {
    const list = await keyringApi.listProviders();
    for (const p of list) known.add(p);
  } catch {
    // Tauri no disponible (probablemente en `vite dev` puro sin backend).
  }
}

/** Construye el id compuesto para una key miembro-específica. */
function memberKey(memberId: string, providerId: ProviderId): string {
  return `member:${memberId}:${providerId}`;
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
    // Propagamos el error para que el UI lo muestre. Antes se tragaba
    // silenciosamente, lo que hacía que el usuario creyera que se había
    // guardado cuando en realidad falló (ej: keyring del OS bloqueado).
    try {
      await keyringApi.setApiKey(providerId, apiKey);
    } catch (e) {
      // Revertir cache porque el guardado falló.
      cache.set(providerId, undefined);
      known.delete(providerId);
      throw e;
    }
  },

  async delete(providerId: ProviderId): Promise<void> {
    cache.set(providerId, undefined);
    known.delete(providerId);
    try {
      await keyringApi.deleteApiKey(providerId);
    } catch (e) {
      // Recargar el estado real desde el OS en caso de fallo.
      try {
        const raw = await keyringApi.getApiKeyRaw(providerId);
        if (raw) {
          cache.set(providerId, raw);
          known.add(providerId);
        }
      } catch {
        // ignore
      }
      throw e;
    }
  },

  has(providerId: ProviderId): boolean {
    return known.has(providerId);
  },

  listKnown(): ProviderId[] {
    return [...known] as ProviderId[];
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

  // ==========================================================================
  // API keys miembro-específicas (colaboración local en proyectos)
  // ==========================================================================

  /** Devuelve la API key específica del miembro, o la global si no tiene. */
  async getForMember(memberId: string, providerId: ProviderId): Promise<string | undefined> {
    const k = memberKey(memberId, providerId);
    if (cache.has(k)) return cache.get(k);
    await ensureInit();
    try {
      const raw = await keyringApi.getApiKeyRaw(k);
      if (raw) {
        cache.set(k, raw);
        known.add(k);
        return raw;
      }
      cache.set(k, undefined);
      // Fallback a la key global del provider.
      return await apiKeyStore.get(providerId);
    } catch {
      cache.set(k, undefined);
      return await apiKeyStore.get(providerId);
    }
  },

  /** Guarda la API key específica del miembro (no afecta a la global). */
  async setForMember(memberId: string, providerId: ProviderId, apiKey: string): Promise<void> {
    const k = memberKey(memberId, providerId);
    cache.set(k, apiKey);
    known.add(k);
    try {
      await keyringApi.setApiKey(k, apiKey);
    } catch (e) {
      cache.set(k, undefined);
      known.delete(k);
      throw e;
    }
  },

  /** Borra la API key específica del miembro (no afecta a la global). */
  async deleteForMember(memberId: string, providerId: ProviderId): Promise<void> {
    const k = memberKey(memberId, providerId);
    cache.set(k, undefined);
    known.delete(k);
    try {
      await keyringApi.deleteApiKey(k);
    } catch (e) {
      try {
        const raw = await keyringApi.getApiKeyRaw(k);
        if (raw) {
          cache.set(k, raw);
          known.add(k);
        }
      } catch {
        // ignore
      }
      throw e;
    }
  },

  /** Comprueba si existe una API key específica del miembro (no fallback). */
  hasForMember(memberId: string, providerId: ProviderId): boolean {
    return known.has(memberKey(memberId, providerId));
  },

  /** Devuelve true si el miembro tiene su propia key (no la global). */
  async hasForMemberAsync(memberId: string, providerId: ProviderId): Promise<boolean> {
    const k = memberKey(memberId, providerId);
    if (cache.has(k)) return cache.get(k) !== undefined;
    await ensureInit();
    try {
      const raw = await keyringApi.getApiKeyRaw(k);
      if (raw) {
        cache.set(k, raw);
        known.add(k);
        return true;
      }
      cache.set(k, undefined);
      return false;
    } catch {
      return false;
    }
  },
};

export function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
