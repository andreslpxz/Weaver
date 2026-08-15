/**
 * Cliente MCP (Model Context Protocol).
 *
 * MCP permite a servidores externos exponer tools al agente. El protocolo
 * usa JSON-RPC sobre stdio o SSE. Weaver actúa como cliente:
 *
 *   1. El usuario registra servidores MCP (presets o custom).
 *   2. Weaver los lanza como subprocesos (stdio) o se conecta vía SSE.
 *   3. Lista las tools expuestas.
 *   4. El usuario aprueba/prohíbe tools individualmente.
 *   5. Las tools aprobadas se fusionan con las tools AT-SPI del agente.
 */

import { MCP_PRESETS, type McpPreset } from './presets';

export interface McpServer {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  /** Para stdio: comando + args. Para sse: URL. */
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
  /** ID del preset si viene del catálogo (para logo + metadata). */
  presetId?: string;
  /** Estado de instalación. */
  status: 'not_installed' | 'installed' | 'running' | 'error';
  /** Mensaje de error si status === 'error'. */
  errorMessage?: string;
}

export interface McpTool {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Estado de aprobación de una tool individual. */
export type ToolApproval = 'pending' | 'approved' | 'denied';

/** Configuración de aprobación de tools por servidor. */
export interface ToolApprovalConfig {
  /** Map de toolName → approval. */
  tools: Record<string, ToolApproval>;
  /** Si es true, todas las tools nuevas se aprueban automáticamente. */
  autoApproveAll: boolean;
}

const SERVERS_KEY = 'weaver:mcp:servers';
const APPROVALS_KEY = 'weaver:mcp:approvals';

// ============================================================================
// Servidores
// ============================================================================

export const mcpClient = {
  /** Lista los servidores MCP registrados. */
  listServers(): McpServer[] {
    try {
      const raw = localStorage.getItem(SERVERS_KEY);
      return raw ? (JSON.parse(raw) as McpServer[]) : [];
    } catch {
      return [];
    }
  },

  /** Registra o actualiza un servidor MCP. */
  saveServer(server: McpServer): void {
    const all = mcpClient.listServers();
    const idx = all.findIndex((s) => s.id === server.id);
    if (idx >= 0) all[idx] = server;
    else all.push(server);
    localStorage.setItem(SERVERS_KEY, JSON.stringify(all));
  },

  /** Elimina un servidor. */
  removeServer(id: string): void {
    localStorage.setItem(
      SERVERS_KEY,
      JSON.stringify(mcpClient.listServers().filter((s) => s.id !== id)),
    );
    // Limpiar también las aprobaciones de tools de ese servidor.
    const approvals = mcpClient.listAllApprovals();
    delete approvals[id];
    localStorage.setItem(APPROVALS_KEY, JSON.stringify(approvals));
  },

  /** Instala un preset del catálogo con un solo click. */
  installPreset(preset: McpPreset, envValues: Record<string, string>): McpServer {
    const server: McpServer = {
      id: `preset-${preset.id}-${Date.now()}`,
      name: preset.name,
      transport: 'stdio',
      command: preset.command,
      args: preset.args,
      env: envValues,
      enabled: true,
      presetId: preset.id,
      status: 'installed',
    };
    mcpClient.saveServer(server);

    // Inicializar aprobaciones: todas las tools conocidas del preset en pending.
    const approvals = mcpClient.listAllApprovals();
    approvals[server.id] = {
      tools: {},
      autoApproveAll: false,
    };
    localStorage.setItem(APPROVALS_KEY, JSON.stringify(approvals));

    return server;
  },

  /** Verifica si un preset ya está instalado. */
  isPresetInstalled(presetId: string): boolean {
    return mcpClient.listServers().some((s) => s.presetId === presetId);
  },

  /** Lista las tools expuestas por todos los servidores habilitados. */
  async listTools(): Promise<McpTool[]> {
    // En navegador: no podemos lanzar subprocesos stdio.
    // En Tauri: se llama al comando mcp_list_tools que lanza los servidores.
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      try {
        const { mcp } = await import('@/lib/tauri');
        const rawTools = await mcp.listTools();
        // Mapear de snake_case (Rust) a camelCase (TS).
        return rawTools.map((t) => ({
          serverId: t.server_id,
          serverName: t.server_name,
          name: t.name,
          description: t.description,
          inputSchema: t.input_schema,
        }));
      } catch {
        return [];
      }
    }
    return [];
  },

