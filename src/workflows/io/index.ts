/**
 * FASE 21 — Import / Export de workflows.
 *
 * Formato JSON estable:
 *   {
 *     "format": "weaver-workflow",
 *     "version": 1,
 *     "exportedAt": "2026-...",
 *     "workflow": {
 *       "id": "...",
 *       "name": "...",
 *       "nodes": [...],
 *       "edges": [...],
 *       "settings": {...}
 *     }
 *   }
 *
 * NO incluye: secrets, credentials data, tokens, chat history, executions.
 * SÍ incluye: estructura del grafo, configuraciones (con credentialId
 * referenciado pero no el dato), settings, metadata.
 */

import type { Workflow, WorkflowNode, WorkflowEdge } from '../types/definition';

export interface ExportedWorkflow {
  format: 'weaver-workflow';
  version: 1;
  exportedAt: string;
  workflow: {
    id: string;
    name: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    settings?: Workflow['settings'];
    tags?: string[];
  };
}

/** Exporta un workflow a formato JSON portable. */
export function exportWorkflow(wf: Workflow): ExportedWorkflow {
  // Limpiar nodos: remover cualquier campo que pudiera contener secrets.
  const cleanNodes: WorkflowNode[] = wf.nodes.map((node) => {
    const cleanConfig = sanitizeConfig(node.type, node.config);
    return {
      id: node.id,
      type: node.type,
      version: node.version ?? 1,
      label: node.label,
      position: node.position,
      config: cleanConfig,
      retry: node.retry,
      timeoutMs: node.timeoutMs,
      note: node.note,
      disabled: node.disabled,
    };
  });

  const cleanEdges: WorkflowEdge[] = wf.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    filterExpression: edge.filterExpression,
  }));

  return {
    format: 'weaver-workflow',
    version: 1,
    exportedAt: new Date().toISOString(),
    workflow: {
      id: wf.id,
      name: wf.name,
      nodes: cleanNodes,
      edges: cleanEdges,
      settings: wf.settings,
      tags: wf.tags,
    },
  };
}

/** Importa un workflow desde formato JSON portable. */
export function importWorkflow(data: unknown): Workflow | null {
  if (!isExportedWorkflow(data)) return null;

  const wf = data.workflow;
  const now = Date.now();

  return {
    id: crypto.randomUUID(), // nuevo ID para evitar colisiones
    name: wf.name || 'Imported workflow',
    nodes: wf.nodes,
    edges: wf.edges,
    chat: [],
    createdAt: now,
    updatedAt: now,
    enabled: true,
    settings: wf.settings,
    tags: wf.tags,
  };
}

/** Duplica un workflow dentro del mismo workspace (copia limpia). */
export function duplicateWorkflow(wf: Workflow, newName?: string): Workflow {
  const exported = exportWorkflow(wf);
  const copy = importWorkflow(exported);
  if (!copy) throw new Error('Failed to duplicate workflow');
  copy.name = newName ?? `${wf.name} (copy)`;
  return copy;
}

/** Clona un workflow sin executions ni chat (alias de duplicate). */
export function cloneWorkflow(wf: Workflow): Workflow {
  return duplicateWorkflow(wf);
}

/** Verifica que el data cumple el formato esperado. */
function isExportedWorkflow(data: unknown): data is ExportedWorkflow {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.format !== 'weaver-workflow') return false;
  if (d.version !== 1) return false;
  if (typeof d.workflow !== 'object' || d.workflow === null) return false;
  const w = d.workflow as Record<string, unknown>;
  if (!Array.isArray(w.nodes)) return false;
  if (!Array.isArray(w.edges)) return false;
  if (typeof w.name !== 'string') return false;
  return true;
}

/** Remueve campos potencialmente sensibles de la config antes de exportar. */
function sanitizeConfig(
  type: WorkflowNode['type'],
  config: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = { ...config };

  // Lista de campos que NUNCA deben exportarse.
  const FORBIDDEN_KEYS = new Set([
    'password', 'apiKey', 'token', 'secret', 'credentialData',
    'decryptedData', 'accessToken', 'refreshToken',
  ]);

  for (const key of Object.keys(sanitized)) {
    if (FORBIDDEN_KEYS.has(key)) {
      delete sanitized[key];
    }
  }

  // credentialId SÍ se exporta (es una referencia, no el dato).
  // El usuario debe tener la credential con ese ID en su workspace destino.

  return sanitized;
}
