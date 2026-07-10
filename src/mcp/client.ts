/**
 * Cliente MCP (Model Context Protocol) — esqueleto.
 *
 * MCP permite a servidores externos exponer tools al agente. El protocolo
 * usa JSON-RPC sobre stdio o SSE. Weaver actúa como cliente:
 *
 *   1. El usuario registra servidores MCP en Configuración.
 *   2. Weaver los lanza como subprocesos (stdio) o se conecta vía SSE.
 *   3. Lista las tools expuestas y las fusiona con las tools AT-SPI.
 *
 * Implementación completa en Fase 6. Por ahora: tipos + registry vacío.
 */

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
}

export interface McpTool {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const STORE_KEY = 'weaver:mcp:servers';

export const mcpClient = {
  /** Lista los servidores MCP registrados. */
  listServers(): McpServer[] {
    try {
      const raw = localStorage.getItem(STORE_KEY);
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
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  },

  /** Elimina un servidor. */
  removeServer(id: string): void {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify(mcpClient.listServers().filter((s) => s.id !== id)),
    );
  },

  /** Lista las tools expuestas por todos los servidores habilitados. */
  async listTools(): Promise<McpTool[]> {
    // TODO Fase 6: lanzar cada servidor stdio y pedir `tools/list` JSON-RPC.
    return [];
  },

  /** Invoca una tool MCP por nombre. */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // TODO Fase 6
    throw new Error(`MCP callTool(${name}) no implementado aún`);
  },
};
