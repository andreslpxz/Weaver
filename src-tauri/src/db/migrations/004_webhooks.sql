-- FASE 9 — Webhook triggers migration.
-- Registra los triggers activos para que el webhook server sepa qué rutas servir.

CREATE TABLE IF NOT EXISTS active_workflow_triggers (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    trigger_node_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,         -- 'webhook' | 'schedule' | 'event'
    config TEXT NOT NULL,                -- JSON: {path, method, cronExpr, ...}
    auth_credential_id TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_active_triggers_workflow ON active_workflow_triggers(workflow_id);
CREATE INDEX IF NOT EXISTS idx_active_triggers_type ON active_workflow_triggers(trigger_type);

-- Log de webhooks recibidos (para debugging + rate limit audit).
CREATE TABLE IF NOT EXISTS webhook_logs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    trigger_node_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    client_ip TEXT,
    payload_size INTEGER,
    execution_id TEXT,
    received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_workflow ON webhook_logs(workflow_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_ip ON webhook_logs(client_ip, received_at DESC);
