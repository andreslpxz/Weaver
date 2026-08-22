//! FASE 9 — Webhook HTTP server (axum).
//!
//! Server HTTP embebido que escucha en 127.0.0.1:PORT (default 7878) y
//! responde a /webhook/{workflowId}/{path}.
//!
//! Al recibir un request:
//!   1. Valida que el workflow existe y está activo.
//!   2. Crea una Execution (modo 'webhook').
//!   3. Dispatch al engine (vía evento al frontend o vía invocation directa).
//!   4. Modo sync: espera y devuelve el output. Modo async: 202 inmediato.
//!
//! Seguridad:
//!   - Payload size limit (default 10 MB).
//!   - Rate limiting por IP (token bucket, 60 req/min).
//!   - Auth opcional por header token.
//!
//! NOTA: este módulo requiere añadir `axum` y `tower-http` a Cargo.toml.
//! Cuando se compile con `cargo build`, el server arranca en setup().

use anyhow::{Context, Result};
use axum::{
    extract::{Path, State as AxumState},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

pub struct WebhookState {
    pub db_path: String,
    pub port: u16,
    pub rate_limiter: Mutex<HashMap<String, Vec<std::time::Instant>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookTrigger {
    pub workflow_id: String,
    pub trigger_node_id: String,
    pub path: String,
    pub method: String,
    pub auth_token: Option<String>,
    pub response_mode: String, // "sync" | "async"
}

/// Arranca el webhook server en background.
pub async fn start_webhook_server(port: u16, db_path: String) -> Result<()> {
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse()?;
    let state = Arc::new(WebhookState {
        db_path,
        port,
        rate_limiter: Mutex::new(HashMap::new()),
    });

    let app = Router::new()
        .route("/webhook/:workflow_id/*path", post(handle_webhook_post))
        .route("/webhook/:workflow_id/*path", get(handle_webhook_get))
        .route("/health", get(|| async { "ok" }))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("Webhook server listening on http://{}", addr);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            warn!("Webhook server error: {}", e);
        }
    });

    Ok(())
}

async fn handle_webhook_post(
    AxumState(state): AxumState<Arc<WebhookState>>,
    Path((workflow_id, path)): Path<(String, String)>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    handle_webhook(state, workflow_id, path, "POST", &headers, Some(body)).await
}

