/**
 * FASE 4 — Node Registry.
 *
 * Registro central de NodeDefinitions indexado por `${type}@${version}`.
 * El engine v2 lo usa para dispatchar sin acoplarse a tipos específicos.
 *
 * Cualquier módulo puede registrar un NodeDefinition (incluido MCP loader
 * dinámico en FASE 27).
 */

import type { NodeDefinition } from '@/workflows/types/node_definition';
import type { WorkflowNodeType } from '@/workflows/types/definition';

const registry = new Map<string, NodeDefinition>();
const latestVersion = new Map<WorkflowNodeType, number>();

function key(type: string, version: number): string {
  return `${type}@${version}`;
}

/** Registra un NodeDefinition. Reemplaza si ya existía la misma (type, version). */
export function registerNodeDefinition(def: NodeDefinition): void {
  if (!def.type || !def.execute) {
    throw new Error(`NodeDefinition inválida: falta type o execute`);
  }
  registry.set(key(def.type, def.version), def);
  const prev = latestVersion.get(def.type) ?? 0;
  if (def.version > prev) latestVersion.set(def.type, def.version);
}

/** Lookup exacto por (type, version). */
export function getNodeDefinition(type: WorkflowNodeType, version: number): NodeDefinition | undefined {
  return registry.get(key(type, version));
}

/** Lookup de la última versión registrada de un tipo. */
export function getLatestNodeDefinition(type: WorkflowNodeType): NodeDefinition | undefined {
  const v = latestVersion.get(type);
  if (!v) return undefined;
  return registry.get(key(type, v));
}

/** Lookup con fallback: intenta versión exacta, si no cae a latest con warning. */
export function resolveNodeDefinition(type: WorkflowNodeType, version?: number): {
  definition: NodeDefinition | undefined;
  migrated: boolean;
  warning?: string;
} {
  if (version !== undefined) {
    const exact = getNodeDefinition(type, version);
    if (exact) return { definition: exact, migrated: false };
    const latest = getLatestNodeDefinition(type);
    if (latest) {
      return {
        definition: latest,
        migrated: true,
        warning: `Nodo ${type}@${version} no encontrado, usando @${latest.version}`,
      };
    }
    return { definition: undefined, migrated: false };
  }
  return { definition: getLatestNodeDefinition(type), migrated: false };
}

/** Lista todos los NodeDefinitions registrados. */
export function listNodeDefinitions(): NodeDefinition[] {
  return Array.from(registry.values());
}

/** Lista los tipos de nodo registrados (sin versiones duplicadas). */
export function listNodeTypes(): WorkflowNodeType[] {
  return Array.from(latestVersion.keys());
}

/** Limpia el registry (sólo para tests). */
export function clearNodeRegistry(): void {
  registry.clear();
  latestVersion.clear();
  initialized = false;
}

/** Carga todos los NodeDefinitions built-in. Idempotente. */
export async function loadBuiltinNodeDefinitions(): Promise<void> {
  const mod = await import('./definitions/index');
  for (const def of mod.BUILTIN_NODE_DEFINITIONS) {
    registerNodeDefinition(def);
  }
}

/** Inicialización lazy con cache. */
let initialized = false;
export async function ensureNodeDefinitionsLoaded(): Promise<void> {
  if (initialized) return;
  await loadBuiltinNodeDefinitions();
  initialized = true;
}
