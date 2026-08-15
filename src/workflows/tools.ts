/**
 * Tools exclusivas del chat de Workflows.
 *
 * IMPORTANTE: estas tools SOLO se registran cuando el LLM está respondiendo
 * dentro del chat lateral de un workflow específico (ver WorkflowEditorView).
 * No existen en el chat normal de Weaver ni en ningún otro contexto.
 *
 * Operan sobre un WorkflowGraphController que vive en el componente React
 * (estado de React Flow), de forma que cada tool call se refleja al
 * instante en el canvas mientras el agente conversa. El autoguardado a
 * localStorage ocurre en cada mutación desde el propio controller.
 */

import type { Tool } from '@/providers/types';
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
  WorkflowEdgeHandle,
} from './types';
import { WORKFLOW_NODE_LABELS } from './types';

const VALID_TYPES: WorkflowNodeType[] = [
  'webhook',
  'schedule',
  'code',
  'if',
  'delay',
  'set',
  'chat_message',
  'http_request',
];

export interface WorkflowGraphController {
  getNodes: () => WorkflowNode[];
  getEdges: () => WorkflowEdge[];
  addNode: (node: WorkflowNode) => void;
  updateNode: (id: string, patch: Partial<Pick<WorkflowNode, 'label' | 'position' | 'config'>>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: WorkflowEdge) => void;
  removeEdge: (id: string) => void;
}

export interface ToolExecResult {
  ok: boolean;
  output: string;
  error?: string;
}

/** Definiciones de tools (formato OpenAI-compatible, igual al resto de Weaver). */
export function buildWorkflowTools(): Tool[] {
  return [
    def('workflow_list_nodes', 'Lista todos los nodos y conexiones actuales del workflow. Úsalo primero si no estás seguro del estado actual antes de editar.', {}),
    def('workflow_add_node', 'Agrega un nodo nuevo al canvas del workflow.', {
      type: { type: 'string', description: `Tipo de nodo: ${VALID_TYPES.join(' | ')}` },
      label: { type: 'string', description: 'Nombre visible del nodo (ej. "Descargar audio", "Revisar precio")' },
      config: {
        type: 'object',
        description:
          'Configuración según el tipo. webhook: {path, method}. schedule: {time, recurrence, weekday?, monthDay?}. ' +
          'code: {language: "javascript"|"python", code}. if: {field, operator: eq|neq|gt|lt|contains|is_empty|is_not_empty, value}. ' +
          'delay: {ms}. set: {fields: [{key, value}]}. chat_message: {message}. http_request: {url, method, headers?, body?}.',
      },
      x: { type: 'number', description: 'Posición X en el canvas (opcional, se autoubica si se omite)' },
      y: { type: 'number', description: 'Posición Y en el canvas (opcional)' },
    }, ['type', 'label']),
    def('workflow_update_node', 'Modifica un nodo existente (label y/o config). Usa workflow_list_nodes primero para obtener el id.', {
      id: { type: 'string', description: 'id del nodo a modificar' },
      label: { type: 'string', description: 'Nuevo label (opcional)' },
      config: { type: 'object', description: 'Config a fusionar con la existente (opcional)' },
    }, ['id']),
    def('workflow_remove_node', 'Elimina un nodo del workflow (y sus conexiones asociadas).', {
      id: { type: 'string', description: 'id del nodo a eliminar' },
    }, ['id']),
    def('workflow_connect_nodes', 'Conecta dos nodos (crea una flecha de source a target).', {
      source: { type: 'string', description: 'id del nodo origen' },
      target: { type: 'string', description: 'id del nodo destino' },
      handle: { type: 'string', description: 'Para nodos "if": "true" o "false" según la rama. Omitir en el resto de casos.' },
    }, ['source', 'target']),
    def('workflow_disconnect_nodes', 'Elimina una conexión existente entre dos nodos.', {
      source: { type: 'string', description: 'id del nodo origen' },
      target: { type: 'string', description: 'id del nodo destino' },
    }, ['source', 'target']),
  ];
}

