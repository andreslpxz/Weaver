import { useEffect, useState } from 'react';
import { Workflow as WorkflowIcon, Plus, Trash2, Pencil, Check, X, Power, Clock } from 'lucide-react';
import { Button, Badge } from '@/components/common/Button';
import { useWeaver } from '@/store/weaver';
import {
  listWorkflows,
  onWorkflowsChanged,
  createWorkflow,
  deleteWorkflow,
  renameWorkflow,
  setWorkflowEnabled,
} from '@/workflows/store';
import type { Workflow } from '@/workflows/types';

export function WorkflowsView() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const setActiveWorkflowId = useWeaver((s) => s.setActiveWorkflowId);
  const setView = useWeaver((s) => s.setView);

  useEffect(() => {
    setWorkflows(listWorkflows());
    return onWorkflowsChanged(() => setWorkflows(listWorkflows()));
  }, []);

  function openWorkflow(id: string) {
    setActiveWorkflowId(id);
    setView('workflow-editor');
  }

  function handleCreate() {
    const wf = createWorkflow(newName || 'Nuevo workflow');
    setNewName('');
    setCreating(false);
    openWorkflow(wf.id);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`¿Eliminar el workflow "${name}"? Esta acción no se puede deshacer.`)) return;
    deleteWorkflow(id);
  }

  function commitRename(id: string) {
    if (renameValue.trim()) renameWorkflow(id, renameValue.trim());
    setRenamingId(null);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-medium flex items-center gap-2">
            <WorkflowIcon size={26} className="text-accent" /> Workflows
          </h1>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} className="mr-1" /> Nuevo workflow
          </Button>
        </div>
        <p className="text-text-secondary text-sm mb-8">
          Crea automatizaciones visuales tipo n8n: arrastra nodos a mano o pídele al agente,
          en el chat de cada workflow, que los construya y conecte por ti en tiempo real.
        </p>

        {creating && (
          <div className="codex-card p-4 mb-6 flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Nombre del workflow (ej. Descargar y convertir audio)"
              className="codex-input flex-1 px-3 py-2 text-sm"
            />
            <Button variant="primary" onClick={handleCreate}>
              <Check size={12} /> Crear
            </Button>
            <Button onClick={() => setCreating(false)}>
              <X size={12} />
            </Button>
          </div>
        )}

        {workflows.length === 0 ? (
          <div className="text-sm text-text-muted p-8 border border-dashed border-border rounded-codex text-center">
            Aún no tienes workflows.
            <br />
            <span className="text-xs">Crea uno y descríbele al agente lo que quieres automatizar.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {workflows.map((wf) => (
              <div key={wf.id} className="codex-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => (renamingId === wf.id ? undefined : openWorkflow(wf.id))}
                  >
                    {renamingId === wf.id ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && commitRename(wf.id)}
                          className="codex-input px-2 py-1 text-sm flex-1"
                        />
                        <button onClick={() => commitRename(wf.id)} className="codex-icon-btn w-6 h-6">
                          <Check size={11} />
                        </button>
                        <button onClick={() => setRenamingId(null)} className="codex-icon-btn w-6 h-6">
                          <X size={11} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{wf.name}</span>
                        <Badge color={wf.enabled ? 'success' : 'default'}>
                          {wf.enabled ? 'Activo' : 'Pausado'}
                        </Badge>
                        {wf.lastRun && (
                          <Badge color={wf.lastRun.status === 'success' ? 'success' : wf.lastRun.status === 'error' ? 'danger' : 'warning'}>
                            Última: {wf.lastRun.status}
                          </Badge>
                        )}
                      </div>
                    )}
                    <div className="text-xs text-text-muted mt-1">
                      {wf.nodes.length} nodo{wf.nodes.length !== 1 ? 's' : ''} · {wf.edges.length} conexión{wf.edges.length !== 1 ? 'es' : ''}
                      {' · '}
                      <Clock size={10} className="inline -mt-0.5" /> {new Date(wf.updatedAt).toLocaleString()}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setWorkflowEnabled(wf.id, !wf.enabled)}
                      className="codex-icon-btn w-7 h-7"
                      title={wf.enabled ? 'Pausar' : 'Activar'}
                    >
                      <Power size={12} className={wf.enabled ? 'text-success' : 'text-text-muted'} />
                    </button>
                    <button
                      onClick={() => {
                        setRenamingId(wf.id);
                        setRenameValue(wf.name);
                      }}
                      className="codex-icon-btn w-7 h-7"
                      title="Renombrar"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(wf.id, wf.name)}
                      className="codex-icon-btn w-7 h-7"
                      title="Eliminar"
                    >
                      <Trash2 size={12} className="text-danger" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
