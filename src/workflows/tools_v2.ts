/**
 * FASE 16 — Workflow Tools v2 para el AI Agent.
 *
 * Amplía las 6 tools v0 (list/add/update/remove/connect/disconnect) con:
 *   - workflow_validate
 *   - workflow_execute
 *   - workflow_get_execution
 *   - workflow_retry
 *   - workflow_get_node_options
 *   - workflow_export
 *   - workflow_import
 *
 * El agente puede construir, validar, ejecutar, observar y reparar
 * workflows con estas tools estructuradas, sin editar JSON crudo.
 */

import type { Tool } from '@/providers/types';
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowNodeType,
  WorkflowEdgeHandle,
} from './types';
import { WORKFLOW_NODE_LABELS } from './types';
import type { WorkflowGraphController, ToolExecResult } from './tools';
import { validateWorkflow } from './validator';
import { runWorkflowV2 } from './engine/v2/engine';
import { listNodeDefinitions } from './nodes/registry';
import { exportWorkflow, importWorkflow } from './io';

// Re-export para que consumers de tools_v2 no tengan que importar de tools.
export type { WorkflowGraphController, ToolExecResult } from './tools';

const VALID_TYPES: WorkflowNodeType[] = [
  'webhook', 'schedule', 'manual',
  'code', 'if', 'switch', 'filter',
  'set', 'chat_message', 'http_request',
  'loop', 'split', 'merge', 'aggregate', 'sort', 'limit',
  'delay', 'execute_workflow',
  'llm', 'ai_agent', 'structured_output', 'memory', 'tool',
];

