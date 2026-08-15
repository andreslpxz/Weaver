-- FASE 14 — Executions persistence.

CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_version_id TEXT,
    status TEXT NOT NULL,               -- queued, running, waiting, success, failed, cancelled, timeout
    mode TEXT NOT NULL,                 -- manual, trigger, webhook, schedule, subworkflow
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    input_json TEXT,                    -- JSON array of ExecutionItem
    output_json TEXT,                   -- JSON array of ExecutionItem
    error_json TEXT,                    -- JSON StructuredError
    metadata_json TEXT,
    parent_execution_id TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_executions_workflow ON executions(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_started ON executions(started_at DESC);

-- Node executions (una fila por nodo ejecutado dentro de una execution).
CREATE TABLE IF NOT EXISTS node_executions (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    node_type TEXT NOT NULL,
    node_version INTEGER NOT NULL,
    status TEXT NOT NULL,               -- success, error, skipped, waiting
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    duration_ms INTEGER,
    input_json TEXT,                    -- JSON array of ExecutionItem
    output_json TEXT,                   -- JSON array of ExecutionItem
    error_json TEXT,                    -- JSON StructuredError
    attempts INTEGER NOT NULL DEFAULT 1,
    retry_of TEXT,
    outputs_by_handle_json TEXT,
    metadata_json TEXT,
    FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_node_exec_execution ON node_executions(execution_id);
CREATE INDEX IF NOT EXISTS idx_node_exec_node ON node_executions(node_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_exec_status ON node_executions(status);
