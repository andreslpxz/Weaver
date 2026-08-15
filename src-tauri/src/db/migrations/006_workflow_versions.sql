-- FASE 20 — Workflow versioning migration.

CREATE TABLE IF NOT EXISTS workflow_versions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,        -- JSON completo del workflow en ese momento
    label TEXT,
    created_at INTEGER NOT NULL,
    created_by TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
    UNIQUE (workflow_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_workflow_versions_wf ON workflow_versions(workflow_id, version_number DESC);
