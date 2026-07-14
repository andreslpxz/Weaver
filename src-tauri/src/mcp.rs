//! MCP (Model Context Protocol) runtime — servidor de subprocesos stdio.
//!
//! Implementación real de Fase 7. Permite a Weaver lanzar servidores MCP
//! como subprocesos, comunicarse vía JSON-RPC sobre stdin/stdout, y exponer
//! sus tools al bucle agéntico.
//!
//! Protocolo (simplificado):
//!
//! ```text
//! Weaver → Server: {"jsonrpc":"2.0","id":1,"method":"initialize",
//!                    "params":{"protocolVersion":"2024-11-05",...}}
//! Server → Weaver: {"jsonrpc":"2.0","id":1,"result":{...}}
//! Weaver → Server: {"jsonrpc":"2.0","method":"notifications/initialized"}
//! Weaver → Server: {"jsonrpc":"2.0","id":2,"method":"tools/list"}
//! Server → Weaver: {"jsonrpc":"2.0","id":2,"result":{"tools":[...]}}
//! Weaver → Server: {"jsonrpc":"2.0","id":3,"method":"tools/call",
//!                    "params":{"name":"...","arguments":{...}}}
//! Server → Weaver: {"jsonrpc":"2.0","id":3,"result":{"content":[...]}}
//! ```
//!
//! Especificación: https://spec.modelcontextprotocol.io/

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Versión del protocolo MCP soportada.
pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// Definición de un servidor MCP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerDef {
    pub id: String,
    pub name: String,
    pub transport: String, // "stdio" | "sse"
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub url: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub enabled: bool,
}

/// Tool expuesta por un servidor MCP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub server_id: String,
    pub server_name: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// Respuesta a `tools/call`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpCallResult {
    pub content: Vec<McpContent>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum McpContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { data: String, mime_type: String },
    #[serde(rename = "resource")]
    Resource { resource: Value },
}

/// Maneja un servidor MCP lanzado como subproceso stdio.
pub struct McpProcess {
    pub def: McpServerDef,
    child: Child,
    /// ID counter for JSON-RPC requests.
    next_id: u32,
    // Buffer de respuestas pendientes (muy simple: una sola en flight).
}

impl McpProcess {
    /// Lanza el servidor MCP y envía `initialize` + `notifications/initialized`.
    pub fn launch(def: McpServerDef) -> Result<Self> {
        let command = def
            .command
            .as_ref()
            .ok_or_else(|| anyhow!("servidor stdio requiere 'command'"))?;

        let mut cmd = Command::new(command);
        if let Some(args) = &def.args {
            cmd.args(args);
        }
        if let Some(env) = &def.env {
            for (k, v) in env {
                cmd.env(k, v);
            }
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let child = cmd
            .spawn()
            .with_context(|| format!("no se pudo lanzar servidor MCP: {}", command))?;

        let mut proc = Self {
            def,
            child,
            next_id: 1,
        };

        // Handshake inicial.
        let _init = proc.request(
            "initialize",
            serde_json::json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "weaver",
                    "version": env!("CARGO_PKG_VERSION"),
                }
            }),
        )?;
        proc.notify("notifications/initialized", Value::Null)?;

        Ok(proc)
    }

    /// Envía una request JSON-RPC y espera la respuesta sincrónicamente.
    /// Lee líneas de stdout hasta encontrar el `id` correspondiente.
    fn request(&mut self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;

        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let stdin = self
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow!("stdin del proceso MCP no disponible"))?;
        let line = serde_json::to_string(&req)? + "\n";
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;

        // Leer stdout línea por línea hasta encontrar respuesta con nuestro id.
        let stdout = self
            .child
            .stdout
            .as_mut()
            .ok_or_else(|| anyhow!("stdout del proceso MCP no disponible"))?;
        let mut reader = BufReader::new(stdout);

        loop {
            let mut buf = String::new();
            let n = reader.read_line(&mut buf)?;
            if n == 0 {
                return Err(anyhow!("servidor MCP cerró stdout"));
            }
            let trimmed = buf.trim();
            if trimmed.is_empty() {
                continue;
            }
            // Ignorar líneas que no son JSON (logs del servidor).
            let Ok(parsed) = serde_json::from_str::<Value>(trimmed) else {
                tracing::debug!("MCP stderr/line (no-JSON): {trimmed}");
                continue;
            };
            // ¿Es respuesta a nuestra request?
            if parsed.get("id").and_then(|v| v.as_u64()) == Some(id as u64) {
                if let Some(err) = parsed.get("error") {
                    return Err(anyhow!("MCP error: {}", err));
                }
                return Ok(parsed
                    .get("result")
                    .cloned()
                    .ok_or_else(|| anyhow!("MCP: respuesta sin 'result'"))?);
            }
            // Si es notificación entrante (sin id), la ignoramos por ahora.
        }
    }

    /// Envía una notificación JSON-RPC (sin id, sin respuesta esperada).
    fn notify(&mut self, method: &str, params: Value) -> Result<()> {
        let notif = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        let stdin = self
            .child
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow!("stdin no disponible"))?;
        let line = serde_json::to_string(&notif)? + "\n";
        stdin.write_all(line.as_bytes())?;
        stdin.flush()?;
        Ok(())
    }

    /// Pide la lista de tools al servidor.
    pub fn list_tools(&mut self) -> Result<Vec<McpTool>> {
        let result = self.request("tools/list", serde_json::json!({}))?;
        let tools_val = result
            .get("tools")
            .ok_or_else(|| anyhow!("MCP: respuesta tools/list sin 'tools'"))?;
        let raw_tools: Vec<Value> = serde_json::from_value(tools_val.clone())?;

        Ok(raw_tools
            .into_iter()
            .map(|t| McpTool {
                server_id: self.def.id.clone(),
                server_name: self.def.name.clone(),
                name: t.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                description: t
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                input_schema: t
                    .get("inputSchema")
                    .cloned()
                    .unwrap_or(Value::Object(serde_json::Map::new())),
            })
            .collect())
    }

    /// Invoca una tool del servidor.
    pub fn call_tool(&mut self, name: &str, args: Value) -> Result<McpCallResult> {
        let result = self.request(
            "tools/call",
            serde_json::json!({
                "name": name,
                "arguments": args,
            }),
        )?;
        let is_error = result
            .get("isError")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let content_val = result
            .get("content")
            .ok_or_else(|| anyhow!("MCP: tools/call sin 'content'"))?;
        let content: Vec<McpContent> = serde_json::from_value(content_val.clone())?;
        Ok(McpCallResult { content, is_error })
    }

    /// Cierra el proceso servidor gracefully.
    pub fn shutdown(&mut self) -> Result<()> {
        let _ = self.notify("notifications/cancelled", Value::Null);
        // Cerrar stdin para que el servidor termine.
        drop(self.child.stdin.take());
        let _ = self.child.wait();
        Ok(())
    }
}