function def(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
): Tool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
  };
}

let autoLayoutCounter = 0;

/** Ejecuta una tool call de workflow contra el controller dado. */
export function dispatchWorkflowTool(
  name: string,
  args: Record<string, unknown>,
  controller: WorkflowGraphController,
): ToolExecResult {
  try {
    switch (name) {
      case 'workflow_list_nodes': {
        const nodes = controller.getNodes();
        const edges = controller.getEdges();
        const summary = {
          nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, config: n.config })),
          edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, handle: e.sourceHandle })),
        };
        return { ok: true, output: JSON.stringify(summary) };
      }

      case 'workflow_add_node': {
        const type = String(args.type ?? '') as WorkflowNodeType;
        if (!VALID_TYPES.includes(type)) {
          return { ok: false, output: '', error: `Tipo de nodo inválido: "${type}". Válidos: ${VALID_TYPES.join(', ')}` };
        }
        const label = String(args.label ?? WORKFLOW_NODE_LABELS[type]);
        const config = (args.config as Record<string, unknown>) ?? {};
        autoLayoutCounter += 1;
        const x = typeof args.x === 'number' ? args.x : 120 + (autoLayoutCounter % 4) * 240;
        const y = typeof args.y === 'number' ? args.y : 80 + Math.floor(autoLayoutCounter / 4) * 160;
        const node: WorkflowNode = {
          id: crypto.randomUUID(),
          type,
          label,
          position: { x, y },
          config,
        };
        controller.addNode(node);
        return { ok: true, output: `Nodo creado: ${node.id} (${type} — "${label}")` };
      }

      case 'workflow_update_node': {
        const id = String(args.id ?? '');
        const existing = controller.getNodes().find((n) => n.id === id);
        if (!existing) return { ok: false, output: '', error: `No existe un nodo con id "${id}"` };
        const patch: Partial<Pick<WorkflowNode, 'label' | 'config'>> = {};
        if (typeof args.label === 'string') patch.label = args.label;
        if (args.config && typeof args.config === 'object') {
          patch.config = { ...existing.config, ...(args.config as Record<string, unknown>) };
        }
        controller.updateNode(id, patch);
        return { ok: true, output: `Nodo ${id} actualizado.` };
      }

      case 'workflow_remove_node': {
        const id = String(args.id ?? '');
        const existing = controller.getNodes().find((n) => n.id === id);
        if (!existing) return { ok: false, output: '', error: `No existe un nodo con id "${id}"` };
        controller.removeNode(id);
        return { ok: true, output: `Nodo ${id} eliminado.` };
      }

      case 'workflow_connect_nodes': {
        const source = String(args.source ?? '');
        const target = String(args.target ?? '');
        const nodes = controller.getNodes();
        if (!nodes.find((n) => n.id === source)) return { ok: false, output: '', error: `No existe el nodo origen "${source}"` };
        if (!nodes.find((n) => n.id === target)) return { ok: false, output: '', error: `No existe el nodo destino "${target}"` };
        const handle = args.handle === 'true' || args.handle === 'false' ? (args.handle as WorkflowEdgeHandle) : undefined;
        const edge: WorkflowEdge = { id: crypto.randomUUID(), source, target, sourceHandle: handle };
        controller.addEdge(edge);
        return { ok: true, output: `Conectado ${source} → ${target}${handle ? ` (rama "${handle}")` : ''}` };
      }

      case 'workflow_disconnect_nodes': {
        const source = String(args.source ?? '');
        const target = String(args.target ?? '');
        const edge = controller.getEdges().find((e) => e.source === source && e.target === target);
        if (!edge) return { ok: false, output: '', error: `No hay conexión entre "${source}" y "${target}"` };
        controller.removeEdge(edge.id);
        return { ok: true, output: `Desconectado ${source} → ${target}` };
      }

      default:
        return { ok: false, output: '', error: `Tool de workflow desconocida: ${name}` };
    }
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}