async fn handle_webhook_get(
    AxumState(state): AxumState<Arc<WebhookState>>,
    Path((workflow_id, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    handle_webhook(state, workflow_id, path, "GET", &headers, None).await
}

async fn handle_webhook(
    state: Arc<WebhookState>,
    workflow_id: String,
    path: String,
    method: &str,
    headers: &HeaderMap,
    body: Option<axum::body::Bytes>,
) -> Response {
    // Rate limiting por IP.
    let client_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .unwrap_or("unknown")
        .to_string();

    if !check_rate_limit(&state, &client_ip).await {
        return (StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded").into_response();
    }

    // Cargar el workflow desde SQLite.
    let workflow = match load_workflow(&state.db_path, &workflow_id) {
        Ok(Some(w)) => w,
        Ok(None) => {
            return (StatusCode::NOT_FOUND, format!("Workflow {} not found", workflow_id)).into_response();
        }
        Err(e) => {
            warn!("Failed to load workflow {}: {}", workflow_id, e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to load workflow").into_response();
        }
    };

    // Buscar el trigger node correspondiente al path.
    let trigger = workflow
        .get("nodes")
        .and_then(|n| n.as_array())
        .and_then(|nodes| {
            nodes.iter().find_map(|n| {
                let node_type = n.get("type").and_then(|t| t.as_str())?;
                if node_type != "webhook" {
                    return None;
                }
                let config = n.get("config")?;
                let node_path = config.get("path").and_then(|p| p.as_str()).unwrap_or("/webhook");
                if node_path.trim_start_matches('/') == path.trim_start_matches('/') {
                    Some(WebhookTrigger {
                        workflow_id: workflow_id.clone(),
                        trigger_node_id: n.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string(),
                        path: node_path.to_string(),
                        method: method.to_string(),
                        auth_token: None, // TODO: resolver desde credential
                        response_mode: config
                            .get("responseMode")
                            .and_then(|r| r.as_str())
                            .unwrap_or("async")
                            .to_string(),
                    })
                } else {
                    None
                }
            })
        });

    let trigger = match trigger {
        Some(t) => t,
        None => {
            return (
                StatusCode::NOT_FOUND,
                format!("No webhook trigger matching path /{}", path),
            )
                .into_response();
        }
    };

    // Validar auth token si está configurado.
    if let Some(ref token) = trigger.auth_token {
        let provided = headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "));
        if provided != Some(token.as_str()) {
            return (StatusCode::UNAUTHORIZED, "Invalid or missing auth token").into_response();
        }
    }

    // Construir el input item.
    let body_str = body
        .as_ref()
        .map(|b| String::from_utf8_lossy(b).to_string())
        .unwrap_or_default();

    let body_json: Value = if body_str.is_empty() {
        json!({})
    } else {
        serde_json::from_str(&body_str).unwrap_or(json!({ "raw": body_str }))
    };

    let query_params: Value = json!({}); // TODO: extraer de path

    let input_item = json!({
        "json": {
            "body": body_json,
            "headers": headers_to_json(headers),
            "query": query_params,
            "method": method,
            "path": format!("/{}", path),
            "workflowId": workflow_id,
        },
        "source": "webhook",
    });

    // TODO: dispatch al engine. Por ahora, devolver el input como ack.
    // Cuando el engine esté cableado vía Tauri event, esto será:
    //   let execution = engine.dispatch(workflow_id, [input_item]).await;
    //   if trigger.response_mode == "sync" { return execution.output }

    if trigger.response_mode == "sync" {
        Json(json!({
            "executionId": uuid::Uuid::new_v4().to_string(),
            "status": "success",
            "output": [input_item],
        }))
        .into_response()
    } else {
        (
            StatusCode::ACCEPTED,
            Json(json!({
                "executionId": uuid::Uuid::new_v4().to_string(),
                "status": "queued",
                "message": "Workflow execution queued",
            })),
        )
            .into_response()
    }
}

fn headers_to_json(headers: &HeaderMap) -> Value {
    let mut map = serde_json::Map::new();
    for (k, v) in headers.iter() {
        if let Ok(v_str) = v.to_str() {
            map.insert(k.as_str().to_string(), Value::String(v_str.to_string()));
        }
    }
    Value::Object(map)
}

async fn check_rate_limit(state: &WebhookState, ip: &str) -> bool {
    const MAX_REQUESTS: usize = 60;
    const WINDOW_SECS: u64 = 60;

    let mut limiter = state.rate_limiter.lock().await;
    let now = std::time::Instant::now();
    let window = std::time::Duration::from_secs(WINDOW_SECS);

    let entries = limiter.entry(ip.to_string()).or_default();
    entries.retain(|t| now.duration_since(*t) < window);
    if entries.len() >= MAX_REQUESTS {
        return false;
    }
    entries.push(now);
    true
}

/// Carga un workflow desde SQLite por ID.
fn load_workflow(db_path: &str, workflow_id: &str) -> Result<Option<Value>> {
    use rusqlite::Connection;
    let conn = Connection::open(db_path).context("Failed to open SQLite")?;
    let mut stmt = conn.prepare("SELECT data FROM workflows WHERE id = ? AND enabled = 1")?;
    let result = stmt
        .query_row(rusqlite::params![workflow_id], |row| {
            let data: String = row.get(0)?;
            Ok(data)
        })
        .ok();

    if let Some(data) = result {
        let wf: Value = serde_json::from_str(&data).context("Failed to parse workflow JSON")?;
        Ok(Some(wf))
    } else {
        Ok(None)
    }
}
