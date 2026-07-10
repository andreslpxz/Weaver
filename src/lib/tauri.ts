/**
 * Wrappers tipados sobre `invoke()` de Tauri.
 * Siempre usar estas funciones en vez de `invoke` directo para tener tipos.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  AccessibleNode,
  ApplicationInfo,
  WindowInfo,
  Rect,
} from './tauri-types';

// ============================================================================
// AT-SPI
// ============================================================================

export const atspi = {
  listApplications: () => invoke<ApplicationInfo[]>('atspi_list_applications'),

  queryTree: (busName: string, rootPath: string, maxDepth = 4) =>
    invoke<AccessibleNode>('atspi_query_tree', {
      args: { bus_name: busName, root_path: rootPath, max_depth: maxDepth },
    }),

  getFocusedSubtree: (maxDepth = 6) =>
    invoke<AccessibleNode | null>('atspi_get_focused_subtree', { maxDepth }),

  click: (busName: string, path: string) =>
    invoke<void>('atspi_click', { node: { bus_name: busName, path } }),

  doubleClick: (busName: string, path: string) =>
    invoke<void>('atspi_double_click', { node: { bus_name: busName, path } }),

  typeText: (busName: string, path: string, text: string) =>
    invoke<void>('atspi_type_text', {
      args: { bus_name: busName, path, text },
    }),

  pressKey: (key: string) => invoke<void>('atspi_press_key', { key }),

  getText: (busName: string, path: string) =>
    invoke<string | null>('atspi_get_text', {
      node: { bus_name: busName, path },
    }),

  getExtents: (busName: string, path: string) =>
    invoke<Rect>('atspi_get_extents', {
      node: { bus_name: busName, path },
    }),

  focus: (busName: string, path: string) =>
    invoke<void>('atspi_focus', { node: { bus_name: busName, path } }),
};

// ============================================================================
// Automation
// ============================================================================

export const automation = {
  clipboardGet: () => invoke<string>('auto_clipboard_get'),
  clipboardSet: (content: string) => invoke<void>('auto_clipboard_set', { content }),
  listWindows: () => invoke<WindowInfo[]>('auto_list_windows'),
  activateWindow: (idOrTitle: string) =>
    invoke<void>('auto_activate_window', { idOrTitle }),
  keyTap: (key: string) => invoke<void>('auto_key_tap', { args: { key } }),
  mouseClickAt: (x: number, y: number, button = 1) =>
    invoke<void>('auto_mouse_click_at', { args: { x, y, button } }),
};

// ============================================================================
// Keyring
// ============================================================================

export interface GetKeyResult {
  provider_id: string;
  has_key: boolean;
  masked: string | null;
}

export const keyring = {
  setApiKey: (providerId: string, apiKey: string) =>
    invoke<void>('keyring_set_api_key', {
      args: { provider_id: providerId, api_key: apiKey },
    }),

  getApiKey: (providerId: string) =>
    invoke<GetKeyResult>('keyring_get_api_key', {
      args: { provider_id: providerId },
    }),

  getApiKeyRaw: (providerId: string) =>
    invoke<string | null>('keyring_get_api_key_raw', {
      args: { provider_id: providerId },
    }),

  deleteApiKey: (providerId: string) =>
    invoke<void>('keyring_delete_api_key', { providerId }),

  listProviders: () => invoke<string[]>('keyring_list_providers'),
};