/** Construye la lista de tools (definiciones OpenAI-compatible). */
export function buildWorkflowToolsV2(): Tool[] {
  return [
    def('workflow_list_nodes', 'Lista todos los nodos y conexiones actuales del workflow. Úsalo primero si no estás seguro del estado actual antes de editar.', {}),
    def('workflow_add_node', 'Agrega un nodo nuevo al canvas del workflow.', {
      type: { type: 'string', description: `Tipo de nodo: ${VALID_TYPES.join(' | ')}` },
      label: { type: 'string', description: 'Nombre visible del nodo (ej. "Descargar audio", "Revisar precio")' },
      config: {
        type: 'object',
        description:
          'Configuración según el tipo. webhook: {path, method, responseMode}. schedule: {cronExpr, timezone}. ' +
          'code: {language: "javascript"|"python"|"bash", code}. if: {expression} o legacy {field, operator, value}. ' +
          'delay: {ms}. set: {fields: [{key, value}], replace?}. chat_message: {message}. http_request: {url, method, headers?, body?, parseJson?, timeoutMs?, credentialId?}. ' +
          'loop: {itemsExpression?, maxIterations?}. filter: {expression}. sort: {keyExpression?, order?}. limit: {limit, fromEnd?}. ' +
          'aggregate: {field?}. merge: {mode?}. switch: {cases: [{id, label, expression}]}. execute_workflow: {workflowId?, workflowName?, inputMapping?, waitForResult?}. ' +
          'llm: {providerId?, modelId?, systemPrompt?, prompt?, temperature?, maxTokens?, jsonMode?}.',
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
      handle: { type: 'string', description: 'Para nodos "if": "true" o "false" según la rama. Para "switch": case id. Omitir en el resto de casos.' },
    }, ['source', 'target']),
    def('workflow_disconnect_nodes', 'Elimina una conexión existente entre dos nodos.', {
      source: { type: 'string', description: 'id del nodo origen' },
      target: { type: 'string', description: 'id del nodo destino' },
    }, ['source', 'target']),
    def('workflow_validate', 'Valida el workflow actual y devuelve errores estructurados (nodos desconectados, ciclos, expressions inválidas, etc.). Úsalo antes de ejecutar.', {}, []),
    def('workflow_execute', 'Ejecuta el workflow actual. Devuelve el executionId y el status final.', {
      startNodeId: { type: 'string', description: 'Si se especifica, arranca desde ese nodo (en vez de los triggers).' },
      inputJson: { type: 'string', description: 'Input inicial como JSON string (opcional).' },
    }, []),
    def('workflow_get_node_options', 'Lista los tipos de nodo disponibles y sus parameters schema. Úsalo antes de workflow_add_node si no estás seguro de la config.', {}, []),
    def('workflow_export', 'Devuelve el JSON exportable del workflow (sin secrets).', {}, []),
    def('workflow_import', 'Carga un workflow desde un JSON exportable. Reemplaza el contenido actual del canvas.', {
      json: { type: 'string', description: 'JSON del workflow exportado.' },
    }, ['json']),
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

/** Cache de la última ejecución (para workflow_get_execution). */
let lastExecution: Awaited<ReturnType<typeof runWorkflowV2>> | null = null;

export function getLastExecution() {
  return lastExecution;
}

export function setLastExecution(exec: typeof lastExecution) {
  lastExecution = exec;
}

/** Ejecuta una tool call de workflow contra el controller dado. */
export async function dispatchWorkflowToolV2(
  name: string,
  args: Record<string, unknown>,
  controller: WorkflowGraphController,
): Promise<ToolExecResult> {
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
        const x = typeof args.x === 'number' ? args.x : 120 + (Math.random() * 240);
        const y = typeof args.y === 'number' ? args.y : 80 + (Math.random() * 240);
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
        const handle = typeof args.handle === 'string' ? (args.handle as WorkflowEdgeHandle) : undefined;
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

      case 'workflow_validate': {
        const nodes = controller.getNodes();
        const edges = controller.getEdges();
        const wf = {
          id: 'adhoc',
          name: 'adhoc',
          nodes,
          edges,
          chat: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          enabled: true,
        };
        const result = validateWorkflow(wf, { validateExpressions: true });
        return {
          ok: result.valid,
          output: JSON.stringify(result, null, 2),
          error: result.valid ? undefined : `${result.errors.length} error(es), ${result.warnings.length} warning(s)`,
        };
      }

      case 'workflow_execute': {
        const nodes = controller.getNodes();
        const edges = controller.getEdges();
        const wf = {
          id: 'adhoc',
          name: 'adhoc',
          nodes,
          edges,
          chat: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          enabled: true,
        };
        let input: import('./types/execution').ExecutionItem[] | undefined;
        if (typeof args.inputJson === 'string' && args.inputJson.trim()) {
          try {
            const parsed = JSON.parse(args.inputJson);
            input = Array.isArray(parsed) ? parsed.map((json) => ({ json })) : [{ json: parsed }];
          } catch {
            return { ok: false, output: '', error: 'inputJson no es JSON válido.' };
          }
        }
        const execution = await runWorkflowV2(wf, {
          mode: 'manual',
          input,
          startNodeId: typeof args.startNodeId === 'string' ? args.startNodeId : undefined,
        });
        lastExecution = execution;
        return {
          ok: execution.status === 'success',
          output: JSON.stringify({
            executionId: execution.id,
            status: execution.status,
            nodeExecutions: execution.nodeExecutions.length,
            error: execution.error?.message,
          }),
          error: execution.error?.message,
        };
      }

      case 'workflow_get_node_options': {
        const defs = listNodeDefinitions();
        const summary = defs.map((d) => ({
          type: d.type,
          version: d.version,
          displayName: d.displayName,
          description: d.description,
          category: d.category,
          isTrigger: d.isTrigger ?? false,
          parameters: d.parameters.map((p) => ({
            name: p.name,
            type: p.type,
            required: p.required ?? false,
            default: p.default,
            description: p.description,
          })),
        }));
        return { ok: true, output: JSON.stringify(summary, null, 2) };
      }

      case 'workflow_export': {
        const nodes = controller.getNodes();
        const edges = controller.getEdges();
        const wf = {
          id: 'adhoc',
          name: 'adhoc',
          nodes,
          edges,
          chat: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          enabled: true,
        };
        const exported = exportWorkflow(wf);
        return { ok: true, output: JSON.stringify(exported, null, 2) };
      }

      case 'workflow_import': {
        const json = String(args.json ?? '');
        try {
          const parsed = JSON.parse(json);
          const wf = importWorkflow(parsed);
          if (!wf) return { ok: false, output: '', error: 'Formato inválido.' };
          // Reemplazar canvas: borrar todo, añadir nodos y edges del import.
          for (const n of controller.getNodes()) controller.removeNode(n.id);
          for (const n of wf.nodes) controller.addNode(n);
          for (const e of wf.edges) controller.addEdge(e);
          return { ok: true, output: `Importado: ${wf.nodes.length} nodos, ${wf.edges.length} conexiones.` };
        } catch (e) {
          return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
        }
      }

      default:
        return { ok: false, output: '', error: `Tool de workflow desconocida: ${name}` };
    }
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}
