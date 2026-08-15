//! Persistencia SQLite: memoria episódica, semántica, conversaciones y proyectos.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct DbState(pub Mutex<Connection>);

pub fn db_path() -> Result<PathBuf> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home).join(".weaver");
    std::fs::create_dir_all(&dir).context("no se pudo crear ~/.weaver")?;
    Ok(dir.join("memory.db"))
}

pub fn open() -> Result<DbState> {
    let path = db_path()?;
    let conn = Connection::open(path).context("no se pudo abrir SQLite")?;
    conn.execute_batch(MIGRATIONS).context("migrations")?;
    // Aplicar migraciones ALTER una por una: SQLite no soporta
    // ADD COLUMN IF NOT EXISTS, así que ignoramos "duplicate column name".
    for stmt in MIGRATIONS_ALTER.split(';') {
        let trimmed = stmt.trim();
        if trimmed.is_empty() { continue; }
        let _ = conn.execute_batch(trimmed); // ignorar error si la columna ya existe
    }
    Ok(DbState(Mutex::new(conn)))
}

const MIGRATIONS: &str = r#"
CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    objective TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    outcome TEXT NOT NULL,
    lessons_json TEXT,
    skill_generated TEXT,
    project_id TEXT
);
CREATE TABLE IF NOT EXISTS facts (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    source TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    ts INTEGER NOT NULL,
    attachments_json TEXT,
    reasoning TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY,
    description TEXT,
    triggers_json TEXT,
    tools_required_json TEXT,
    body TEXT,
    source TEXT,
    file_path TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_msgs ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_proj ON conversations(project_id);

-- ===================== ME: Calendario + utilidades de vida =====================
CREATE TABLE IF NOT EXISTS me_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    calendar_id TEXT NOT NULL DEFAULT 'personal',
    start_ts INTEGER NOT NULL,
    end_ts INTEGER NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    color TEXT,
    recurrence TEXT,
    reminder_minutes INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_me_events_start ON me_events(start_ts);
CREATE INDEX IF NOT EXISTS idx_me_events_cal ON me_events(calendar_id);

CREATE TABLE IF NOT EXISTS me_calendars (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS me_tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    notes TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    due_ts INTEGER,
    list_id TEXT NOT NULL DEFAULT 'inbox',
    created_at INTEGER NOT NULL,
    completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_me_tasks_list ON me_tasks(list_id);
CREATE INDEX IF NOT EXISTS idx_me_tasks_due ON me_tasks(due_ts);

CREATE TABLE IF NOT EXISTS me_notes (
    id TEXT PRIMARY KEY,
    title TEXT,
    body TEXT NOT NULL,
    color TEXT,
    tags_json TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS me_health (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    unit TEXT,
    ts INTEGER NOT NULL,
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_me_health_ts ON me_health(ts);

CREATE TABLE IF NOT EXISTS me_shopping (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    qty TEXT,
    category TEXT,
    checked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    checked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_me_shopping_list ON me_shopping(list_id);

CREATE TABLE IF NOT EXISTS me_weather_cache (
    location TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS me_integrations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    config_json TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

-- ===================== Colaboración: miembros de proyecto =====================
-- Un proyecto puede tener N miembros. Cada miembro tiene su propio
-- proveedor + modelo (la API key vive en el keyring del OS, bajo
-- provider_id = "member:<member_id>"). Así cada quien paga su consumo.
-- Las conversaciones pueden aislarse por miembro (carpetas privadas).
CREATE TABLE IF NOT EXISTS project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    provider_id TEXT,
    model_id TEXT,
    role TEXT NOT NULL DEFAULT 'member',              -- 'owner' | 'admin' | 'member' | 'viewer'
    can_run_agent INTEGER NOT NULL DEFAULT 1,
    can_edit_files INTEGER NOT NULL DEFAULT 1,
    can_use_shell INTEGER NOT NULL DEFAULT 0,
    can_see_other_chats INTEGER NOT NULL DEFAULT 0,
    can_manage_members INTEGER NOT NULL DEFAULT 0,
    password_hash TEXT,                                -- gate local opcional por miembro
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_members_project ON project_members(project_id);
"#;

/// Migraciones ALTER para DBs existentes. SQLite no soporta
/// `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, así que las ejecutamos una por
/// una e ignoramos el error "duplicate column name". Esto hace que la misma
/// db funcione tanto si se creó antes como después de añadir estas columnas.
const MIGRATIONS_ALTER: &str = r#"
ALTER TABLE projects ADD COLUMN password_hash TEXT;
ALTER TABLE projects ADD COLUMN agent_execution_scope TEXT DEFAULT 'local';
ALTER TABLE conversations ADD COLUMN owner_member_id TEXT;
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Episode {
    pub id: String,
    pub objective: String,
    pub plan_json: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub outcome: String,
    pub lessons_json: Option<String>,
    pub skill_generated: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fact {
    pub key: String,
    pub value: String,
    pub source: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
    /// Hash de contraseña opcional del proyecto (gate local).
    pub password_hash: Option<String>,
    /// 'local' | 'owner_only' | 'each_user' — dónde corren los tools del agent.
    pub agent_execution_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Si está fijado, la conversación es privada del miembro indicado
    /// (aislamiento tipo "carpeta" dentro del proyecto).
    pub owner_member_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub ts: i64,
    pub attachments_json: Option<String>,
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRow {
    pub name: String,
    pub description: String,
    pub triggers_json: String,
    pub tools_required_json: String,
    pub body: String,
    pub source: String,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMember {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub color: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub role: String,
    pub can_run_agent: bool,
    pub can_edit_files: bool,
    pub can_use_shell: bool,
    pub can_see_other_chats: bool,
    pub can_manage_members: bool,
    pub password_hash: Option<String>,
    pub created_at: i64,
}

// ============================================================================
// Episodios
// ============================================================================

#[tauri::command]
pub fn memory_list_episodes(state: State<'_, DbState>) -> Result<Vec<Episode>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, objective, plan_json, started_at, finished_at, outcome, lessons_json, skill_generated, project_id FROM episodes ORDER BY started_at DESC LIMIT 200")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| {
        Ok(Episode {
            id: r.get(0)?,
            objective: r.get(1)?,
            plan_json: r.get(2)?,
            started_at: r.get(3)?,
            finished_at: r.get(4)?,
            outcome: r.get(5)?,
            lessons_json: r.get(6)?,
            skill_generated: r.get(7)?,
            project_id: r.get(8)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn memory_save_episode(episode: Episode, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO episodes (id, objective, plan_json, started_at, finished_at, outcome, lessons_json, skill_generated, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![episode.id, episode.objective, episode.plan_json, episode.started_at, episode.finished_at, episode.outcome, episode.lessons_json, episode.skill_generated, episode.project_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn memory_delete_episode(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM episodes WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn memory_clear_all(state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM episodes", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM facts", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Hechos (facts)
// ============================================================================

#[tauri::command]
pub fn memory_list_facts(state: State<'_, DbState>) -> Result<Vec<Fact>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT key, value, source, updated_at FROM facts ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(Fact { key: r.get(0)?, value: r.get(1)?, source: r.get(2)?, updated_at: r.get(3)? })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn memory_set_fact(key: String, value: String, source: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("INSERT OR REPLACE INTO facts (key, value, source, updated_at) VALUES (?, ?, ?, ?)", params![key, value, source, now]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn memory_get_fact(key: String, state: State<'_, DbState>) -> Result<Option<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT value FROM facts WHERE key = ?").map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        return Ok(Some(row.get(0).map_err(|e| e.to_string())?));
    }
    Ok(None)
}

#[tauri::command]
pub fn memory_delete_fact(key: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM facts WHERE key = ?", params![key]).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Proyectos
// ============================================================================

#[tauri::command]
pub fn projects_list(state: State<'_, DbState>) -> Result<Vec<Project>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name, color, created_at, password_hash, agent_execution_scope FROM projects ORDER BY created_at ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        created_at: r.get(3)?,
        password_hash: r.get(4)?,
        agent_execution_scope: r.get(5)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn projects_create(name: String, color: Option<String>, state: State<'_, DbState>) -> Result<Project, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("INSERT INTO projects (id, name, color, created_at, password_hash, agent_execution_scope) VALUES (?, ?, ?, ?, NULL, 'local')", params![id, name, color, now]).map_err(|e| e.to_string())?;
    Ok(Project { id, name, color, created_at: now, password_hash: None, agent_execution_scope: Some("local".to_string()) })
}

#[tauri::command]
pub fn projects_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE conversations SET project_id = NULL WHERE project_id = ?", params![id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM project_members WHERE project_id = ?", params![id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn projects_rename(id: String, name: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE projects SET name = ? WHERE id = ?", params![name, id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Fija (o limpia con None) la contraseña de un proyecto. La contraseña se
/// hashea con SHA-256 + salt estático (suficiente para gate local; no es
/// un sistema de alta seguridad).
#[tauri::command]
pub fn projects_set_password(id: String, password: Option<String>, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let hash = password.map(|p| hash_password(&p));
    conn.execute("UPDATE projects SET password_hash = ? WHERE id = ?", params![hash, id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Verifica la contraseña de un proyecto. Devuelve true si no tiene contraseña
/// (acceso libre) o si la contraseña coincide.
#[tauri::command]
pub fn projects_verify_password(id: String, password: String, state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let stored: Option<String> = conn.query_row(
        "SELECT password_hash FROM projects WHERE id = ?",
        params![id],
        |r| r.get(0),
    ).ok().flatten();
    Ok(match stored {
        None => true,
        Some(h) => h == hash_password(&password),
    })
}

/// Fija el scope de ejecución del agent para un proyecto:
/// 'local' (default), 'owner_only', 'each_user'.
#[tauri::command]
pub fn projects_set_scope(id: String, scope: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE projects SET agent_execution_scope = ? WHERE id = ?", params![scope, id]).map_err(|e| e.to_string())?;
    Ok(())
}

fn hash_password(p: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    // Salt estático simple para dificultar tablas rainbow triviales.
    let salted = format!("weaver-v1|{}", p);
    salted.hash(&mut h);
    format!("{:016x}", h.finish())
}

// ============================================================================
// Miembros de proyecto (colaboración local)
// ============================================================================

fn map_member(r: &rusqlite::Row) -> rusqlite::Result<ProjectMember> {
    Ok(ProjectMember {
        id: r.get(0)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        color: r.get(3)?,
        provider_id: r.get(4)?,
        model_id: r.get(5)?,
        role: r.get(6)?,
        can_run_agent: r.get::<_, i64>(7)? != 0,
        can_edit_files: r.get::<_, i64>(8)? != 0,
        can_use_shell: r.get::<_, i64>(9)? != 0,
        can_see_other_chats: r.get::<_, i64>(10)? != 0,
        can_manage_members: r.get::<_, i64>(11)? != 0,
        password_hash: r.get(12)?,
        created_at: r.get(13)?,
    })
}

const MEMBER_COLS: &str = "id, project_id, name, color, provider_id, model_id, role, can_run_agent, can_edit_files, can_use_shell, can_see_other_chats, can_manage_members, password_hash, created_at";

#[tauri::command]
pub fn members_list(project_id: String, state: State<'_, DbState>) -> Result<Vec<ProjectMember>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let sql = format!("SELECT {} FROM project_members WHERE project_id = ? ORDER BY created_at ASC", MEMBER_COLS);
    let mut s = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = s.query_map(params![project_id], map_member).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn members_create(member: ProjectMember, state: State<'_, DbState>) -> Result<ProjectMember, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute(
        "INSERT INTO project_members (id, project_id, name, color, provider_id, model_id, role, can_run_agent, can_edit_files, can_use_shell, can_see_other_chats, can_manage_members, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            member.id, member.project_id, member.name, member.color,
            member.provider_id, member.model_id, member.role,
            member.can_run_agent as i64, member.can_edit_files as i64,
            member.can_use_shell as i64, member.can_see_other_chats as i64,
            member.can_manage_members as i64, member.password_hash, now,
        ],
    ).map_err(|e| e.to_string())?;
    let mut out = member;
    out.created_at = now;
    Ok(out)
}

#[tauri::command]
pub fn members_update(member: ProjectMember, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE project_members SET name = ?, color = ?, provider_id = ?, model_id = ?, role = ?, can_run_agent = ?, can_edit_files = ?, can_use_shell = ?, can_see_other_chats = ?, can_manage_members = ?, password_hash = ? WHERE id = ?",
        params![
            member.name, member.color, member.provider_id, member.model_id, member.role,
            member.can_run_agent as i64, member.can_edit_files as i64,
            member.can_use_shell as i64, member.can_see_other_chats as i64,
            member.can_manage_members as i64, member.password_hash, member.id,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn members_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    // Liberar conversaciones que eran de este miembro (las hace compartidas).
    conn.execute("UPDATE conversations SET owner_member_id = NULL WHERE owner_member_id = ?", params![id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM project_members WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Fija la contraseña de un miembro (None para quitarla).
#[tauri::command]
pub fn members_set_password(id: String, password: Option<String>, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let hash = password.map(|p| hash_password(&p));
    conn.execute("UPDATE project_members SET password_hash = ? WHERE id = ?", params![hash, id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Verifica la contraseña de un miembro. true si no tiene o si coincide.
#[tauri::command]
pub fn members_verify_password(id: String, password: String, state: State<'_, DbState>) -> Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let stored: Option<String> = conn.query_row(
        "SELECT password_hash FROM project_members WHERE id = ?",
        params![id],
        |r| r.get(0),
    ).ok().flatten();
    Ok(match stored {
        None => true,
        Some(h) => h == hash_password(&password),
    })
}

// ============================================================================
// Conversaciones + mensajes
// ============================================================================

#[tauri::command]
pub fn conversations_list(project_id: Option<String>, state: State<'_, DbState>) -> Result<Vec<Conversation>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(pid) = project_id {
        let mut s = conn.prepare("SELECT id, project_id, title, created_at, updated_at, owner_member_id FROM conversations WHERE project_id = ? ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
        let rows = s.query_map(params![pid], map_conv).map_err(|e| e.to_string())?;
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    } else {
        let mut s = conn.prepare("SELECT id, project_id, title, created_at, updated_at, owner_member_id FROM conversations ORDER BY updated_at DESC").map_err(|e| e.to_string())?;
        let rows = s.query_map([], map_conv).map_err(|e| e.to_string())?;
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    }
    Ok(out)
}

fn map_conv(r: &rusqlite::Row) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: r.get(0)?,
        project_id: r.get(1)?,
        title: r.get(2)?,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
        owner_member_id: r.get(5)?,
    })
}

#[tauri::command]
pub fn conversations_create(id: String, project_id: Option<String>, title: String, state: State<'_, DbState>) -> Result<Conversation, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("INSERT INTO conversations (id, project_id, title, created_at, updated_at, owner_member_id) VALUES (?, ?, ?, ?, ?, NULL)", params![id, project_id, title, now, now]).map_err(|e| e.to_string())?;
    Ok(Conversation { id, project_id, title, created_at: now, updated_at: now, owner_member_id: None })
}

#[tauri::command]
pub fn conversations_set_project(conv_id: String, project_id: Option<String>, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE conversations SET project_id = ?, updated_at = ? WHERE id = ?", params![project_id, chrono::Utc::now().timestamp_millis(), conv_id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Fija (o limpia) el dueño de una conversación → carpeta aislada del miembro.
#[tauri::command]
pub fn conversations_set_owner(conv_id: String, member_id: Option<String>, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE conversations SET owner_member_id = ?, updated_at = ? WHERE id = ?", params![member_id, chrono::Utc::now().timestamp_millis(), conv_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn conversations_rename(id: String, title: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?", params![title, chrono::Utc::now().timestamp_millis(), id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn conversations_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM conversation_messages WHERE conversation_id = ?", params![id]).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM conversations WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn messages_list(conversation_id: String, state: State<'_, DbState>) -> Result<Vec<ConversationMessage>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, conversation_id, role, content, ts, attachments_json, reasoning FROM conversation_messages WHERE conversation_id = ? ORDER BY ts ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![conversation_id], |r| Ok(ConversationMessage { id: r.get(0)?, conversation_id: r.get(1)?, role: r.get(2)?, content: r.get(3)?, ts: r.get(4)?, attachments_json: r.get(5)?, reasoning: r.get(6)? })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn messages_save(msg: ConversationMessage, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO conversation_messages (id, conversation_id, role, content, ts, attachments_json, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?)", params![msg.id, msg.conversation_id, msg.role, msg.content, msg.ts, msg.attachments_json, msg.reasoning]).map_err(|e| e.to_string())?;
    conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", params![msg.ts, msg.conversation_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn messages_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM conversation_messages WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Skills (persistencia real)
// ============================================================================

#[tauri::command]
pub fn skills_list(state: State<'_, DbState>) -> Result<Vec<SkillRow>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT name, description, triggers_json, tools_required_json, body, source, file_path FROM skills ORDER BY name ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(SkillRow { name: r.get(0)?, description: r.get(1)?, triggers_json: r.get(2)?, tools_required_json: r.get(3)?, body: r.get(4)?, source: r.get(5)?, file_path: r.get(6)? })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn skills_save(skill: SkillRow, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT OR REPLACE INTO skills (name, description, triggers_json, tools_required_json, body, source, file_path) VALUES (?, ?, ?, ?, ?, ?, ?)", params![skill.name, skill.description, skill.triggers_json, skill.tools_required_json, skill.body, skill.source, skill.file_path]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn skills_delete(name: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM skills WHERE name = ?", params![name]).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// ME: Eventos de calendario
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeEvent {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub calendar_id: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub all_day: bool,
    pub color: Option<String>,
    pub recurrence: Option<String>,
    pub reminder_minutes: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[tauri::command]
pub fn me_events_list(state: State<'_, DbState>) -> Result<Vec<MeEvent>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, title, description, location, calendar_id, start_ts, end_ts, all_day, color, recurrence, reminder_minutes, created_at, updated_at FROM me_events ORDER BY start_ts ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(MeEvent {
        id: r.get(0)?, title: r.get(1)?, description: r.get(2)?, location: r.get(3)?,
        calendar_id: r.get(4)?, start_ts: r.get(5)?, end_ts: r.get(6)?, all_day: r.get::<_, i64>(7)? != 0,
        color: r.get(8)?, recurrence: r.get(9)?, reminder_minutes: r.get(10)?,
        created_at: r.get(11)?, updated_at: r.get(12)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn me_events_save(event: MeEvent, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO me_events (id, title, description, location, calendar_id, start_ts, end_ts, all_day, color, recurrence, reminder_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![event.id, event.title, event.description, event.location, event.calendar_id, event.start_ts, event.end_ts, event.all_day as i64, event.color, event.recurrence, event.reminder_minutes, event.created_at, event.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn me_events_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM me_events WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// ME: Calendarios (categorías)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeCalendar {
    pub id: String,
    pub name: String,
    pub color: String,
    pub visible: bool,
    pub created_at: i64,
}

#[tauri::command]
pub fn me_calendars_list(state: State<'_, DbState>) -> Result<Vec<MeCalendar>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name, color, visible, created_at FROM me_calendars ORDER BY created_at ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(MeCalendar {
        id: r.get(0)?, name: r.get(1)?, color: r.get(2)?,
        visible: r.get::<_, i64>(3)? != 0, created_at: r.get(4)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn me_calendars_save(cal: MeCalendar, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO me_calendars (id, name, color, visible, created_at) VALUES (?, ?, ?, ?, ?)",
        params![cal.id, cal.name, cal.color, cal.visible as i64, cal.created_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn me_calendars_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM me_calendars WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// ME: Tareas
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeTask {
    pub id: String,
    pub title: String,
    pub notes: Option<String>,
    pub priority: i64,
    pub done: bool,
    pub due_ts: Option<i64>,
    pub list_id: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[tauri::command]
pub fn me_tasks_list(state: State<'_, DbState>) -> Result<Vec<MeTask>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, title, notes, priority, done, due_ts, list_id, created_at, completed_at FROM me_tasks ORDER BY done ASC, priority DESC, created_at ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(MeTask {
        id: r.get(0)?, title: r.get(1)?, notes: r.get(2)?, priority: r.get(3)?,
        done: r.get::<_, i64>(4)? != 0, due_ts: r.get(5)?, list_id: r.get(6)?,
        created_at: r.get(7)?, completed_at: r.get(8)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn me_tasks_save(task: MeTask, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO me_tasks (id, title, notes, priority, done, due_ts, list_id, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![task.id, task.title, task.notes, task.priority, task.done as i64, task.due_ts, task.list_id, task.created_at, task.completed_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn me_tasks_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM me_tasks WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// ME: Notas
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeNote {
    pub id: String,
    pub title: Option<String>,
    pub body: String,
    pub color: Option<String>,
    pub tags_json: Option<String>,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[tauri::command]
pub fn me_notes_list(state: State<'_, DbState>) -> Result<Vec<MeNote>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, title, body, color, tags_json, pinned, created_at, updated_at FROM me_notes ORDER BY pinned DESC, updated_at DESC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(MeNote {
        id: r.get(0)?, title: r.get(1)?, body: r.get(2)?, color: r.get(3)?,
        tags_json: r.get(4)?, pinned: r.get::<_, i64>(5)? != 0,
        created_at: r.get(6)?, updated_at: r.get(7)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn me_notes_save(note: MeNote, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO me_notes (id, title, body, color, tags_json, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![note.id, note.title, note.body, note.color, note.tags_json, note.pinned as i64, note.created_at, note.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn me_notes_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM me_notes WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// ME: Salud (registros)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeHealth {
    pub id: String,
    pub kind: String,
    pub value: String,
    pub unit: Option<String>,
    pub ts: i64,
    pub notes: Option<String>,
}

#[tauri::command]
pub fn me_health_list(state: State<'_, DbState>) -> Result<Vec<MeHealth>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, kind, value, unit, ts, notes FROM me_health ORDER BY ts DESC LIMIT 500").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(MeHealth {
        id: r.get(0)?, kind: r.get(1)?, value: r.get(2)?, unit: r.get(3)?,
        ts: r.get(4)?, notes: r.get(5)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn me_health_save(h: MeHealth, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO me_health (id, kind, value, unit, ts, notes) VALUES (?, ?, ?, ?, ?, ?)",
        params![h.id, h.kind, h.value, h.unit, h.ts, h.notes],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn me_health_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM me_health WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// ME: Listas de compra
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeShoppingItem {
    pub id: String,
    pub list_id: String,
    pub name: String,
    pub qty: Option<String>,
    pub category: Option<String>,
    pub checked: bool,
    pub created_at: i64,
    pub checked_at: Option<i64>,
}

#[tauri::command]
pub fn me_shopping_list(state: State<'_, DbState>) -> Result<Vec<MeShoppingItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, list_id, name, qty, category, checked, created_at, checked_at FROM me_shopping ORDER BY checked ASC, created_at ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(MeShoppingItem {
        id: r.get(0)?, list_id: r.get(1)?, name: r.get(2)?, qty: r.get(3)?,
        category: r.get(4)?, checked: r.get::<_, i64>(5)? != 0,
        created_at: r.get(6)?, checked_at: r.get(7)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn me_shopping_save(item: MeShoppingItem, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO me_shopping (id, list_id, name, qty, category, checked, created_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![item.id, item.list_id, item.name, item.qty, item.category, item.checked as i64, item.created_at, item.checked_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn me_shopping_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM me_shopping WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// ME: Integraciones nativas (correo, nube, tareas externas, etc.)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeIntegration {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub config_json: String,
    pub enabled: bool,
    pub created_at: i64,
}

#[tauri::command]
pub fn me_integrations_list(state: State<'_, DbState>) -> Result<Vec<MeIntegration>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, kind, label, config_json, enabled, created_at FROM me_integrations ORDER BY created_at ASC").map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(MeIntegration {
        id: r.get(0)?, kind: r.get(1)?, label: r.get(2)?, config_json: r.get(3)?,
        enabled: r.get::<_, i64>(4)? != 0, created_at: r.get(5)?,
    })).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

#[tauri::command]
pub fn me_integrations_save(it: MeIntegration, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO me_integrations (id, kind, label, config_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params![it.id, it.kind, it.label, it.config_json, it.enabled as i64, it.created_at],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn me_integrations_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM me_integrations WHERE id = ?", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}