  /** Invoca una tool MCP por nombre. */
  async callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<unknown> {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const { mcp } = await import('@/lib/tauri');
      return await mcp.callTool(serverId, name, args);
    }
    throw new Error(`MCP callTool requiere Tauri (no disponible en navegador)`);
  },

  // ── Aprobaciones de tools ──────────────────────────────────────────

  /** Lista la configuración de aprobaciones de un servidor. */
  getApprovals(serverId: string): ToolApprovalConfig {
    try {
      const raw = localStorage.getItem(APPROVALS_KEY);
      const all = raw ? JSON.parse(raw) as Record<string, ToolApprovalConfig> : {};
      return all[serverId] ?? { tools: {}, autoApproveAll: false };
    } catch {
      return { tools: {}, autoApproveAll: false };
    }
  },

  /** Lista todas las aprobaciones (todos los servidores). */
  listAllApprovals(): Record<string, ToolApprovalConfig> {
    try {
      const raw = localStorage.getItem(APPROVALS_KEY);
      return raw ? JSON.parse(raw) as Record<string, ToolApprovalConfig> : {};
    } catch {
      return {};
    }
  },

  /** Aprueba una tool individual. */
  approveTool(serverId: string, toolName: string): void {
    const all = mcpClient.listAllApprovals();
    if (!all[serverId]) all[serverId] = { tools: {}, autoApproveAll: false };
    all[serverId].tools[toolName] = 'approved';
    localStorage.setItem(APPROVALS_KEY, JSON.stringify(all));
  },

  /** Prohíbe una tool individual. */
  denyTool(serverId: string, toolName: string): void {
    const all = mcpClient.listAllApprovals();
    if (!all[serverId]) all[serverId] = { tools: {}, autoApproveAll: false };
    all[serverId].tools[toolName] = 'denied';
    localStorage.setItem(APPROVALS_KEY, JSON.stringify(all));
  },

  /** Pone una tool en pendiente (reset). */
  resetTool(serverId: string, toolName: string): void {
    const all = mcpClient.listAllApprovals();
    if (!all[serverId]) return;
    delete all[serverId].tools[toolName];
    localStorage.setItem(APPROVALS_KEY, JSON.stringify(all));
  },

  /** Activa/desactiva auto-aprobar todas las tools de un servidor. */
  setAutoApproveAll(serverId: string, value: boolean): void {
    const all = mcpClient.listAllApprovals();
    if (!all[serverId]) all[serverId] = { tools: {}, autoApproveAll: false };
    all[serverId].autoApproveAll = value;
    // Si activamos auto-approve, aprobar todas las tools pendientes.
    if (value) {
      for (const tool of Object.keys(all[serverId].tools)) {
        if (all[serverId].tools[tool] === 'pending') {
          all[serverId].tools[tool] = 'approved';
        }
      }
    }
    localStorage.setItem(APPROVALS_KEY, JSON.stringify(all));
  },

  /** Verifica si una tool está aprobada (considera autoApproveAll). */
  isToolApproved(serverId: string, toolName: string): boolean {
    const config = mcpClient.getApprovals(serverId);
    if (config.autoApproveAll) return true;
    return config.tools[toolName] === 'approved';
  },

  /** Verifica si una tool está explícitamente prohibida. */
  isToolDenied(serverId: string, toolName: string): boolean {
    const config = mcpClient.getApprovals(serverId);
    return config.tools[toolName] === 'denied';
  },
};

/** Lista los presets disponibles (del catálogo). */
export function listPresets(): McpPreset[] {
  return MCP_PRESETS;
}
