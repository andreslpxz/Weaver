/**
 * RLM-1 / RLM-5 — Context Store.
 *
 * Implementa el paradigma "Contexto como Variable" del modelo RLM
 * (Recursive Language Model).
 *
 * En lugar de volcar todo el contenido de archivos/documentos al prompt
 * del agente (lo que causa Context Rot), el agente:
 *
 *   1. Invoca tools que devuelven SÓLO fragmentos relevantes (líneas
 *      específicas, estructura de archivos, outputs truncados).
 *   2. Guarda esos fragmentos en el ContextStore bajo un key.
 *   3. Consulta el ContextStore cuando necesita un fragmento, en vez
 *      de re-leer la fuente original.
 *
 * Esto mantiene la ventana de contexto del LLM "limpia": el agente sólo
 * ve lo que explícitamente pidió ver, y puede descartar fragmentos
 * obsoletos con ctx_clear.
 *
 * El ContextStore es por sesión (no persistente). Cada episodio del
 * agente tiene su propio ContextStore. Los subagentes hijos heredan
 * una copia limpia (no ven los fragmentos del padre — evitan heredar
 * basura).
 */

import type { TraceStep } from '../types';

export interface ContextFragment {
  /** ID único del fragmento. */
  id: string;
  /** Key legible bajo el cual se guardó (ej. "user file:42-58"). */
  key: string;
  /** Contenido del fragmento (string). */
  content: string;
  /** Origen: qué tool lo produjo. */
  source: string;
  /** Timestamp de creación. */
  createdAt: number;
  /** Tamaño en caracteres (para reporting). */
  size: number;
  /** Metadata adicional (ej. {file, startLine, endLine}). */
  metadata?: Record<string, unknown>;
}

export interface ContextStoreSnapshot {
  fragments: ContextFragment[];
  totalSize: number;
  fragmentCount: number;
  createdAt: number;
}

export class ContextStore {
  private fragments = new Map<string, ContextFragment>();
  private history: Array<{ action: 'set' | 'delete' | 'clear'; fragment?: ContextFragment; ts: number }> = [];

  /** Guarda un fragmento bajo un key. Sobrescribe si ya existe. */
  set(key: string, content: string, source: string, metadata?: Record<string, unknown>): ContextFragment {
    const fragment: ContextFragment = {
      id: crypto.randomUUID(),
      key,
      content,
      source,
      createdAt: Date.now(),
      size: content.length,
      metadata,
    };
    this.fragments.set(key, fragment);
    this.history.push({ action: 'set', fragment, ts: Date.now() });
    return fragment;
  }

  /** Obtiene un fragmento por key. */
  get(key: string): ContextFragment | undefined {
    return this.fragments.get(key);
  }

  /** Lista todos los fragmentos (sin contenido, sólo metadatos). */
  list(): Array<Omit<ContextFragment, 'content'>> {
    return Array.from(this.fragments.values()).map(({ content: _content, ...rest }) => rest);
  }

  /** Elimina un fragmento por key. */
  delete(key: string): boolean {
    const fragment = this.fragments.get(key);
    if (!fragment) return false;
    this.fragments.delete(key);
    this.history.push({ action: 'delete', fragment, ts: Date.now() });
    return true;
  }

  /** Limpia todos los fragmentos. */
  clear(): void {
    this.history.push({ action: 'clear', ts: Date.now() });
    this.fragments.clear();
  }

  /** Tamaño total en caracteres de todos los fragmentos. */
  totalSize(): number {
    return Array.from(this.fragments.values()).reduce((sum, f) => sum + f.size, 0);
  }

  /** Número de fragmentos. */
  count(): number {
    return this.fragments.size;
  }

  /** Snapshot inmutable del estado actual (para comparar antes/después). */
  snapshot(): ContextStoreSnapshot {
    return {
      fragments: Array.from(this.fragments.values()).map((f) => ({ ...f })),
      totalSize: this.totalSize(),
      fragmentCount: this.fragments.size,
      createdAt: Date.now(),
    };
  }

  /** Restaura un snapshot previo (para /refine revert). */
  restore(snapshot: ContextStoreSnapshot): void {
    this.fragments.clear();
    for (const f of snapshot.fragments) {
      this.fragments.set(f.key, { ...f });
    }
  }

  /** Devuelve una representación compacta para incluir en el prompt del LLM.
   *  NO incluye el contenido (sólo la lista de keys disponibles). */
  toPromptSummary(): string {
    const frags = this.list();
    if (frags.length === 0) {
      return '(ContextStore vacío — usa ctx_get para guardar fragmentos antes de consultarlos)';
    }
    const lines = frags.map((f) =>
      `- "${f.key}" (${f.size} chars, source: ${f.source}${f.metadata ? ', meta: ' + JSON.stringify(f.metadata) : ''})`,
    );
    return `Fragmentos disponibles en ContextStore (${frags.length}, ${this.totalSize()} chars total):\n${lines.join('\n')}`;
  }

  /** Historial de acciones (para debugging). */
  getHistory(): typeof this.history {
    return [...this.history];
  }
}

/** Factory: crea un ContextStore nuevo para un episodio. */
export function createContextStore(): ContextStore {
  return new ContextStore();
}

/** Crea una copia limpia de un ContextStore (sin fragmentos).
 *  Usado cuando un subagente hijo hereda el contexto del padre pero
 *  no debe ver el contenido (sólo saber qué keys existen). */
export function forkCleanContextStore(parent: ContextStore): ContextStore {
  const child = createContextStore();
  // El hijo NO hereda los fragmentos del padre — sólo la lista de keys
  // disponibles, para que sepa qué puede pedir si lo necesita.
  // Esto es la esencia del RLM: cada subagente tiene su ventana limpia.
  return child;
}

/** Convierte una lista de TraceStep a un resumen compacto para el prompt. */
export function summarizeTraceForPrompt(trace: TraceStep[], maxSteps = 10): string {
  const recent = trace.slice(-maxSteps);
  return recent
    .map((s, i) => {
      const content = s.content.length > 200 ? s.content.slice(0, 200) + '...' : s.content;
      return `${i + 1}. [${s.kind}] ${content}`;
    })
    .join('\n');
}