impl Drop for McpProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

/// Registry de servidores MCP activos.
pub struct McpRegistry {
    processes: Arc<Mutex<HashMap<String, McpProcess>>>,
}

impl McpRegistry {
    pub fn new() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Lanza un servidor y lo registra.
    pub async fn start(&self, def: McpServerDef) -> Result<()> {
        let id = def.id.clone();
        let proc = McpProcess::launch(def)?;
        self.processes.lock().await.insert(id, proc);
        Ok(())
    }

    /// Detiene un servidor.
    pub async fn stop(&self, id: &str) -> Result<()> {
        if let Some(mut proc) = self.processes.lock().await.remove(id) {
            proc.shutdown()?;
        }
        Ok(())
    }

    /// Lista todas las tools de todos los servidores activos.
    pub async fn list_all_tools(&self) -> Vec<McpTool> {
        let mut all = Vec::new();
        let mut procs = self.processes.lock().await;
        for proc in procs.values_mut() {
            if let Ok(tools) = proc.list_tools() {
                all.extend(tools);
            }
        }
        all
    }

    /// Llama una tool en el servidor correspondiente.
    pub async fn call_tool(&self, server_id: &str, name: &str, args: Value) -> Result<McpCallResult> {
        let mut procs = self.processes.lock().await;
        let proc = procs
            .get_mut(server_id)
            .ok_or_else(|| anyhow!("servidor MCP no encontrado: {}", server_id))?;
        proc.call_tool(name, args)
    }
}

impl Default for McpRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Comandos Tauri
// ============================================================================

use tauri::State;

/// Estado global con el registry MCP.
pub struct McpState {
    pub registry: McpRegistry,
    pub servers_config: Arc<Mutex<Vec<McpServerDef>>>,
}

impl Default for McpState {
    fn default() -> Self {
        Self {
            registry: McpRegistry::new(),
            servers_config: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[tauri::command]
pub async fn mcp_list_servers(state: State<'_, McpState>) -> Result<Vec<McpServerDef>, String> {
    Ok(state.servers_config.lock().await.clone())
}

#[tauri::command]
pub async fn mcp_add_server(server: McpServerDef, state: State<'_, McpState>) -> Result<(), String> {
    state.servers_config.lock().await.push(server);
    Ok(())
}

#[tauri::command]
pub async fn mcp_remove_server(id: String, state: State<'_, McpState>) -> Result<(), String> {
    let mut cfg = state.servers_config.lock().await;
    cfg.retain(|s| s.id != id);
    drop(cfg);
    state.registry.stop(&id).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_start_server(id: String, state: State<'_, McpState>) -> Result<(), String> {
    let def = {
        let cfg = state.servers_config.lock().await;
        cfg.iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| format!("servidor no encontrado: {id}"))?
    };
    state
        .registry
        .start(def)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_list_tools(state: State<'_, McpState>) -> Result<Vec<McpTool>, String> {
    Ok(state.registry.list_all_tools().await)
}

#[tauri::command]
pub async fn mcp_call_tool(
    server_id: String,
    name: String,
    args: Value,
    state: State<'_, McpState>,
) -> Result<McpCallResult, String> {
    state
        .registry
        .call_tool(&server_id, &name, args)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_generate_id() -> Result<String, String> {
    Ok(Uuid::new_v4().to_string())
}
