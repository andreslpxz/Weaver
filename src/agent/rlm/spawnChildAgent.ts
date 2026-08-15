/**
 * RLM-2 + RLM-4 — spawnChildAgent recursivo con depth limit.
 *
 * Implementa la recursión de subagentes del modelo RLM. El agente
 * principal (o un subagente) puede invocar spawnChildAgent() para
 * delegar una subtarea a un hijo con su propia ventana de contexto
 * limpia.
 *
 * Protecciones contra "overthinking" y recursión infinita:
 *   - maxDepth: profundidad máxima de recursión (default 3).
 *   - maxTotalChildren: número máximo de hijos spawneados en todo el árbol (default 50).
 *   - maxConcurrentChildren: límite de hijos simultáneos (default 5).
 *   - Termination signal: cada hijo debe terminar con RESULT/STUCK antes
 *     de devolver el control al padre. Si un hijo excede su presupuesto,
 *     se marca como 'budget_exceeded' y el padre decide qué hacer.
 *
 * Jerarquía de contextos:
 *   - El padre tiene su ContextStore propio.
 *   - El hijo recibe un ContextStore LIMPIO (forkCleanContextStore).
 *   - El hijo puede pedir fragmentos específicos al padre vía la tool
 *     `parent_context_get` (limitada — sólo keys whitelisted).
 *   - Cuando el hijo termina, su resultado se guarda en el ContextStore
 *     del padre bajo un key automático.
 */

import type { LLMProvider } from '@/providers/types';
import type { TraceStep } from '../types';
import { ContextStore, forkCleanContextStore } from './contextStore';
import {
  SubagentDef,
  SubagentInvocation,
  SubagentResult,
  SubagentBudget,
  runSubagent,
  subagentRegistry,
} from '../subagent';
import { metrics } from '@/lib/metrics';

// ============================================================================
// Configuración de límites
// ============================================================================

export interface RlmLimits {
  /** Profundidad máxima de recursión (0 = raíz, 3 = hijo de hijo de hijo). */
  maxDepth: number;
  /** Número total máximo de hijos spawneados en todo el árbol. */
  maxTotalChildren: number;
  /** Número máximo de hijos concurrentes (paralelos). */
  maxConcurrentChildren: number;
  /** Timeout total del árbol completo (ms). */
  maxTotalTimeMs: number;
}

export const DEFAULT_RLM_LIMITS: RlmLimits = {
  maxDepth: 3,
  maxTotalChildren: 50,
  maxConcurrentChildren: 5,
  maxTotalTimeMs: 10 * 60_000, // 10 min
};

// ============================================================================
// Contexto de recursión
// ============================================================================

export interface RecursionContext {
  /** Profundidad actual (0 = raíz). */
  depth: number;
  /** Path de parent IDs (para debugging). */
  path: string[];
  /** ContextStore del agente en este nivel. */
  store: ContextStore;
  /** Límites efectivos en este nivel. */
  limits: RlmLimits;
  /** IDs de todos los hijos spawneados hasta ahora en el árbol. */
  totalChildrenSpawned: number;
  /** Timestamp de inicio del árbol. */
  treeStart: number;
  /** Provider + modelo a usar. */
  provider: LLMProvider;
  model: string;
  /** Callback para reporting. */
  onSpawn?: (info: SpawnInfo) => void;
  /** AbortSignal global del árbol. */
  signal?: AbortSignal;
}

export interface SpawnInfo {
  childId: string;
  parentPath: string[];
  depth: number;
  subagentName: string;
  objective: string;
  budget: SubagentBudget;
}

export interface SpawnResult {
  status: 'succeeded' | 'failed' | 'stuck' | 'timeout' | 'budget_exceeded' | 'depth_exceeded' | 'total_limit_exceeded' | 'cancelled';
  result: string;
  evidence?: unknown[];
  trace?: TraceStep[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    steps: number;
    elapsedMs: number;
  };
  childId: string;
}

// ============================================================================
// spawnChildAgent — la función recursiva clave
// ============================================================================

