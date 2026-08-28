import { useEffect, useState } from 'react';
import { Workflow as WorkflowIcon, Plus, Trash2, Pencil, Check, X, Power, Clock, Upload, Download, Share2, ListChecks, Sparkles } from 'lucide-react';
import { Button, Badge } from '@/components/common/Button';
import { useWeaver } from '@/store/weaver';
import {
  listWorkflows,
  onWorkflowsChanged,
  createWorkflow,
  deleteWorkflow,
  renameWorkflow,
  setWorkflowEnabled,
  importWorkflow,
} from '@/workflows/store';
import type { Workflow, WorkflowNode, WorkflowEdge } from '@/workflows/types';
import { buildTransfer, parseTransfer, pickJsonFiles, downloadJson, shareJson } from '@/lib/transfer';

// ============================================================================
// Plantillas de workflow — acciones rápidas para el empty state.
// Cada plantilla crea un workflow con un grafo mínimo funcional.
// ============================================================================

function node(type: WorkflowNode['type'], label: string, x: number, y: number, config: Record<string, unknown> = {}): WorkflowNode {
  return { id: crypto.randomUUID(), type, label, position: { x, y }, config };
}

function edge(source: WorkflowNode, target: WorkflowNode): WorkflowEdge {
  return { id: crypto.randomUUID(), source: source.id, target: target.id };
}

const WORKFLOW_TEMPLATES: Array<{ name: string; desc: string; build: () => { nodes: WorkflowNode[]; edges: WorkflowEdge[] } }> = [
  {
    name: 'Recordatorio manual',
    desc: 'Click → mensaje de aviso en el chat',
    build: () => {
      const a = node('manual', 'Trigger manual', 60, 100);
      const b = node('chat_message', 'Avisar', 320, 100, { message: '⏰ Este es tu recordatorio.' });
      return { nodes: [a, b], edges: [edge(a, b)] };
    },
  },
  {
    name: 'HTTP programado',
    desc: 'Todos los días → petición a una API',
    build: () => {
      const a = node('schedule', 'Cada día 9:00', 60, 100, { time: '09:00', recurrence: 'daily' });
      const b = node('http_request', 'Llamar API', 320, 100, { method: 'GET', url: 'https://api.ejemplo.com/datos' });
      return { nodes: [a, b], edges: [edge(a, b)] };
    },
  },
  {
    name: 'Resumen con LLM',
    desc: 'Click → un LLM resume el texto de entrada',
    build: () => {
      const a = node('manual', 'Trigger manual', 60, 100);
      const b = node('llm', 'Resumir', 320, 100, { prompt: 'Resume el siguiente texto en 3 puntos:' });
      return { nodes: [a, b], edges: [edge(a, b)] };
    },
  },
];

