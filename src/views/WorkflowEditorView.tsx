import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Send,
  Play,
  Loader2,
  Plus,
  Trash2,
  Search,
  X,
  Bot,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  CheckCircle2,
  XCircle,
  SkipForward,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { useWeaver } from '@/store/weaver';
import { ModelPickerPopup } from '@/components/model-picker/ModelPickerPopup';
import { getWorkflow, saveGraph, renameWorkflow, appendChatMessage, updateLastRun } from '@/workflows/store';
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowNodeType, WorkflowChatMessage, WorkflowRunLogEntry } from '@/workflows/types';
import { WORKFLOW_NODE_LABELS } from '@/workflows/types';
import { nodeTypes, NODE_META, summarizeConfig, type WorkflowNodeData } from '@/workflows/nodeDefs';
import { buildWorkflowToolsV2 as buildWorkflowTools, dispatchWorkflowToolV2 as dispatchWorkflowTool, type WorkflowGraphController } from '@/workflows/tools_v2';
import { runWorkflow } from '@/workflows/engine';
import { ensureNodeDefinitionsLoaded, getLatestNodeDefinition } from '@/workflows/nodes/registry';
import type { NodeParameter } from '@/workflows/types/node_definition';
import { createProvider } from '@/providers';
import { streamChat } from '@/lib/chain';
import type { Message } from '@/providers/types';

// ============================================================================
// Catálogo de la paleta — agrupado como n8n pero con descripciones cortas.
// ============================================================================

const PALETTE_GROUPS: { title: string; types: WorkflowNodeType[] }[] = [
  { title: 'Disparadores', types: ['webhook', 'schedule', 'manual'] },
  { title: 'Lógica', types: ['if', 'switch', 'filter', 'delay', 'set'] },
  { title: 'Datos', types: ['code', 'http_request', 'sort', 'limit', 'split', 'merge', 'aggregate', 'loop'] },
  { title: 'IA', types: ['llm', 'ai_agent', 'structured_output', 'memory', 'tool'] },
  { title: 'Flujo y salida', types: ['execute_workflow', 'chat_message'] },
];

const PALETTE_DESC: Record<WorkflowNodeType, string> = {
  webhook: 'Se activa por HTTP POST',
  schedule: 'Corre en un horario (cron)',
  manual: 'Se activa con un click',
  code: 'JavaScript a medida',
  if: 'Divide en true / false',
  switch: 'Múltiples salidas por caso',
  filter: 'Descarta items que no cumplen',
  delay: 'Espera N milisegundos',
  set: 'Asigna o transforma campos',
  chat_message: 'Mensaje de aviso en el chat',
  http_request: 'Llama a una API REST',
  loop: 'Itera sobre cada item',
  split: 'Array → items individuales',
  merge: 'Combina varias ramas',
  aggregate: 'Items → un solo array',
  sort: 'Ordena por una clave',
  limit: 'Recorta a N items',
  execute_workflow: 'Ejecuta otro workflow',
  llm: 'Prompt a un modelo',
  ai_agent: 'Agente con tools',
  structured_output: 'JSON con schema',
  memory: 'Guarda o lee memoria',
  tool: 'Ejecuta una tool',
};

function toFlowNode(n: WorkflowNode, status?: WorkflowNodeData['status']): Node {
  return {
    id: n.id,
    type: 'workflowNode',
    position: n.position,
    data: {
      label: n.label,
      nodeType: n.type,
      configSummary: summarizeConfig(n.type, n.config),
      status: status ?? 'idle',
    } satisfies WorkflowNodeData,
  };
}

function toFlowEdge(e: WorkflowEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    animated: false,
    style: {
      strokeWidth: 2,
      stroke: e.sourceHandle === 'false' ? '#ef4444' : e.sourceHandle === 'true' ? '#22c55e' : 'var(--border-accent)',
    },
  };
}

export function WorkflowEditorView() {
  const activeWorkflowId = useWeaver((s) => s.activeWorkflowId);
  const setView = useWeaver((s) => s.setView);

  if (!activeWorkflowId) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        No hay workflow seleccionado.
        <Button onClick={() => setView('workflows')} className="ml-2">Volver</Button>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <WorkflowEditorInner workflowId={activeWorkflowId} />
    </ReactFlowProvider>
  );
}

