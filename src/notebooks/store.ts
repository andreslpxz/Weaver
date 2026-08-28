/**
 * Persistencia de Notebooks. Sigue el mismo patrón simple que Workflows
 * (localStorage, evento custom para notificar cambios entre componentes).
 */

import type { Notebook, NotebookSource, NotebookChatMessage, StudioArtifact } from './types';

const NOTEBOOKS_KEY = 'weaver:notebooks';
const CHANGE_EVENT = 'weaver:notebooks-updated';

export function listNotebooks(): Notebook[] {
  try {
    const raw = localStorage.getItem(NOTEBOOKS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Notebook[]) : [];
    return parsed.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function getNotebook(id: string): Notebook | null {
  return listNotebooks().find((n) => n.id === id) ?? null;
}

function persistAll(notebooks: Notebook[]) {
  try {
    localStorage.setItem(NOTEBOOKS_KEY, JSON.stringify(notebooks));
  } catch {
    /* ignore (quota, etc.) */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function onNotebooksChanged(handler: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function createNotebook(name: string): Notebook {
  const now = Date.now();
  const nb: Notebook = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Cuaderno sin título',
    sources: [],
    chat: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };
  const all = listNotebooks();
  persistAll([nb, ...all]);
  return nb;
}

export function deleteNotebook(id: string) {
  persistAll(listNotebooks().filter((n) => n.id !== id));
}

export function renameNotebook(id: string, name: string) {
  persistAll(
    listNotebooks().map((n) => (n.id === id ? { ...n, name: name.trim() || n.name, updatedAt: Date.now() } : n)),
  );
}

// --- Fuentes ---

export function addSource(id: string, source: NotebookSource) {
  persistAll(
    listNotebooks().map((n) =>
      n.id === id ? { ...n, sources: [...n.sources, source], updatedAt: Date.now() } : n,
    ),
  );
}

export function updateSource(id: string, sourceId: string, patch: Partial<NotebookSource>) {
  persistAll(
    listNotebooks().map((n) =>
      n.id === id
        ? {
            ...n,
            sources: n.sources.map((s) => (s.id === sourceId ? { ...s, ...patch } : s)),
            updatedAt: Date.now(),
          }
        : n,
    ),
  );
}

export function removeSource(id: string, sourceId: string) {
  persistAll(
    listNotebooks().map((n) =>
      n.id === id ? { ...n, sources: n.sources.filter((s) => s.id !== sourceId), updatedAt: Date.now() } : n,
    ),
  );
}

// --- Chat ---

export function appendChatMessage(id: string, msg: NotebookChatMessage) {
  persistAll(
    listNotebooks().map((n) => (n.id === id ? { ...n, chat: [...n.chat, msg], updatedAt: Date.now() } : n)),
  );
}

export function updateChatMessage(id: string, msgId: string, patch: Partial<NotebookChatMessage>) {
  persistAll(
    listNotebooks().map((n) =>
      n.id === id
        ? { ...n, chat: n.chat.map((m) => (m.id === msgId ? { ...m, ...patch } : m)), updatedAt: Date.now() }
        : n,
    ),
  );
}

export function clearChat(id: string) {
  persistAll(listNotebooks().map((n) => (n.id === id ? { ...n, chat: [], updatedAt: Date.now() } : n)));
}

// --- Studio (artefactos) ---

export function addArtifact(id: string, artifact: StudioArtifact) {
  persistAll(
    listNotebooks().map((n) =>
      n.id === id ? { ...n, artifacts: [artifact, ...n.artifacts], updatedAt: Date.now() } : n,
    ),
  );
}

export function removeArtifact(id: string, artifactId: string) {
  persistAll(
    listNotebooks().map((n) =>
      n.id === id ? { ...n, artifacts: n.artifacts.filter((a) => a.id !== artifactId), updatedAt: Date.now() } : n,
    ),
  );
}

/**
 * Importa un notebook desde un objeto externo (importar/compartir).
 * Siempre asigna un id NUEVO. El chat se importa vacío para no arrastrar
 * historial ajeno; las fuentes sí viajan completas.
 */
export function importNotebook(data: Partial<Notebook>): Notebook {
  const now = Date.now();
  const nb: Notebook = {
    id: crypto.randomUUID(),
    name: (data.name ?? '').toString().trim() || 'Cuaderno importado',
    description: typeof data.description === 'string' ? data.description : undefined,
    sources: Array.isArray(data.sources)
      ? data.sources.map((s, i) => ({
          ...s,
          id: typeof s?.id === 'string' && s.id ? `${s.id}` : `src-${now}-${i}`,
        }))
      : [],
    chat: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };
  persistAll([nb, ...listNotebooks()]);
  return nb;
}