export function WorkflowsView() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Modo multi-selección + ids seleccionados.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const setActiveWorkflowId = useWeaver((s) => s.setActiveWorkflowId);
  const setView = useWeaver((s) => s.setView);

  useEffect(() => {
    setWorkflows(listWorkflows());
    return onWorkflowsChanged(() => setWorkflows(listWorkflows()));
  }, []);

  // Auto-apagar el toast.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function openWorkflow(id: string) {
    if (selectMode) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      return;
    }
    setActiveWorkflowId(id);
    setView('workflow-editor');
  }

  function handleCreate() {
    const wf = createWorkflow(newName || 'Nuevo workflow');
    setNewName('');
    setCreating(false);
    openWorkflow(wf.id);
  }

  function handleCreateFromTemplate(tpl: (typeof WORKFLOW_TEMPLATES)[number]) {
    const { nodes, edges } = tpl.build();
    const wf = importWorkflow({ name: tpl.name, nodes, edges, enabled: true });
    setActiveWorkflowId(wf.id);
    setView('workflow-editor');
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`¿Eliminar el workflow "${name}"? Esta acción no se puede deshacer.`)) return;
    deleteWorkflow(id);
  }

  function commitRename(id: string) {
    if (renameValue.trim()) renameWorkflow(id, renameValue.trim());
    setRenamingId(null);
  }

  // --- Importar / Exportar / Compartir ---
  async function handleImport() {
    try {
      const contents = await pickJsonFiles();
      if (contents.length === 0) return;
      let count = 0;
      for (const raw of contents) {
        const items = parseTransfer('workflow', raw);
        for (const item of items) {
          importWorkflow(item as Partial<Workflow>);
          count++;
        }
      }
      setToast(`✓ ${count} workflow${count !== 1 ? 's' : ''} importado${count !== 1 ? 's' : ''}`);
    } catch (e) {
      alert(`No se pudo importar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function exportWorkflows(list: Workflow[]) {
    if (list.length === 0) return;
    const payload = buildTransfer('workflow', list.map((w) => ({ ...w })));
    const base = list.length === 1 ? list[0].name : `weaver-workflows-${list.length}`;
    downloadJson(base, payload);
    setToast('✓ Exportado como JSON');
  }

  async function shareWorkflows(list: Workflow[]) {
    if (list.length === 0) return;
    const payload = buildTransfer('workflow', list.map((w) => ({ ...w })));
    const base = list.length === 1 ? list[0].name : `weaver-workflows-${list.length}`;
    const result = await shareJson(base, payload);
    setToast(result === 'copied' ? '✓ JSON copiado al portapapeles — pégalo donde quieras compartirlo' : result === 'shared' ? '✓ Compartido' : '✓ Descargado para compartir');
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function deleteSelected() {
    const n = selected.size;
    if (n === 0) return;
    if (!confirm(`¿Eliminar ${n} workflow${n !== 1 ? 's' : ''} seleccionado${n !== 1 ? 's' : ''}?`)) return;
    for (const id of selected) deleteWorkflow(id);
    exitSelectMode();
  }

  const selectedWorkflows = workflows.filter((w) => selected.has(w.id));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-medium flex items-center gap-2">
            <WorkflowIcon size={26} className="text-accent" /> Workflows
          </h1>
          <div className="flex items-center gap-1.5">
            <Button onClick={handleImport} title="Importar desde archivo JSON">
              <Upload size={13} className="mr-1" /> Importar
            </Button>
            <Button
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={selectMode ? '!text-accent' : ''}
              title="Seleccionar varios a la vez"
            >
              <ListChecks size={13} className="mr-1" /> {selectMode ? 'Cancelar' : 'Seleccionar'}
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} className="mr-1" /> Nuevo
            </Button>
          </div>
        </div>
        <p className="text-text-secondary text-sm mb-6">
          Crea automatizaciones visuales tipo n8n: arrastra nodos a mano o pídele al agente,
          en el chat de cada workflow, que los construya y conecte por ti en tiempo real.
        </p>

        {/* Barra de acciones multi-selección */}
        {selectMode && (
          <div className="codex-card p-2.5 mb-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-secondary text-xs mr-1">
              {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
            </span>
            <Button onClick={() => exportWorkflows(selectedWorkflows)} disabled={selected.size === 0}>
              <Download size={12} className="mr-1" /> Exportar
            </Button>
            <Button onClick={() => void shareWorkflows(selectedWorkflows)} disabled={selected.size === 0}>
              <Share2 size={12} className="mr-1" /> Compartir
            </Button>
            <Button onClick={deleteSelected} disabled={selected.size === 0} className="!text-danger">
              <Trash2 size={12} className="mr-1" /> Eliminar
            </Button>
            {workflows.length > 0 && (
              <Button
                onClick={() => setSelected(new Set(workflows.map((w) => w.id)))}
                disabled={selected.size === workflows.length}
                className="ml-auto"
              >
                Todos
              </Button>
            )}
          </div>
        )}

        {toast && (
          <div className="mb-4 px-3 py-2 rounded-codex border border-accent/30 bg-accent/10 text-accent text-xs">
            {toast}
          </div>
        )}

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
          /* Empty state anclado arriba (no centrado flotante) con plantillas */
          <div>
            <div className="text-sm text-text-muted px-5 py-4 border border-dashed border-border rounded-codex">
              Aún no tienes workflows. Crea uno desde cero o parte de una plantilla:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
              {WORKFLOW_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  onClick={() => handleCreateFromTemplate(tpl)}
                  className="codex-card p-3 text-left hover:border-accent/50 transition-colors group"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                    <Sparkles size={12} className="text-accent" />
                    {tpl.name}
                  </div>
                  <div className="text-[11px] text-text-muted mt-1">{tpl.desc}</div>
                  <div className="text-[10px] text-accent mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    Crear →
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className={
                  'codex-card p-3 transition-colors' +
                  (selected.has(wf.id) ? ' !border-accent/60 bg-accent/5' : '')
                }
              >
                <div className="flex items-start justify-between gap-3">
                  {/* Checkbox de selección en modo seleccionar */}
                  {selectMode && (
                    <button
                      onClick={() => toggleSelect(wf.id)}
                      className={
                        'flex h-4 w-4 mt-1 shrink-0 items-center justify-center rounded border transition-colors ' +
                        (selected.has(wf.id) ? 'border-accent bg-accent text-app-bg' : 'border-border-accent')
                      }
                      title="Seleccionar"
                    >
                      {selected.has(wf.id) && <Check size={10} />}
                    </button>
                  )}
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => openWorkflow(wf.id)}
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
                      onClick={() => void shareWorkflows([wf])}
                      className="codex-icon-btn w-7 h-7"
                      title="Compartir (Web Share o copiar JSON)"
                    >
                      <Share2 size={12} />
                    </button>
                    <button
                      onClick={() => exportWorkflows([wf])}
                      className="codex-icon-btn w-7 h-7"
                      title="Exportar a JSON"
                    >
                      <Download size={12} />
                    </button>
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
