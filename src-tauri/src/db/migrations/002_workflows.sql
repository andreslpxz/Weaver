-- FASE 2 — Workflows migration.
-- Mueve workflows de localStorage a SQLite para soportar sync, queries SQL,
-- transactions y mayor cuota que localStorage.

CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL,           -- JSON completo del workflow
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflows_updated ON workflows(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled);

-- Chat lateral del workflow (separado para no ensuciar el data JSON).
CREATE TABLE IF NOT EXISTS workflow_chat_messages (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    ts INTEGER NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wf_chat_workflow ON workflow_chat_messages(workflow_id, ts);
