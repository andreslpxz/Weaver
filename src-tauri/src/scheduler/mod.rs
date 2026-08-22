//! FASE 10 — Scheduler runtime (cron).
//!
//! Lee los nodos `schedule` de workflows activos desde SQLite y los
//! registra como timers tokio. Cuando llega el momento, dispara una
//! Execution (modo 'schedule').
//!
//! Reusa la infraestructura de webhooks (load_workflow + dispatch al engine).

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

pub struct SchedulerState {
    pub db_path: String,
    pub timers: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>, // trigger_node_id → task
}

/// Arranca el scheduler en background.
pub async fn start_scheduler(db_path: String) -> Result<Arc<SchedulerState>> {
    let state = Arc::new(SchedulerState {
        db_path,
        timers: Mutex::new(HashMap::new()),
    });

    info!("Workflow scheduler started");

    // Spawn un loop que cada 60s recarga los schedules activos.
    let state_clone = Arc::clone(&state);
    tokio::spawn(async move {
        loop {
            if let Err(e) = reload_schedules(&state_clone).await {
                warn!("Failed to reload schedules: {}", e);
            }
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
    });

    Ok(state)
}

async fn reload_schedules(state: &Arc<SchedulerState>) -> Result<()> {
    // Cargar todos los workflows activos desde SQLite.
    let workflows = load_active_workflows(&state.db_path)?;

    let mut timers = state.timers.lock().await;

    // Cancelar timers que ya no existen.
    let active_node_ids: std::collections::HashSet<String> = workflows
        .iter()
        .flat_map(|wf| {
            wf.nodes
                .iter()
                .filter(|n| n.node_type == "schedule")
                .map(|n| n.id.clone())
                .collect::<Vec<_>>()
        })
        .collect();

    let to_remove: Vec<String> = timers
        .keys()
        .filter(|k| !active_node_ids.contains(k.as_str()))
        .cloned()
        .collect();

    for id in to_remove {
        if let Some(handle) = timers.remove(&id) {
            handle.abort();
            info!("Cancelled schedule timer for node {}", id);
        }
    }

    // Registrar nuevos timers.
    for wf in &workflows {
        for node in &wf.nodes {
            if node.node_type != "schedule" {
                continue;
            }
            if timers.contains_key(&node.id) {
                continue;
            }

            let cron_expr = node
                .config
                .get("cronExpr")
                .and_then(|v| v.as_str())
                .unwrap_or("0 * * * *")
                .to_string(); // default: cada hora

            let timezone = node
                .config
                .get("timezone")
                .and_then(|v| v.as_str())
                .unwrap_or("UTC")
                .to_string();

            let workflow_id = wf.id.clone();
            let trigger_node_id = node.id.clone();

            let state_clone = Arc::clone(state);
            let cron_expr_clone = cron_expr.clone();
            let timezone_clone = timezone.clone();
            let handle = tokio::spawn(async move {
                run_cron_schedule(state_clone, workflow_id, trigger_node_id, cron_expr_clone, timezone_clone).await;
            });

            timers.insert(node.id.clone(), handle);
            info!(
                "Registered schedule: workflow {} node {} cron='{}' tz='{}'",
                wf.id, node.id, cron_expr, timezone
            );
        }
    }

    Ok(())
}

async fn run_cron_schedule(
    state: Arc<SchedulerState>,
    workflow_id: String,
    trigger_node_id: String,
    cron_expr: String,
    timezone: String,
) {
    // Parsear la cron expression.
    // Usar la crate `cron` para parsear.
    // Si no está disponible, hacer un parse simple de 5 campos.

    loop {
        let next = match next_cron_time(&cron_expr, &timezone) {
            Ok(t) => t,
            Err(e) => {
                warn!(
                    "Invalid cron expression '{}' for node {}: {}",
                    cron_expr, trigger_node_id, e
                );
                return;
            }
        };

        let now = Utc::now();
        let duration = if next > now {
            (next - now).to_std().unwrap_or(std::time::Duration::from_secs(60))
        } else {
            std::time::Duration::from_secs(60)
        };

        tokio::time::sleep(duration).await;

        // Disparar execution.
        info!(
            "Schedule fired: workflow {} node {}",
            workflow_id, trigger_node_id
        );

        // TODO: dispatch al engine.
        // Por ahora, sólo log.
        let _ = &state;
    }
}

/// Calcula la próxima vez que la cron expression debe dispararse.
fn next_cron_time(cron_expr: &str, _timezone: &str) -> Result<DateTime<Utc>> {
    // Parse simplificado: 5 campos (min hour dom month dow).
    let parts: Vec<&str> = cron_expr.split_whitespace().collect();
    if parts.len() != 5 {
        return Err(anyhow::anyhow!(
            "Cron expression must have 5 fields, got {}",
            parts.len()
        ));
    }

    // Por ahora,简化: si es "0 9 * * *", devolver mañana a las 9:00 UTC.
    // En producción, usar la crate `cron` para parsear correctamente.
    let minute: u32 = parts[0].parse().unwrap_or(0);
    let hour: u32 = parts[1].parse().unwrap_or(0);

    let now = Utc::now();
    let mut next = now
        .with_timezone(&chrono::FixedOffset::east_opt(0).unwrap())
        .date_naive()
        .and_hms_opt(hour, minute, 0)
        .map(|dt| DateTime::<Utc>::from_naive_utc_and_offset(dt, Utc))
        .unwrap_or(now);

    if next <= now {
        next = next + chrono::Duration::days(1);
    }

    Ok(next)
}

#[derive(Debug, Clone)]
pub struct WorkflowScheduleDef {
    pub id: String,
    pub nodes: Vec<WorkflowNodeDef>,
}

#[derive(Debug, Clone)]
pub struct WorkflowNodeDef {
    pub id: String,
    pub node_type: String,
    pub config: serde_json::Value,
}

/// Carga workflows activos desde SQLite.
fn load_active_workflows(db_path: &str) -> Result<Vec<WorkflowScheduleDef>> {
    use rusqlite::Connection;
    let conn = Connection::open(db_path).context("Failed to open SQLite")?;

    let mut stmt = match conn.prepare("SELECT id, data FROM workflows WHERE enabled = 1") {
        Ok(s) => s,
        Err(_) => {
            // Tabla no existe todavía (FASE 2 pendiente).
            return Ok(Vec::new());
        }
    };

    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let data: String = row.get(1)?;
            Ok((id, data))
        })
        .context("Failed to query workflows")?;

    let mut workflows = Vec::new();
    for row in rows {
        let (id, data) = row?;
        let wf_json: serde_json::Value = match serde_json::from_str(&data) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let nodes: Vec<WorkflowNodeDef> = wf_json
            .get("nodes")
            .and_then(|n| n.as_array())
            .map(|nodes| {
                nodes
                    .iter()
                    .map(|n| WorkflowNodeDef {
                        id: n.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        node_type: n.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        config: n.get("config").cloned().unwrap_or(serde_json::Value::Null),
                    })
                    .collect()
            })
            .unwrap_or_default();

        workflows.push(WorkflowScheduleDef { id, nodes });
    }

    Ok(workflows)
}