function WorkflowEditorInner({ workflowId }: { workflowId: string }) {
  const setView = useWeaver((s) => s.setView);
  const providerId = useWeaver((s) => s.providerId);
  const modelId = useWeaver((s) => s.modelId);
  const { screenToFlowPosition } = useReactFlow();

  const [wf, setWf] = useState<Workflow | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<WorkflowRunLogEntry[]>([]);

  // UX n8n+: paleta de nodos, inspector de config y chat colapsable.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(() => localStorage.getItem('weaver:wf-chat-open') !== '0');
  const [nameDraft, setNameDraft] = useState('');
  // Tick para re-render cuando el NodeRegistry async termina de cargar
  // (el inspector lee schemas desde ahí).
  const [defTick, setDefTick] = useState(0);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Refs para que el controller de tools siempre lea/escriba el estado más
  // reciente aunque el closure del tool-call loop sea antiguo.
  const nodesRef = useRef<WorkflowNode[]>([]);
  const edgesRef = useRef<WorkflowEdge[]>([]);

  useEffect(() => {
    // Asegurar que el NodeRegistry esté cargado antes de ejecutar nada.
    void ensureNodeDefinitionsLoaded().then(() => setDefTick((t) => t + 1));
    const loaded = getWorkflow(workflowId);
    if (!loaded) return;
    setWf(loaded);
    setNameDraft(loaded.name);
    nodesRef.current = loaded.nodes;
    edgesRef.current = loaded.edges;
    setNodes(loaded.nodes.map((n) => toFlowNode(n)));
    setEdges(loaded.edges.map(toFlowEdge));
  }, [workflowId]);

  // Escape cierra paleta e inspector.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setPaletteOpen(false);
      setInspectorNodeId(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function toggleChat(open: boolean) {
    setChatOpen(open);
    localStorage.setItem('weaver:wf-chat-open', open ? '1' : '0');
  }

  // Doble click en el lienzo → paleta (d3-zoom mata el evento dblclick nativo,
  // así que lo detectamos con el timing de dos onPaneClick seguidos).
  const lastPaneClick = useRef(0);
  const onPaneClick = useCallback(() => {
    const now = Date.now();
    if (now - lastPaneClick.current < 350) {
      lastPaneClick.current = 0;
      setPaletteOpen(true);
      return;
    }
    lastPaneClick.current = now;
  }, []);

  const persist = useCallback((wfNodes: WorkflowNode[], wfEdges: WorkflowEdge[]) => {
    nodesRef.current = wfNodes;
    edgesRef.current = wfEdges;
    saveGraph(workflowId, wfNodes, wfEdges);
  }, [workflowId]);

  const domNodesToModel = useCallback((flowNodes: Node[]): WorkflowNode[] => {
    return flowNodes.map((fn) => {
      const d = fn.data as WorkflowNodeData;
      const existing = nodesRef.current.find((n) => n.id === fn.id);
      return {
        id: fn.id,
        type: d.nodeType,
        label: d.label,
        position: fn.position,
        config: existing?.config ?? {},
      };
    });
  }, []);

  const domEdgesToModel = useCallback((flowEdges: Edge[]): WorkflowEdge[] => {
    return flowEdges.map((fe) => ({
      id: fe.id,
      source: fe.source,
      target: fe.target,
      sourceHandle: (fe.sourceHandle as WorkflowEdge['sourceHandle']) ?? undefined,
    }));
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => {
      const next = applyNodeChanges(changes, nds);
      // Solo persistir en cambios de posición terminados / eliminación (no en cada pixel de drag).
      const meaningful = changes.some((c) => c.type === 'remove' || (c.type === 'position' && c.dragging === false));
      if (meaningful) persist(domNodesToModel(next), domEdgesToModel(edges));
      return next;
    });
  }, [edges, persist, domNodesToModel, domEdgesToModel]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => {
      const next = applyEdgeChanges(changes, eds);
      const meaningful = changes.some((c) => c.type === 'remove');
      if (meaningful) persist(domNodesToModel(nodes), domEdgesToModel(next));
      return next;
    });
  }, [nodes, persist, domNodesToModel, domEdgesToModel]);

  const onConnect = useCallback((conn: Connection) => {
    setEdges((eds) => {
      const next = addEdge({ ...conn, id: crypto.randomUUID(), style: { strokeWidth: 2, stroke: 'var(--border-accent)' } }, eds);
      persist(domNodesToModel(nodes), domEdgesToModel(next));
      return next;
    });
  }, [nodes, persist, domNodesToModel, domEdgesToModel]);

  /** Añade un nodo: a la derecha del seleccionado, o centrado en el viewport. */
  function addNodeAt(type: WorkflowNodeType) {
    const id = crypto.randomUUID();
    const label = WORKFLOW_NODE_LABELS[type];

    let position = { x: 240, y: 180 };
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      position = screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    // Si hay un nodo seleccionado, n8n-style: el nuevo va a su derecha.
    const selected = nodes.find((n) => n.selected);
    if (selected) {
      position = { x: selected.position.x + 300, y: selected.position.y };
    } else if (rect) {
      // Tras añadir se abre el inspector a la derecha (y la paleta puede estar
      // a la izquierda): centrar en la zona visible entre overlays.
      const cx = rect.left + rect.width / 2 + (paletteOpen ? -30 : -186);
      const p = screenToFlowPosition({ x: cx, y: rect.top + rect.height / 2 });
      position = { x: p.x, y: p.y - 40 };
    }

    const flowNode = toFlowNode({ id, type, label, position, config: {} });
    setNodes((nds) => {
      const next = [...nds, flowNode];
      persist(domNodesToModel(next), domEdgesToModel(edges));
      return next;
    });
    setPaletteOpen(false);
    setPaletteQuery('');
    // Como n8n: tras añadir, abrir su configuración.
    setInspectorNodeId(id);
  }

  /** Patch de config desde el inspector: actualiza modelo + resumen + persiste. */
  const updateNodeConfig = useCallback((id: string, patch: Record<string, unknown>) => {
    const updatedModel = nodesRef.current.map((n) =>
      n.id === id ? { ...n, config: { ...(n.config ?? {}), ...patch } } : n,
    );
    persist(updatedModel, edgesRef.current);
    setNodes((nds) =>
      nds.map((fn) => {
        if (fn.id !== id) return fn;
        const m = updatedModel.find((x) => x.id === id)!;
        return { ...fn, data: { ...(fn.data as WorkflowNodeData), configSummary: summarizeConfig(m.type, m.config) } };
      }),
    );
  }, [persist]);

  /** Renombra el label del nodo desde el inspector. */
  const updateNodeLabel = useCallback((id: string, label: string) => {
    const updatedModel = nodesRef.current.map((n) => (n.id === id ? { ...n, label } : n));
    persist(updatedModel, edgesRef.current);
    setNodes((nds) =>
      nds.map((fn) => (fn.id === id ? { ...fn, data: { ...(fn.data as WorkflowNodeData), label } } : fn)),
    );
  }, [persist]);

  /** Elimina un nodo (inspector) con sus conexiones. */
  const removeNodeById = useCallback((id: string) => {
    setNodes((nds) => {
      const next = nds.filter((n) => n.id !== id);
      setEdges((eds) => {
        const nextEdges = eds.filter((e) => e.source !== id && e.target !== id);
        persist(domNodesToModel(next), domEdgesToModel(nextEdges));
        return nextEdges;
      });
      return next;
    });
    setInspectorNodeId(null);
  }, [persist, domNodesToModel, domEdgesToModel]);

  function deleteSelected() {
    const removedIds = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    setNodes((nds) => {
      const next = nds.filter((n) => !n.selected);
      setEdges((eds) => {
        const nextEdges = eds.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target) && !e.selected);
        persist(domNodesToModel(next), domEdgesToModel(nextEdges));
        return nextEdges;
      });
      return next;
    });
    if (inspectorNodeId && removedIds.has(inspectorNodeId)) setInspectorNodeId(null);
  }

  function commitName() {
    if (!wf) return;
    const clean = nameDraft.trim();
    if (!clean || clean === wf.name) {
      setNameDraft(wf.name);
      return;
    }
    renameWorkflow(workflowId, clean);
    setWf((w) => (w ? { ...w, name: clean } : w));
  }

  // --- Controller para las tools del agente: opera sobre estado React,
  // reflejando cada cambio en el canvas al instante. ---
  const controller: WorkflowGraphController = useMemo(() => ({
    getNodes: () => nodesRef.current,
    getEdges: () => edgesRef.current,
    addNode: (node) => {
      setNodes((nds) => {
        const next = [...nds, toFlowNode(node)];
        persist(domNodesToModel(next), edgesRef.current);
        return next;
      });
    },
    updateNode: (id, patch) => {
      const updatedModel = nodesRef.current.map((n) =>
        n.id === id
          ? {
              ...n,
              label: patch.label ?? n.label,
              position: patch.position ?? n.position,
              config: patch.config ?? n.config,
            }
          : n,
      );
      persist(updatedModel, edgesRef.current);
      setNodes((nds) =>
        nds.map((fn) => {
          if (fn.id !== id) return fn;
          const m = updatedModel.find((x) => x.id === id)!;
          return {
            ...fn,
            position: m.position,
            data: {
              ...(fn.data as WorkflowNodeData),
              label: m.label,
              configSummary: summarizeConfig(m.type, m.config),
            },
          };
        }),
      );
    },
    removeNode: (id) => {
      setNodes((nds) => {
        const next = nds.filter((n) => n.id !== id);
        setEdges((eds) => {
          const nextEdges = eds.filter((e) => e.source !== id && e.target !== id);
          persist(domNodesToModel(next), domEdgesToModel(nextEdges));
          return nextEdges;
        });
        return next;
      });
    },
    addEdge: (edge) => {
      setEdges((eds) => {
        const next = [...eds, toFlowEdge(edge)];
        persist(nodesRef.current, domEdgesToModel(next));
        return next;
      });
    },
    removeEdge: (id) => {
      setEdges((eds) => {
        const next = eds.filter((e) => e.id !== id);
        persist(nodesRef.current, domEdgesToModel(next));
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [persist, domNodesToModel, domEdgesToModel]);

  async function handleRun() {
    if (!wf) return;
    setRunning(true);
    setRunLog([]);
    const current: Workflow = { ...wf, nodes: nodesRef.current, edges: edgesRef.current };
    const run = await runWorkflow(current, {
      onLog: (entry) => {
        setRunLog((l) => [...l, entry]);
        setNodes((nds) => nds.map((n) => (n.id === entry.nodeId ? { ...n, data: { ...n.data, status: entry.status === 'ok' ? 'ok' : 'error' } } : n)));
      },
    });
    updateLastRun(workflowId, run);
    setWf((w) => (w ? { ...w, lastRun: run } : w));
    setRunning(false);
  }

  // Aristas animadas mientras corre la ejecución.
  const styledEdges = useMemo(
    () => (running ? edges.map((e) => ({ ...e, animated: true })) : edges),
    [edges, running],
  );

  const hasSelection = nodes.some((n) => n.selected) || edges.some((e) => e.selected);

  if (!wf) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-sm">Cargando…</div>;
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Canvas */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-11 border-b border-border flex items-center justify-between px-3 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setView('workflows')} className="codex-icon-btn w-7 h-7" title="Volver a Workflows">
              <ArrowLeft size={14} />
            </button>
            {/* Nombre editable inline (como n8n) */}
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setNameDraft(wf.name);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="bg-transparent border border-transparent hover:border-border rounded-codex px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none focus:border-border-accent focus:bg-app-input w-[180px] transition-colors"
              title="Click para renombrar"
            />
            <span className="hidden sm:inline text-[10px] text-text-muted border border-border rounded-full px-2 py-0.5 shrink-0">
              {nodes.length} nodo{nodes.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => toggleChat(!chatOpen)}
              className={`codex-icon-btn w-7 h-7 ${chatOpen ? 'text-accent' : 'text-text-muted'}`}
              title={chatOpen ? 'Ocultar chat IA' : 'Mostrar chat IA'}
            >
              {chatOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            </button>
            <Button onClick={deleteSelected} disabled={!hasSelection} title="Eliminar nodo/conexión seleccionados">
              <Trash2 size={12} />
            </Button>
            <Button onClick={() => setPaletteOpen((v) => !v)} title="Añadir nodo (doble click en el lienzo)">
              <Plus size={12} className="mr-1" /> Nodo
            </Button>
            <Button variant="primary" onClick={handleRun} disabled={running}>
              {running ? <Loader2 size={12} className="animate-spin mr-1" /> : <Play size={12} className="mr-1" />}
              {running ? 'Ejecutando…' : 'Ejecutar'}
            </Button>
          </div>
        </header>

        {/* Contenedor del lienzo: aquí flotan paleta, inspector y empty state */}
        <div ref={canvasRef} className="flex-1 min-h-0 relative">
          <ReactFlow
            nodes={nodes}
            edges={styledEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onPaneClick={onPaneClick}
            onNodeDoubleClick={(_, node) => setInspectorNodeId(node.id)}
            nodeTypes={nodeTypes}
            fitView
            colorMode="dark"
            connectionLineStyle={{ stroke: 'var(--accent)', strokeWidth: 2 }}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={18} size={1} color="var(--border)" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              style={{ background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', width: 160, height: 100 }}
            />
          </ReactFlow>

          {/* Empty state — guía al usuario como n8n guía al trigger */}
          {nodes.length === 0 && !paletteOpen && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="pointer-events-auto flex flex-col items-center text-center px-6 py-7 rounded-2xl border border-border bg-app-elevated/80 backdrop-blur-sm shadow-xl max-w-sm">
                <div className="w-11 h-11 rounded-xl bg-accent/15 text-accent flex items-center justify-center mb-3">
                  <Sparkles size={20} />
                </div>
                <div className="text-sm font-semibold text-text-primary mb-1">Lienzo vacío</div>
                <p className="text-xs text-text-secondary leading-relaxed mb-4">
                  Empieza con un disparador (webhook, horario o manual) y conecta acciones.
                  También puedes pedírselo al agente de IA.
                </p>
                <Button variant="primary" onClick={() => setPaletteOpen(true)}>
                  <Plus size={12} className="mr-1" /> Añadir nodo
                </Button>
              </div>
            </div>
          )}

          {/* Paleta de nodos (overlay izquierdo) */}
          {paletteOpen && (
            <NodePalette
              query={paletteQuery}
              onQuery={setPaletteQuery}
              onAdd={addNodeAt}
              onClose={() => setPaletteOpen(false)}
            />
          )}

          {/* Inspector de configuración (drawer flotante derecho) */}
          {inspectorNodeId && defTick >= 0 && (
            <NodeInspector
              nodeId={inspectorNodeId}
              nodeType={(nodes.find((n) => n.id === inspectorNodeId)?.data as WorkflowNodeData | undefined)?.nodeType}
              label={(nodes.find((n) => n.id === inspectorNodeId)?.data as WorkflowNodeData | undefined)?.label ?? ''}
              config={nodesRef.current.find((n) => n.id === inspectorNodeId)?.config ?? {}}
              onConfig={updateNodeConfig}
              onLabel={updateNodeLabel}
              onDelete={removeNodeById}
              onClose={() => setInspectorNodeId(null)}
            />
          )}

          {/* Chip flotante para reabrir el chat cuando está oculto */}
          {!chatOpen && (
            <button
              onClick={() => toggleChat(true)}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 flex flex-col items-center gap-1.5 px-2 py-3 rounded-full border border-border-accent bg-app-elevated shadow-lg hover:bg-app-input hover:border-accent/50 transition-colors"
              title="Mostrar chat del agente"
            >
              <Bot size={15} className="text-accent" />
              <span className="text-[9px] font-semibold text-text-secondary [writing-mode:vertical-rl]">Chat IA</span>
            </button>
          )}
        </div>

        {/* Drawer de ejecución */}
        {runLog.length > 0 && (
          <div className="border-t border-border max-h-44 overflow-y-auto shrink-0 bg-app-sidebar">
            <div className="sticky top-0 z-10 h-8 px-3 flex items-center justify-between bg-app-sidebar border-b border-border">
              <div className="flex items-center gap-2 text-[11px] font-medium text-text-secondary">
                Ejecución
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 size={10} /> {runLog.filter((l) => l.status === 'ok').length}
                </span>
                {runLog.some((l) => l.status === 'error') && (
                  <span className="inline-flex items-center gap-1 text-danger">
                    <XCircle size={10} /> {runLog.filter((l) => l.status === 'error').length}
                  </span>
                )}
                {runLog.some((l) => l.status === 'skipped') && (
                  <span className="inline-flex items-center gap-1 text-text-muted">
                    <SkipForward size={10} /> {runLog.filter((l) => l.status === 'skipped').length}
                  </span>
                )}
              </div>
              <button onClick={() => setRunLog([])} className="codex-icon-btn w-5 h-5" title="Cerrar registro">
                <X size={11} />
              </button>
            </div>
            <div className="px-3 py-2 text-xs space-y-1">
              {runLog.map((entry, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={entry.status === 'ok' ? 'text-success' : entry.status === 'error' ? 'text-danger' : 'text-text-muted'}>
                    {entry.status === 'ok' ? '✓' : entry.status === 'error' ? '✗' : '·'}
                  </span>
                  <span className="font-medium shrink-0">{entry.nodeLabel}</span>
                  <span className="text-text-muted truncate">{entry.error ?? entry.output}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Chat lateral — colapsable con transición de ancho */}
      <div
        className="shrink-0 bg-app-sidebar overflow-hidden transition-[width] duration-200 ease-out flex flex-col min-h-0"
        style={{ width: chatOpen ? 340 : 0, borderLeft: chatOpen ? '1px solid var(--border)' : 'none' }}
      >
        <WorkflowChatPanel
          workflowId={workflowId}
          initialMessages={wf.chat}
          controller={controller}
          providerId={providerId}
          modelId={modelId}
          onCollapse={() => toggleChat(false)}
        />
      </div>
    </div>
  );
}

// ============================================================================
// NodePalette — panel flotante con búsqueda y categorías (como n8n).
// ============================================================================

function NodePalette({
  query,
  onQuery,
  onAdd,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  onAdd: (type: WorkflowNodeType) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const q = query.trim().toLowerCase();
  const groups = PALETTE_GROUPS
    .map((g) => ({
      ...g,
      types: g.types.filter(
        (t) =>
          !q ||
          WORKFLOW_NODE_LABELS[t].toLowerCase().includes(q) ||
          PALETTE_DESC[t].toLowerCase().includes(q) ||
          t.includes(q),
      ),
    }))
    .filter((g) => g.types.length > 0);

  return (
    <div className="absolute left-3 top-3 bottom-3 z-20 w-[280px] flex flex-col rounded-xl border border-border bg-app-sidebar shadow-2xl overflow-hidden">
      <div className="p-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 mb-2">
          <Plus size={13} className="text-accent shrink-0" />
          <span className="text-xs font-semibold text-text-primary flex-1">Añadir nodo</span>
          <button onClick={onClose} className="codex-icon-btn w-5 h-5" title="Cerrar (Esc)">
            <X size={11} />
          </button>
        </div>
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Buscar nodo…"
            className="codex-input w-full pl-7 pr-2 py-1.5 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {groups.length === 0 && (
          <div className="text-[11px] text-text-muted text-center py-6 italic">Sin resultados para "{query}"</div>
        )}
        {groups.map((g) => (
          <div key={g.title} className="mb-1.5">
            <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted px-2 py-1">{g.title}</div>
            {g.types.map((t) => {
              const meta = NODE_META[t];
              const Icon = meta.icon;
              return (
                <button
                  key={t}
                  onClick={() => onAdd(t)}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-app-elevated transition-colors text-left group"
                >
                  <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border"
                    style={{ background: meta.bg, color: meta.color, borderColor: `${meta.color}40` }}
                  >
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-text-primary truncate group-hover:text-accent transition-colors">
                      {WORKFLOW_NODE_LABELS[t]}
                    </span>
                    <span className="block text-[10px] text-text-muted truncate">{PALETTE_DESC[t]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="px-2.5 py-1.5 border-t border-border text-[9.5px] text-text-muted shrink-0">
        Doble click en el lienzo para abrir aquí
      </div>
    </div>
  );
}

// ============================================================================
// NodeInspector — drawer de configuración auto-generado desde el
// NodeDefinition.parameters del registry (el "drawer" de n8n).
// ============================================================================

function NodeInspector({
  nodeId,
  nodeType,
  label,
  config,
  onConfig,
  onLabel,
  onDelete,
  onClose,
}: {
  nodeId: string;
  nodeType: WorkflowNodeType | undefined;
  label: string;
  config: Record<string, unknown>;
  onConfig: (id: string, patch: Record<string, unknown>) => void;
  onLabel: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const definition = useMemo(
    () => (nodeType ? getLatestNodeDefinition(nodeType) : undefined),
    [nodeType],
  );

  if (!nodeType) return null;
  const meta = NODE_META[nodeType];
  const Icon = meta.icon;

  return (
    <div className="absolute right-3 top-3 bottom-3 z-20 w-[340px] flex flex-col rounded-xl border border-border bg-app-sidebar shadow-2xl overflow-hidden">
      {/* Header: icono + label editable + tipo + cerrar */}
      <div className="p-3 border-b border-border shrink-0">
        <div className="flex items-start gap-2.5">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border"
            style={{ background: meta.bg, color: meta.color, borderColor: `${meta.color}40` }}
          >
            <Icon size={17} />
          </span>
          <div className="flex-1 min-w-0">
            <input
              key={`${nodeId}:label`}
              defaultValue={label}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== label) onLabel(nodeId, v);
                else e.target.value = label;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="w-full bg-transparent border border-transparent hover:border-border focus:border-border-accent rounded-codex px-1 py-0.5 text-sm font-semibold text-text-primary outline-none focus:bg-app-input transition-colors"
              title="Click para renombrar el nodo"
            />
            <div className="text-[10.5px] text-text-muted px-1 mt-0.5">
              {definition?.displayName ?? WORKFLOW_NODE_LABELS[nodeType]}
              {definition?.description ? ` — ${definition.description}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="codex-icon-btn w-6 h-6 shrink-0" title="Cerrar (Esc)">
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Campos auto-generados desde definition.parameters */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3.5">
        {(!definition || definition.parameters.length === 0) && (
          <div className="text-[11px] text-text-muted italic p-2 border border-dashed border-border rounded-lg">
            {definition
              ? 'Este nodo no tiene parámetros configurables — añádelo y conéctalo tal cual.'
              : 'Cargando parámetros del nodo…'}
          </div>
        )}
        {definition?.parameters.map((p) => (
          <InspectorField
            key={`${nodeId}:${p.name}`}
            param={p}
            value={config[p.name]}
            onChange={(v) => onConfig(nodeId, { [p.name]: v })}
          />
        ))}
      </div>

      {/* Zona de peligro */}
      <div className="p-2.5 border-t border-border shrink-0">
        <button
          onClick={() => onDelete(nodeId)}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-codex text-xs text-danger hover:bg-danger/10 border border-danger/30 hover:border-danger/60 transition-colors"
        >
          <Trash2 size={12} /> Eliminar nodo
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// InspectorField — un parámetro del NodeDefinition renderizado como input.
// ============================================================================

function InspectorField({
  param,
  value,
  onChange,
}: {
  param: NodeParameter;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = param.displayName ?? param.name;
  const isCode = param.type === 'code';
  const isJson = param.type === 'array' || param.type === 'object';

  // Estado local para campos JSON (texto libre que se parsea al confirmar).
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState(false);

  const baseInput =
    'w-full codex-input px-2 py-1.5 text-xs rounded-codex bg-app-input border border-border focus:border-accent/60 outline-none transition-colors';

  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11px] font-medium text-text-secondary mb-1">
        {label}
        {param.required && <span className="text-danger">*</span>}
        {param.type === 'expression' && (
          <span className="text-[9px] font-mono text-accent/80 bg-accent/10 rounded px-1 py-px">{'{{$json…}}'}</span>
        )}
      </label>

      {(param.type === 'string' || param.type === 'expression' || param.type === 'credential') && (
        <input
          type="text"
          value={value !== undefined && value !== null ? String(value) : param.default !== undefined ? String(param.default) : ''}
          placeholder={param.placeholder ?? (param.type === 'credential' ? 'credentialId' : '')}
          onChange={(e) => onChange(e.target.value)}
          className={`${baseInput} ${param.type === 'expression' ? 'font-mono' : ''}`}
        />
      )}

      {param.type === 'number' && (
        <input
          type="number"
          value={value !== undefined && value !== null ? Number(value) : param.default !== undefined ? Number(param.default) : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          className={baseInput}
        />
      )}

      {param.type === 'boolean' && (
        <button
          onClick={() => onChange(!(value ?? param.default ?? false))}
          className={`relative w-9 h-5 rounded-full transition-colors ${value ?? param.default ? 'bg-accent' : 'bg-app-input border border-border'}`}
          title={label}
        >
          <span
            className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
            style={{ left: value ?? param.default ? 18 : 2 }}
          />
        </button>
      )}

      {param.type === 'options' && (
        <div className="relative">
          <select
            value={value !== undefined && value !== null ? String(value) : param.default !== undefined ? String(param.default) : ''}
            onChange={(e) => onChange(e.target.value)}
            className={`${baseInput} appearance-none pr-7 cursor-pointer`}
          >
            {(param.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        </div>
      )}

      {(isCode || isJson) && (
        <div>
          <textarea
            value={jsonDraft ?? (value !== undefined && value !== null ? String(value) : param.type === 'code' ? String(param.default ?? '') : JSON.stringify(param.default ?? (param.type === 'array' ? [] : {}), null, 2))}
            placeholder={param.placeholder}
            rows={isCode ? 7 : 4}
            onChange={(e) => {
              if (isCode) {
                onChange(e.target.value);
              } else {
                setJsonDraft(e.target.value);
                try {
                  JSON.parse(e.target.value);
                  setJsonError(false);
                } catch {
                  setJsonError(true);
                }
              }
            }}
            onBlur={() => {
              if (!isCode && jsonDraft !== null) {
                try {
                  onChange(JSON.parse(jsonDraft));
                  setJsonDraft(null);
                  setJsonError(false);
                } catch {
                  /* deja el draft para corregir */
                }
              }
            }}
            className={`${baseInput} font-mono leading-relaxed resize-y ${jsonError ? 'border-danger/70' : ''}`}
            spellCheck={false}
          />
          {jsonError && <div className="text-[10px] text-danger mt-0.5">JSON inválido — se aplica al corregirse</div>}
        </div>
      )}

      {param.description && (
        <div className="text-[10px] text-text-muted mt-1 leading-snug">{param.description}</div>
      )}
    </div>
  );
}

// ============================================================================
// WorkflowChatPanel — chat lateral con tools exclusivas del workflow
// ============================================================================

function WorkflowChatPanel({
  workflowId,
  initialMessages,
  controller,
  providerId,
  modelId,
  onCollapse,
}: {
  workflowId: string;
  initialMessages: WorkflowChatMessage[];
  controller: WorkflowGraphController;
  providerId: string | null;
  modelId: string | null;
  onCollapse: () => void;
}) {
  const [messages, setMessages] = useState<WorkflowChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mismo selector de modelo que el chat principal (mismo estado global).
  const providerLabel = useWeaver((s) => s.providerId);
  const modelLabel = useWeaver((s) => s.modelId);
  const modelPickerOpen = useWeaver((s) => s.modelPickerOpen);
  const setModelPickerOpen = useWeaver((s) => s.setModelPickerOpen);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || busy || !providerId || !modelId) return;
    setInput('');

    const userMsg: WorkflowChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, ts: Date.now() };
    setMessages((m) => [...m, userMsg]);
    appendChatMessage(workflowId, userMsg);
    setBusy(true);

    try {
      const llm = await createProvider(providerId as import('@/providers/types').ProviderId);
      const tools = buildWorkflowTools();

      const history: Message[] = [
        {
          role: 'system',
          content:
            'Eres el asistente de construcción de Workflows de Weaver, un editor visual de automatizaciones tipo n8n con capacidades AI-native. ' +
            'Tu trabajo es construir, editar, validar y ejecutar workflows usando las tools disponibles.\n\n' +
            'Tools de edición: workflow_list_nodes, workflow_add_node, workflow_update_node, workflow_remove_node, workflow_connect_nodes, workflow_disconnect_nodes.\n' +
            'Tools de validación y ejecución: workflow_validate (corre antes de ejecutar), workflow_execute (corre el workflow), workflow_get_node_options (lista tipos disponibles con su schema).\n' +
            'Tools de IO: workflow_export, workflow_import.\n\n' +
            'Tipos de nodo disponibles: webhook, schedule, manual, code, if, switch, filter, delay, set, chat_message, http_request, ' +
            'loop, split, merge, aggregate, sort, limit, execute_workflow, llm.\n\n' +
            'Expressions: soportan {{$json.field}}, {{$node["Node Name"].json.field}}, {{$items("Node Name")}}, {{$env.VAR}}, {{$vars.foo}}, {{$now}}, ' +
            'operaciones aritméticas, comparaciones, ternarios, y métodos como .toLowerCase(), .length, .includes().\n\n' +
            'Flujo recomendado:\n' +
            '1. Si no conoces el estado actual, usa workflow_list_nodes.\n' +
            '2. Construye el flujo: crea nodos y conéctalos en orden lógico.\n' +
            '3. Para nodos "if", conecta con handle: "true" o "false".\n' +
            '4. Antes de ejecutar, usa workflow_validate para detectar errores.\n' +
            '5. Si el usuario pide ejecutar, usa workflow_execute.\n' +
            '6. Si algo falla, analiza el error y repara con workflow_update_node.\n\n' +
            'Cuando termines, responde con un resumen breve en texto natural.',
        },
        ...[...messages, userMsg].map((m): Message => ({ role: m.role, content: m.content })),
      ];

      const MAX_ROUNDS = 10;
      let finalText = '';

      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await streamChat(llm, modelId, history, { tools });

        if (result.toolCalls.length === 0) {
          finalText = result.text.trim();
          break;
        }

        history.push({ role: 'assistant', content: result.text || null, tool_calls: result.toolCalls });

        for (const tc of result.toolCalls) {
          const args = JSON.parse(tc.function.arguments || '{}');
          const res = await dispatchWorkflowTool(tc.function.name, args, controller);
          history.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: res.ok ? res.output : `ERROR: ${res.error}`,
          });
        }
      }

      const assistantMsg: WorkflowChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: finalText || 'Listo — revisa el canvas para ver los cambios.',
        ts: Date.now(),
      };
      setMessages((m) => [...m, assistantMsg]);
      appendChatMessage(workflowId, assistantMsg);
    } catch (e) {
      const errMsg: WorkflowChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${e instanceof Error ? e.message : String(e)}`,
        ts: Date.now(),
      };
      setMessages((m) => [...m, errMsg]);
      appendChatMessage(workflowId, errMsg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-[340px] h-full shrink-0 flex flex-col min-h-0 bg-app-sidebar">
      <div className="h-11 border-b border-border flex items-center justify-between px-3 shrink-0">
        <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
          <Bot size={13} className="text-accent" /> Chat del workflow
        </span>
        <div className="flex items-center gap-1.5">
          {/* Model picker — el mismo componente y estado global que el chat normal */}
          <button
            onClick={() => setModelPickerOpen(!modelPickerOpen)}
            className="composer-model-picker inline-flex items-center gap-1 px-2 py-1 rounded-codex border border-border-accent text-[11px] text-text-primary hover:bg-app-elevated transition-colors cursor-pointer min-w-0"
            title="Cambiar modelo"
          >
            <span className="opacity-70 truncate max-w-[70px] capitalize">{providerLabel}</span>
            <span className="font-medium truncate max-w-[90px]">{modelLabel}</span>
            <ChevronDown size={11} className="opacity-60 shrink-0" />
          </button>
          {/* Ocultar panel */}
          <button onClick={onCollapse} className="codex-icon-btn w-6 h-6" title="Ocultar chat">
            <PanelRightClose size={13} />
          </button>
        </div>
      </div>
      {modelPickerOpen && <ModelPickerPopup onClose={() => setModelPickerOpen(false)} />}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-text-muted p-3 border border-dashed border-border rounded-codex">
            Describe qué quieres automatizar y el agente construirá los nodos por ti.
            <br />
            Ej: "Cuando llegue la hora 9:00, descarga el audio de esta URL y avísame por chat."
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                m.role === 'user'
                  ? 'bg-accent/15 border border-accent/30 rounded-codex px-2.5 py-1.5 text-xs max-w-[90%]'
                  : 'bg-app-elevated border border-border rounded-codex px-2.5 py-1.5 text-xs max-w-[90%]'
              }
            >
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 size={12} className="animate-spin" /> construyendo…
          </div>
        )}
      </div>

      <div className="p-2.5 border-t border-border shrink-0">
        <div className="flex items-end gap-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Pídele al agente que construya o edite el flujo…"
            rows={2}
            className="codex-input flex-1 px-2.5 py-1.5 text-xs resize-none"
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            className="codex-icon-btn w-8 h-8 shrink-0 disabled:opacity-40"
            title="Enviar"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
