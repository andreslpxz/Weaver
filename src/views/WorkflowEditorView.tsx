import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
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
  Webhook,
  Clock,
  Code2,
  GitBranch,
  Timer,
  ListPlus,
  MessageSquare,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { useWeaver } from '@/store/weaver';
import { getWorkflow, saveGraph, appendChatMessage, updateLastRun } from '@/workflows/store';
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowNodeType, WorkflowChatMessage, WorkflowRunLogEntry } from '@/workflows/types';
import { WORKFLOW_NODE_LABELS } from '@/workflows/types';
import { nodeTypes, NODE_META, summarizeConfig, type WorkflowNodeData } from '@/workflows/nodeDefs';
import { buildWorkflowToolsV2 as buildWorkflowTools, dispatchWorkflowToolV2 as dispatchWorkflowTool, type WorkflowGraphController } from '@/workflows/tools_v2';
import { runWorkflow } from '@/workflows/engine';
import { ensureNodeDefinitionsLoaded } from '@/workflows/nodes/registry';
import { createProvider } from '@/providers';
import { streamChat } from '@/lib/chain';
import type { Message } from '@/providers/types';

const NODE_TYPE_LIST: WorkflowNodeType[] = [
  'webhook', 'schedule', 'manual',
  'code', 'if', 'switch', 'filter',
  'set', 'chat_message', 'http_request',
  'loop', 'split', 'merge', 'aggregate', 'sort', 'limit',
  'delay', 'execute_workflow',
  'llm', 'ai_agent', 'structured_output', 'memory', 'tool',
];

const NODE_TYPE_ICONS: Record<WorkflowNodeType, typeof Webhook> = {
  webhook: Webhook,
  schedule: Clock,
  manual: Webhook,
  code: Code2,
  if: GitBranch,
  switch: GitBranch,
  filter: GitBranch,
  delay: Timer,
  set: ListPlus,
  chat_message: MessageSquare,
  http_request: Globe,
  loop: Clock,
  split: ListPlus,
  merge: ListPlus,
  aggregate: ListPlus,
  sort: ListPlus,
  limit: ListPlus,
  execute_workflow: Globe,
  llm: MessageSquare,
  ai_agent: MessageSquare,
  structured_output: Code2,
  memory: Code2,
  tool: Code2,
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
    style: { stroke: e.sourceHandle === 'false' ? '#ef4444' : e.sourceHandle === 'true' ? '#22c55e' : 'var(--border-accent)' },
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

  const [wf, setWf] = useState<Workflow | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [runLog, setRunLog] = useState<WorkflowRunLogEntry[]>([]);

  // Refs para que el controller de tools siempre lea/escriba el estado más
  // reciente aunque el closure del tool-call loop sea antiguo.
  const nodesRef = useRef<WorkflowNode[]>([]);
  const edgesRef = useRef<WorkflowEdge[]>([]);

  useEffect(() => {
    // Asegurar que el NodeRegistry esté cargado antes de ejecutar nada.
    void ensureNodeDefinitionsLoaded();
    const loaded = getWorkflow(workflowId);
    if (!loaded) return;
    setWf(loaded);
    nodesRef.current = loaded.nodes;
    edgesRef.current = loaded.edges;
    setNodes(loaded.nodes.map((n) => toFlowNode(n)));
    setEdges(loaded.edges.map(toFlowEdge));
  }, [workflowId]);

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
      const next = addEdge({ ...conn, id: crypto.randomUUID() }, eds);
      persist(domNodesToModel(nodes), domEdgesToModel(next));
      return next;
    });
  }, [nodes, persist, domNodesToModel, domEdgesToModel]);

  function addNodeManually(type: WorkflowNodeType) {
    const id = crypto.randomUUID();
    const label = WORKFLOW_NODE_LABELS[type];
    const flowNode = toFlowNode({ id, type, label, position: { x: 160 + Math.random() * 200, y: 120 + Math.random() * 200 }, config: {} });
    setNodes((nds) => {
      const next = [...nds, flowNode];
      persist(domNodesToModel(next), domEdgesToModel(edges));
      return next;
    });
    setAddMenuOpen(false);
  }

  function deleteSelected() {
    setNodes((nds) => {
      const next = nds.filter((n) => !n.selected);
      const removedIds = new Set(nds.filter((n) => n.selected).map((n) => n.id));
      setEdges((eds) => {
        const nextEdges = eds.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target) && !e.selected);
        persist(domNodesToModel(next), domEdgesToModel(nextEdges));
        return nextEdges;
      });
      return next;
    });
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

  if (!wf) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-sm">Cargando…</div>;
  }

  return (
    <div className="flex-1 flex min-h-0">
      {/* Canvas */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="h-11 border-b border-border flex items-center justify-between px-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setView('workflows')} className="codex-icon-btn w-7 h-7" title="Volver a Workflows">
              <ArrowLeft size={14} />
            </button>
            <span className="text-sm font-medium truncate">{wf.name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button onClick={deleteSelected} title="Eliminar nodo/conexión seleccionados">
              <Trash2 size={12} />
            </Button>
            <div className="relative">
              <Button onClick={() => setAddMenuOpen((v) => !v)}>
                <Plus size={12} className="mr-1" /> Nodo
              </Button>
              {addMenuOpen && (
                <div className="absolute right-0 top-9 z-20 codex-card p-1.5 w-48 shadow-lg">
                  {NODE_TYPE_LIST.map((t) => {
                    const Icon = NODE_TYPE_ICONS[t];
                    const meta = NODE_META[t];
                    return (
                      <button
                        key={t}
                        onClick={() => addNodeManually(t)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-codex text-xs hover:bg-app-input/50 transition-colors text-left"
                      >
                        <span className="w-5 h-5 rounded flex items-center justify-center" style={{ background: meta.bg, color: meta.color }}>
                          <Icon size={11} />
                        </span>
                        {WORKFLOW_NODE_LABELS[t]}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <Button variant="primary" onClick={handleRun} disabled={running}>
              {running ? <Loader2 size={12} className="animate-spin mr-1" /> : <Play size={12} className="mr-1" />}
              Ejecutar
            </Button>
          </div>
        </header>

        <div className="flex-1 min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            colorMode="dark"
          >
            <Background gap={18} size={1} color="var(--border)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable style={{ background: 'var(--app-elevated)' }} />
          </ReactFlow>
        </div>

        {runLog.length > 0 && (
          <div className="border-t border-border max-h-40 overflow-y-auto shrink-0 px-3 py-2 text-xs space-y-1 bg-app-sidebar">
            {runLog.map((entry, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className={entry.status === 'ok' ? 'text-success' : entry.status === 'error' ? 'text-danger' : 'text-text-muted'}>
                  {entry.status === 'ok' ? '✓' : entry.status === 'error' ? '✗' : '·'}
                </span>
                <span className="font-medium">{entry.nodeLabel}</span>
                <span className="text-text-muted truncate">{entry.error ?? entry.output}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat lateral */}
      <WorkflowChatPanel
        workflowId={workflowId}
        initialMessages={wf.chat}
        controller={controller}
        providerId={providerId}
        modelId={modelId}
      />
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
}: {
  workflowId: string;
  initialMessages: WorkflowChatMessage[];
  controller: WorkflowGraphController;
  providerId: string | null;
  modelId: string | null;
}) {
  const [messages, setMessages] = useState<WorkflowChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    <div className="w-[340px] shrink-0 border-l border-border flex flex-col min-h-0 bg-app-sidebar">
      <div className="h-11 border-b border-border flex items-center px-3 shrink-0">
        <span className="text-xs font-medium text-text-secondary">Chat del workflow</span>
      </div>

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
