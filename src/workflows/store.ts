/**
 * Persistencia de Workflows. Sigue el mismo patrón simple que Schedules
 * (localStorage, evento custom para notificar cambios entre componentes).
 */

import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowChatMessage } from './types';

const WORKFLOWS_KEY = 'weaver:workflows';
const CHANGE_EVENT = 'weaver:workflows-updated';

export function listWorkflows(): Workflow[] {
  try {
    const raw = localStorage.getItem(WORKFLOWS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Workflow[]) : [];
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function getWorkflow(id: string): Workflow | null {
  return listWorkflows().find((w) => w.id === id) ?? null;
}

function persistAll(workflows: Workflow[]) {
  try {
    localStorage.setItem(WORKFLOWS_KEY, JSON.stringify(workflows));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function onWorkflowsChanged(handler: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function createWorkflow(name: string): Workflow {
  const now = Date.now();
  const wf: Workflow = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Workflow sin título',
    nodes: [],
    edges: [],
    chat: [],
    createdAt: now,
    updatedAt: now,
    enabled: true,
  };
  const all = listWorkflows();
  persistAll([wf, ...all]);
  return wf;
}

export function deleteWorkflow(id: string) {
  const all = listWorkflows().filter((w) => w.id !== id);
  persistAll(all);
}

export function renameWorkflow(id: string, name: string) {
  const all = listWorkflows().map((w) =>
    w.id === id ? { ...w, name: name.trim() || w.name, updatedAt: Date.now() } : w,
  );
  persistAll(all);
}

export function setWorkflowEnabled(id: string, enabled: boolean) {
  const all = listWorkflows().map((w) => (w.id === id ? { ...w, enabled, updatedAt: Date.now() } : w));
  persistAll(all);
}

/** Autoguardado del grafo — llamado tanto por edición manual (drag&drop en
 * el canvas) como por las tools que usa el agente en el chat del workflow. */
export function saveGraph(id: string, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  const all = listWorkflows().map((w) =>
    w.id === id ? { ...w, nodes, edges, updatedAt: Date.now() } : w,
  );
  persistAll(all);
}

export function appendChatMessage(id: string, msg: WorkflowChatMessage) {
  const all = listWorkflows().map((w) =>
    w.id === id ? { ...w, chat: [...w.chat, msg], updatedAt: Date.now() } : w,
  );
  persistAll(all);
}

export function replaceChat(id: string, chat: WorkflowChatMessage[]) {
  const all = listWorkflows().map((w) => (w.id === id ? { ...w, chat, updatedAt: Date.now() } : w));
  persistAll(all);
}

export function updateLastRun(id: string, run: Workflow['lastRun']) {
  const all = listWorkflows().map((w) => (w.id === id ? { ...w, lastRun: run, updatedAt: Date.now() } : w));
  persistAll(all);
}
