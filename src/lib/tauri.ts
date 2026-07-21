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
      // IMPORTANTE: el comando Rust `keyring_delete_api_key` espera
      // `provider_id` (snake_case) como argumento. Si mandamos `providerId`
      // (camelCase), Tauri no lo mapea y la llamada falla silenciosamente
      // en algunos casos o lanza "missing field provider_id".
      return tauriInvoke<void>('keyring_delete_api_key', {
        providerId,
        provider_id: providerId,
      });
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
      ? 'Tauri webview (acceso completo: AT-SPI, automatización, keyring OS, SQLite)'
      : 'Navegador (modo dev: API keys en localStorage, sin AT-SPI ni automatización)';
  },
};

// ============================================================================
// SQLite (memoria, proyectos, conversaciones, skills) — sólo en Tauri
// ============================================================================

export interface EpisodeRow {
  id: string;
  objective: string;
  plan_json: string;
  started_at: number;
  finished_at: number | null;
  outcome: string;
  lessons_json: string | null;
  skill_generated: string | null;
  project_id: string | null;
}

export interface FactRow {
  key: string;
  value: string;
  source: string;
  updated_at: number;
}

export interface ProjectRow {
  id: string;
  name: string;
  color: string | null;
  created_at: number;
}

export interface ConversationRow {
  id: string;
  project_id: string | null;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  ts: number;
  attachments_json: string | null;
  reasoning: string | null;
}

export interface SkillRow {
  name: string;
  description: string;
  triggers_json: string;
  tools_required_json: string;
  body: string;
  source: string;
  file_path: string | null;
}

// ============================================================================
// ME — Tipos de datos
// ============================================================================

export interface MeEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  calendar_id: string;
  start_ts: number;
  end_ts: number;
  all_day: boolean;
  color: string | null;
  recurrence: string | null;
  reminder_minutes: number | null;
  created_at: number;
  updated_at: number;
}

export interface MeCalendar {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  created_at: number;
}

export interface MeTask {
  id: string;
  title: string;
  notes: string | null;
  priority: number;
  done: boolean;
  due_ts: number | null;
  list_id: string;
  created_at: number;
  completed_at: number | null;
}

