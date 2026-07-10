/**
 * Wrappers tipados sobre `invoke()` de Tauri.
 *
 * IMPORTANTE: si Weaver se está ejecutando en un navegador plano (sin el
 * webview de Tauri, p.ej. `npm run dev` puro), `window.__TAURI_INTERNALS__`
 * no existe y `invoke` lanza "Cannot read properties of undefined (reading 'invoke')".
 *
 * Para soportar ambos modos, detectamos el entorno y proporcionamos fallbacks
 * razonables en modo navegador:
 *   - keyring → localStorage (NO seguro, sólo para desarrollo)
 *   - clipboard → navigator.clipboard API
 *   - atspi / automation → error claro pidiendo ejecutar en Tauri
 *
 * En producción (Tauri webview) todo pasa por IPC real.
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type {
  AccessibleNode,
  ApplicationInfo,
  WindowInfo,
  Rect,
} from './tauri-types';

// Detección de Tauri v2: el runtime inyecta `window.__TAURI_INTERNALS__`.
export const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

// Mensaje estándar para comandos que requieren Tauri.
function tauriRequired(cmd: string): never {
  throw new Error(
    `La acción "${cmd}" requiere el backend de Tauri. Ejecuta Weaver con 'npm run tauri:dev' o 'npm run tauri:build' en lugar de 'npm run dev'.`,
  );
}

// ============================================================================
// AT-SPI  (sólo disponible en Tauri webview)
// ============================================================================

export const atspi = {
  listApplications: (): Promise<ApplicationInfo[]> =>
    isTauri
      ? tauriInvoke<ApplicationInfo[]>('atspi_list_applications')
      : Promise.resolve([]),

  queryTree: (busName: string, rootPath: string, maxDepth = 4): Promise<AccessibleNode> =>
    isTauri
      ? tauriInvoke<AccessibleNode>('atspi_query_tree', {
          args: { bus_name: busName, root_path: rootPath, max_depth: maxDepth },
        })
      : tauriRequired('atspi_query_tree'),

  getFocusedSubtree: (maxDepth = 6): Promise<AccessibleNode | null> =>
    isTauri
      ? tauriInvoke<AccessibleNode | null>('atspi_get_focused_subtree', { maxDepth })
      : Promise.resolve(null),

  click: (busName: string, path: string): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('atspi_click', { node: { bus_name: busName, path } })
      : tauriRequired('atspi_click'),

  doubleClick: (busName: string, path: string): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('atspi_double_click', { node: { bus_name: busName, path } })
      : tauriRequired('atspi_double_click'),

  typeText: (busName: string, path: string, text: string): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('atspi_type_text', {
          args: { bus_name: busName, path, text },
        })
      : tauriRequired('atspi_type_text'),

  pressKey: (key: string): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('atspi_press_key', { key })
      : tauriRequired('atspi_press_key'),

  getText: (busName: string, path: string): Promise<string | null> =>
    isTauri
      ? tauriInvoke<string | null>('atspi_get_text', {
          node: { bus_name: busName, path },
        })
      : Promise.resolve(null),

  getExtents: (busName: string, path: string): Promise<Rect> =>
    isTauri
      ? tauriInvoke<Rect>('atspi_get_extents', {
          node: { bus_name: busName, path },
        })
      : tauriRequired('atspi_get_extents'),

  focus: (busName: string, path: string): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('atspi_focus', { node: { bus_name: busName, path } })
      : tauriRequired('atspi_focus'),
};

// ============================================================================
// Automation  (clipboard con fallback navegador; resto requiere Tauri)
// ============================================================================

export const automation = {
  clipboardGet: async (): Promise<string> => {
    if (isTauri) return tauriInvoke<string>('auto_clipboard_get');
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  },

  clipboardSet: async (content: string): Promise<void> => {
    if (isTauri) return tauriInvoke<void>('auto_clipboard_set', { content });
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // Fallback silencioso en navegadores sin permiso.
    }
  },

  listWindows: (): Promise<WindowInfo[]> =>
    isTauri ? tauriInvoke<WindowInfo[]>('auto_list_windows') : Promise.resolve([]),

  activateWindow: (idOrTitle: string): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('auto_activate_window', { idOrTitle })
      : tauriRequired('auto_activate_window'),

  keyTap: (key: string): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('auto_key_tap', { args: { key } })
      : tauriRequired('auto_key_tap'),

  mouseClickAt: (x: number, y: number, button = 1): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('auto_mouse_click_at', { args: { x, y, button } })
      : tauriRequired('auto_mouse_click_at'),
};

// ============================================================================
// Keyring  (localStorage como fallback en navegador)
// ============================================================================

export interface GetKeyResult {
  provider_id: string;
  has_key: boolean;
  masked: string | null;
}

const LS_PREFIX = 'weaver:key:';

function lsGet(providerId: string): string | null {
  try {
    return localStorage.getItem(LS_PREFIX + providerId);
  } catch {
    return null;
  }
}

function lsSet(providerId: string, key: string): void {
  try {
    localStorage.setItem(LS_PREFIX + providerId, key);
  } catch {
    // quota
  }
}

function lsDel(providerId: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + providerId);
  } catch {
    // ignore
  }
}

export const keyring = {
  setApiKey: (providerId: string, apiKey: string): Promise<void> => {
    if (isTauri) {
      return tauriInvoke<void>('keyring_set_api_key', {
        args: { provider_id: providerId, api_key: apiKey },
      });
    }
    lsSet(providerId, apiKey);
    return Promise.resolve();
  },

  getApiKey: (providerId: string): Promise<GetKeyResult> => {
    if (isTauri) {
      return tauriInvoke<GetKeyResult>('keyring_get_api_key', {
        args: { provider_id: providerId },
      });
    }
    const k = lsGet(providerId);
    const masked = k
      ? k.length > 8
        ? `${k.slice(0, 4)}…${k.slice(-4)}`
        : '••••'
      : null;
    return Promise.resolve({
      provider_id: providerId,
      has_key: !!k,
      masked,
    });
  },

  getApiKeyRaw: (providerId: string): Promise<string | null> => {
    if (isTauri) {
      return tauriInvoke<string | null>('keyring_get_api_key_raw', {
        args: { provider_id: providerId },
      });
    }
    return Promise.resolve(lsGet(providerId));
  },

  deleteApiKey: (providerId: string): Promise<void> => {
    if (isTauri) {
      return tauriInvoke<void>('keyring_delete_api_key', { providerId });
    }
    lsDel(providerId);
    return Promise.resolve();
  },

  listProviders: (): Promise<string[]> => {
    if (isTauri) {
      return tauriInvoke<string[]>('keyring_list_providers');
    }
    // Listar claves en localStorage con prefijo
    const found: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(LS_PREFIX)) {
          found.push(k.slice(LS_PREFIX.length));
        }
      }
    } catch {
      // ignore
    }
    return Promise.resolve(found);
  },
};

// Re-export para que callers sepan si están en Tauri.
export const runtime = {
  isTauri,
  isBrowser: !isTauri,
  /** Devuelve un mensaje explicando el modo actual. Útil para mostrar en UI. */
  describe(): string {
    return isTauri
      ? 'Tauri webview (acceso completo: AT-SPI, automatización, keyring OS)'
      : 'Navegador (modo dev: API keys en localStorage, sin AT-SPI ni automatización)';
  },
};