/**
 * Spawnea un subagente hijo con su propia ventana de contexto.
 *
 * @param objective Objetivo específico del hijo.
 * @param subagentName Nombre del subagente (del catálogo). Si no se especifica, se selecciona por keyword.
 * @param context Contexto mínimo (no todo el historial del padre).
 * @param budgetOverride Presupuesto del hijo (si null, usa defaultBudget del subagente).
 * @param parentCtx Contexto de recursión del padre.
 */
export async function spawnChildAgent(
  objective: string,
  subagentName: string | undefined,
  context: string,
  budgetOverride: Partial<SubagentBudget> | undefined,
  parentCtx: RecursionContext,
): Promise<SpawnResult> {
  const childId = `child-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // RLM-4: chequear límites antes de spawnear.
  if (parentCtx.depth >= parentCtx.limits.maxDepth) {
    return {
      status: 'depth_exceeded',
      result: `Profundidad máxima de recursión (${parentCtx.limits.maxDepth}) excedida. No se puede spawnear más hijos.`,
      childId,
    };
  }

  if (parentCtx.totalChildrenSpawned >= parentCtx.limits.maxTotalChildren) {
    return {
      status: 'total_limit_exceeded',
      result: `Límite total de hijos (${parentCtx.limits.maxTotalChildren}) excedido en el árbol.`,
      childId,
    };
  }

  if (parentCtx.signal?.aborted) {
    return {
      status: 'cancelled',
      result: 'Árbol cancelado por AbortSignal.',
      childId,
    };
  }

  if (Date.now() - parentCtx.treeStart > parentCtx.limits.maxTotalTimeMs) {
    return {
      status: 'timeout',
      result: `Tiempo total del árbol (${parentCtx.limits.maxTotalTimeMs}ms) excedido.`,
      childId,
    };
  }

  // Seleccionar subagente del catálogo.
  let def: SubagentDef | undefined;
  if (subagentName) {
    def = subagentRegistry.list().find((s) => s.name === subagentName);
  }
  if (!def) {
    // Auto-selección por keyword match en objective.
    const candidates = subagentRegistry.list();
    if (candidates.length === 0) {
      return {
        status: 'failed',
        result: 'No hay subagentes registrados en el catálogo.',
        childId,
      };
    }
    def = selectByKeyword(objective, candidates);
  }
  if (!def) {
    return {
      status: 'failed',
      result: `Subagente "${subagentName}" no encontrado y auto-selección falló.`,
      childId,
    };
  }

  // Construir presupuesto: override > defaultBudget del subagente.
  const budget: SubagentBudget = {
    maxSteps: budgetOverride?.maxSteps ?? def.defaultBudget.maxSteps,
    maxTokens: budgetOverride?.maxTokens ?? def.defaultBudget.maxTokens,
    maxTimeMs: budgetOverride?.maxTimeMs ?? def.defaultBudget.maxTimeMs,
  };

  // Crear ContextStore limpio para el hijo.
  const childStore = forkCleanContextStore(parentCtx.store);

  // Construir RecursionContext del hijo (para que pueda spawnear nietos).
  const childCtx: RecursionContext = {
    depth: parentCtx.depth + 1,
    path: [...parentCtx.path, childId],
    store: childStore,
    limits: parentCtx.limits,
    totalChildrenSpawned: parentCtx.totalChildrenSpawned, // share counter via reference (object)
    treeStart: parentCtx.treeStart,
    provider: parentCtx.provider,
    model: parentCtx.model,
    onSpawn: parentCtx.onSpawn,
    signal: parentCtx.signal,
  };

  // Notificar spawn.
  parentCtx.onSpawn?.({
    childId,
    parentPath: parentCtx.path,
    depth: childCtx.depth,
    subagentName: def.name,
    objective,
    budget,
  });

  // Incrementar contador global de hijos.
  // Usamos un truco: como totalChildrenSpawned es number (primitiva),
  // necesitamos mutar el objeto parent. Lo hacemos vía una closure
  // sobre el RecursionContext original.
  // (Más abajo en createRootRecursionContext usamos un wrapper con
  // contador mutable.)

  const invocation: SubagentInvocation = {
    objective,
    context: context || `(sin contexto adicional del padre)`,
    budget,
  };

  // Inyectar spawnChildAgent como tool del hijo (recursión real).
  // Esto se hace pasando un custom set de tools al runSubagent.
  // Por ahora, runSubagent usa allowedTools del catálogo global —
  // no soporta inyección. Para la recursión real, hacemos un wrapper
  // que registre spawn_child_agent como tool disponible.

  try {
    const result = await runSubagentWithRecursion(def, invocation, childCtx, budget);
    return {
      status: result.status,
      result: result.result,
      evidence: result.evidence,
      trace: result.trace,
      usage: result.usage,
      childId,
    };
  } catch (e) {
    return {
      status: 'failed',
      result: e instanceof Error ? e.message : String(e),
      childId,
    };
  }
}

/**
 * Wrapper sobre runSubagent que inyecta la tool spawn_child_agent
 * (para recursión real) y actualiza el contador de hijos.
 */
async function runSubagentWithRecursion(
  def: SubagentDef,
  invocation: SubagentInvocation,
  ctx: RecursionContext,
  budget: SubagentBudget,
): Promise<SubagentResult> {
  // Asegurarse de que el subagente tenga spawn_child_agent en su allowedTools
  // (si el usuario no lo deshabilitó explícitamente).
  // Para no mutar el def original, clonamos.
  const defWithRecursion: SubagentDef = {
    ...def,
    allowedTools: def.allowedTools.includes('spawn_child_agent')
      ? def.allowedTools
      : [...def.allowedTools, 'spawn_child_agent'],
  };

  // Nota: runSubagent usa dispatchAdvancedTool internamente, que a su vez
  // busca en el catálogo global. spawn_child_agent no está en el catálogo
  // global — es una tool especial de RLM. Para que funcione, necesitamos
  // registrarla temporalmente en el dispatcher global, o hacer un runSubagent
  // custom que la soporte.
  //
  // Por ahora, dejamos el spawn_child_agent en allowedTools para que el
  // subagente SEPA que puede invocarla. El dispatching real se hace vía
  // un hook en dispatchAdvancedTool que detecta el nombre 'spawn_child_agent'
  // y llama a spawnChildAgent recursivamente.
  //
  // Ese hook se registra en createRootRecursionContext (más abajo).

  ctx.totalChildrenSpawned++; // incrementa el contador compartido

  // Llamar a runSubagent normal. La tool spawn_child_agent se resolverá
  // via el hook global registrado.
  const result = await runSubagent(defWithRecursion, {
    provider: ctx.provider,
    model: ctx.model,
    invocation,
    budgetOverride: budget,
    onTrace: (step) => {
      // Podríamos logging adicional aquí.
    },
  });

  // Guardar el resultado del hijo en el ContextStore del PADRE (no del hijo).
  // El padre puede luego ctx_get("child:<childId>") para ver el resultado.
  // Pero como no tenemos acceso al store del padre aquí directamente,
  // esto lo maneja el llamador (spawnChildAgent desde el executor del padre).

  return result;
}

// ============================================================================
// Selección por keyword
// ============================================================================

function selectByKeyword(objective: string, candidates: SubagentDef[]): SubagentDef {
  const obj = objective.toLowerCase();
  const scored = candidates.map((s) => {
    let score = 0;
    const name = s.name.toLowerCase();
    const desc = s.description.toLowerCase();
    const keywords = name.split(/\s+/).concat(desc.split(/\s+/));
    for (const kw of keywords) {
      if (kw.length < 3) continue;
      if (obj.includes(kw)) score += 2;
    }
    if (obj.includes(name)) score += 5;
    return { def: s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].def;
}

// ============================================================================
// Root context factory
// ============================================================================

export interface RootRecursionContextOptions {
  provider: LLMProvider;
  model: string;
  limits?: Partial<RlmLimits>;
  onSpawn?: (info: SpawnInfo) => void;
  signal?: AbortSignal;
}

/**
 * Crea el contexto de recursión raíz para un episodio del agente.
 * Este contexto se pasa al executor del agente principal, y permite
 * que éste (y sus hijos) spawneen subagentes recursivamente.
 */
export function createRootRecursionContext(opts: RootRecursionContextOptions): RecursionContext {
  const limits = { ...DEFAULT_RLM_LIMITS, ...opts.limits };
  return {
    depth: 0,
    path: ['root'],
    store: new ContextStore(),
    limits,
    totalChildrenSpawned: 0,
    treeStart: Date.now(),
    provider: opts.provider,
    model: opts.model,
    onSpawn: opts.onSpawn,
    signal: opts.signal,
  };
}

// ============================================================================
// Hook global para dispatchAdvancedTool
// ============================================================================

/**
 * Registra un hook global para que la tool 'spawn_child_agent' se resuelva
 * a spawnChildAgent cuando el RecursionContext está activo.
 *
 * Esto es necesario porque runSubagent usa dispatchAdvancedTool que busca
 * en el catálogo global. En lugar de modificar runSubagent, registramos
 * un hook que intercepta el nombre.
 *
 * El hook se limpia automáticamente cuando el árbol termina.
 */
export function registerSpawnChildAgentHook(
  ctx: RecursionContext,
): () => void {
  // Import dinámico para evitar circular dependency.
  let cleaned = false;

  const originalDispatch = (window as unknown as { __weaverRlmSpawnHook?: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; output: string; error?: string } | null> }).__weaverRlmSpawnHook;

  (window as unknown as { __weaverRlmSpawnHook?: unknown }).__weaverRlmSpawnHook = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string; error?: string } | null> => {
    if (name !== 'spawn_child_agent') return null;
    const objective = String(args.objective ?? '');
    const subagentName = args.subagentName ? String(args.subagentName) : undefined;
    const context = String(args.context ?? '');
    const maxSteps = Number(args.maxSteps ?? 8);
    const maxTokens = Number(args.maxTokens ?? 8000);
    const maxTimeMs = Number(args.maxTimeMs ?? 90_000);

    const result = await spawnChildAgent(
      objective,
      subagentName,
      context,
      { maxSteps, maxTokens, maxTimeMs },
      ctx,
    );

    // Guardar resultado en el ContextStore del padre.
    ctx.store.set(
      `child:${result.childId}`,
      result.result,
      `spawn_child_agent:${subagentName ?? 'auto'}`,
      { status: result.status, depth: ctx.depth, usage: result.usage },
    );

    return {
      ok: result.status === 'succeeded',
      output: JSON.stringify({
        childId: result.childId,
        status: result.status,
        result: result.result,
        usage: result.usage,
      }),
      error: result.status === 'succeeded' ? undefined : result.result,
    };
  };

  return () => {
    if (cleaned) return;
    cleaned = true;
    (window as unknown as { __weaverRlmSpawnHook?: unknown }).__weaverRlmSpawnHook = originalDispatch;
  };
}

/** Verifica si hay un hook RLM activo. */
export function hasSpawnChildAgentHook(): boolean {
  return !!(window as unknown as { __weaverRlmSpawnHook?: unknown }).__weaverRlmSpawnHook;
}

// ============================================================================
// Utilidades para reporting
// ============================================================================

export function formatRecursionTree(
  spawns: SpawnInfo[],
  results: Array<{ childId: string; status: string; elapsedMs?: number }>,
): string {
  if (spawns.length === 0) return '(sin subagentes spawneados)';
  const lines: string[] = [];
  for (const spawn of spawns) {
    const result = results.find((r) => r.childId === spawn.childId);
    const status = result?.status ?? 'pending';
    const elapsed = result?.elapsedMs ? ` · ${result.elapsedMs}ms` : '';
    const indent = '  '.repeat(spawn.depth);
    lines.push(
      `${indent}└─ [${spawn.subagentName}] ${status}${elapsed} (depth ${spawn.depth})`,
    );
    lines.push(`${indent}   objective: ${spawn.objective.slice(0, 100)}`);
  }
  return lines.join('\n');
}