export interface MeNote {
  id: string;
  title: string | null;
  body: string;
  color: string | null;
  tags_json: string | null;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface MeHealth {
  id: string;
  kind: string;
  value: string;
  unit: string | null;
  ts: number;
  notes: string | null;
}

export interface MeShoppingItem {
  id: string;
  list_id: string;
  name: string;
  qty: string | null;
  category: string | null;
  checked: boolean;
  created_at: number;
  checked_at: number | null;
}

export interface MeIntegration {
  id: string;
  kind: string;
  label: string;
  config_json: string;
  enabled: boolean;
  created_at: number;
}

export const sqlite = {
  // --- Episodes ---
  listEpisodes: () =>
    isTauri ? tauriInvoke<EpisodeRow[]>('memory_list_episodes') : Promise.resolve([]),
  saveEpisode: (ep: EpisodeRow) =>
    isTauri ? tauriInvoke<void>('memory_save_episode', { episode: ep }) : Promise.resolve(),
  deleteEpisode: (id: string) =>
    isTauri ? tauriInvoke<void>('memory_delete_episode', { id }) : Promise.resolve(),
  clearAll: () =>
    isTauri ? tauriInvoke<void>('memory_clear_all') : Promise.resolve(),

  // --- Facts ---
  listFacts: () =>
    isTauri ? tauriInvoke<FactRow[]>('memory_list_facts') : Promise.resolve([]),
  setFact: (key: string, value: string, source: string) =>
    isTauri ? tauriInvoke<void>('memory_set_fact', { key, value, source }) : Promise.resolve(),
  getFact: (key: string) =>
    isTauri ? tauriInvoke<string | null>('memory_get_fact', { key }) : Promise.resolve(null),
  deleteFact: (key: string) =>
    isTauri ? tauriInvoke<void>('memory_delete_fact', { key }) : Promise.resolve(),

  // --- Projects ---
  listProjects: () =>
    isTauri ? tauriInvoke<ProjectRow[]>('projects_list') : Promise.resolve([]),
  createProject: (name: string, color?: string) =>
    isTauri ? tauriInvoke<ProjectRow>('projects_create', { name, color }) : Promise.resolve(null),
  deleteProject: (id: string) =>
    isTauri ? tauriInvoke<void>('projects_delete', { id }) : Promise.resolve(),
  renameProject: (id: string, name: string) =>
    isTauri ? tauriInvoke<void>('projects_rename', { id, name }) : Promise.resolve(),

  // --- Conversations ---
  listConversations: (projectId?: string) =>
    isTauri
      ? tauriInvoke<ConversationRow[]>('conversations_list', { projectId })
      : Promise.resolve([]),
  createConversation: (id: string, projectId: string | null, title: string) =>
    isTauri
      ? tauriInvoke<ConversationRow>('conversations_create', { id, projectId, title })
      : Promise.resolve(null),
  setConversationProject: (convId: string, projectId: string | null) =>
    isTauri
      ? tauriInvoke<void>('conversations_set_project', { convId, projectId })
      : Promise.resolve(),
  renameConversation: (id: string, title: string) =>
    isTauri ? tauriInvoke<void>('conversations_rename', { id, title }) : Promise.resolve(),
  deleteConversation: (id: string) =>
    isTauri ? tauriInvoke<void>('conversations_delete', { id }) : Promise.resolve(),

  // --- Messages ---
  listMessages: (conversationId: string) =>
    isTauri
      ? tauriInvoke<MessageRow[]>('messages_list', { conversationId })
      : Promise.resolve([]),
  saveMessage: (msg: MessageRow) =>
    isTauri ? tauriInvoke<void>('messages_save', { msg }) : Promise.resolve(),
  deleteMessage: (id: string) =>
    isTauri ? tauriInvoke<void>('messages_delete', { id }) : Promise.resolve(),

  // --- Skills ---
  listSkills: () =>
    isTauri ? tauriInvoke<SkillRow[]>('skills_list') : Promise.resolve([]),
  saveSkill: (skill: SkillRow) =>
    isTauri ? tauriInvoke<void>('skills_save', { skill }) : Promise.resolve(),
  deleteSkill: (name: string) =>
    isTauri ? tauriInvoke<void>('skills_delete', { name }) : Promise.resolve(),

  // --- Tools (shell/fs) ---
  shellExec: (command: string, cwd?: string, timeout?: number) =>
    isTauri
      ? tauriInvoke<{ stdout: string; stderr: string; code: number }>('tools_shell_exec', {
          args: { command, cwd, timeout },
        })
      : Promise.reject(new Error('shell_exec requiere Tauri')),
  fileRead: (path: string) =>
    isTauri
      ? tauriInvoke<string>('tools_file_read', { args: { path } })
      : Promise.reject(new Error('file_read requiere Tauri')),
  fileWrite: (path: string, content: string, createDirs?: boolean) =>
    isTauri
      ? tauriInvoke<void>('tools_file_write', {
          args: { path, content, create_dirs: createDirs },
        })
      : Promise.reject(new Error('file_write requiere Tauri')),
  fileList: (path: string) =>
    isTauri
      ? tauriInvoke<Array<{ name: string; is_dir: boolean; size: number }>>('tools_file_list', {
          args: { path },
        })
      : Promise.reject(new Error('file_list requiere Tauri')),

  // --- ME: Eventos ---
  meEventsList: () =>
    isTauri ? tauriInvoke<MeEvent[]>('me_events_list') : Promise.resolve([]),
  meEventsSave: (event: MeEvent) =>
    isTauri ? tauriInvoke<void>('me_events_save', { event }) : Promise.resolve(),
  meEventsDelete: (id: string) =>
    isTauri ? tauriInvoke<void>('me_events_delete', { id }) : Promise.resolve(),

  // --- ME: Calendarios ---
  meCalendarsList: () =>
    isTauri ? tauriInvoke<MeCalendar[]>('me_calendars_list') : Promise.resolve([]),
  meCalendarsSave: (cal: MeCalendar) =>
    isTauri ? tauriInvoke<void>('me_calendars_save', { cal }) : Promise.resolve(),
  meCalendarsDelete: (id: string) =>
    isTauri ? tauriInvoke<void>('me_calendars_delete', { id }) : Promise.resolve(),

  // --- ME: Tareas ---
  meTasksList: () =>
    isTauri ? tauriInvoke<MeTask[]>('me_tasks_list') : Promise.resolve([]),
  meTasksSave: (task: MeTask) =>
    isTauri ? tauriInvoke<void>('me_tasks_save', { task }) : Promise.resolve(),
  meTasksDelete: (id: string) =>
    isTauri ? tauriInvoke<void>('me_tasks_delete', { id }) : Promise.resolve(),

  // --- ME: Notas ---
  meNotesList: () =>
    isTauri ? tauriInvoke<MeNote[]>('me_notes_list') : Promise.resolve([]),
  meNotesSave: (note: MeNote) =>
    isTauri ? tauriInvoke<void>('me_notes_save', { note }) : Promise.resolve(),
  meNotesDelete: (id: string) =>
    isTauri ? tauriInvoke<void>('me_notes_delete', { id }) : Promise.resolve(),

  // --- ME: Salud ---
  meHealthList: () =>
    isTauri ? tauriInvoke<MeHealth[]>('me_health_list') : Promise.resolve([]),
  meHealthSave: (h: MeHealth) =>
    isTauri ? tauriInvoke<void>('me_health_save', { h }) : Promise.resolve(),
  meHealthDelete: (id: string) =>
    isTauri ? tauriInvoke<void>('me_health_delete', { id }) : Promise.resolve(),

  // --- ME: Compras ---
  meShoppingList: () =>
    isTauri ? tauriInvoke<MeShoppingItem[]>('me_shopping_list') : Promise.resolve([]),
  meShoppingSave: (item: MeShoppingItem) =>
    isTauri ? tauriInvoke<void>('me_shopping_save', { item }) : Promise.resolve(),
  meShoppingDelete: (id: string) =>
    isTauri ? tauriInvoke<void>('me_shopping_delete', { id }) : Promise.resolve(),

  // --- ME: Integraciones nativas ---
  meIntegrationsList: () =>
    isTauri ? tauriInvoke<MeIntegration[]>('me_integrations_list') : Promise.resolve([]),
  meIntegrationsSave: (it: MeIntegration) =>
    isTauri ? tauriInvoke<void>('me_integrations_save', { it }) : Promise.resolve(),
  meIntegrationsDelete: (id: string) =>
    isTauri ? tauriInvoke<void>('me_integrations_delete', { id }) : Promise.resolve(),
};

// ============================================================================
// MCP (Model Context Protocol) — runtime real vía Rust en Fase 7
// ============================================================================

export interface McpServerDef {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
}

export interface McpTool {
  server_id: string;
  server_name: string;
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface McpContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mime_type?: string;
  resource?: unknown;
}

export interface McpCallResult {
  content: McpContent[];
  is_error: boolean;
}

export const mcp = {
  listServers: (): Promise<McpServerDef[]> =>
    isTauri
      ? tauriInvoke<McpServerDef[]>('mcp_list_servers')
      : Promise.resolve([]),
  addServer: (server: McpServerDef): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('mcp_add_server', { server })
      : Promise.resolve(),
  removeServer: (id: string): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('mcp_remove_server', { id })
      : Promise.resolve(),
  startServer: (id: string): Promise<void> =>
    isTauri
      ? tauriInvoke<void>('mcp_start_server', { id })
      : Promise.reject(new Error('mcp_start_server requiere Tauri')),
  listTools: (): Promise<McpTool[]> =>
    isTauri
      ? tauriInvoke<McpTool[]>('mcp_list_tools')
      : Promise.resolve([]),
  callTool: (serverId: string, name: string, args: Record<string, unknown>): Promise<McpCallResult> =>
    isTauri
      ? tauriInvoke<McpCallResult>('mcp_call_tool', { serverId, name, args })
      : Promise.reject(new Error('mcp_call_tool requiere Tauri')),
  generateId: (): Promise<string> =>
    isTauri
      ? tauriInvoke<string>('mcp_generate_id')
      : Promise.resolve(crypto.randomUUID()),
};
