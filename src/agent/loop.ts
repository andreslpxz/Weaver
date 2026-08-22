/**
 * Bucle agéntico principal: orquesta planner → executor → critic → reflection.
 *
 * Uso:
 *   const runner = runAgent(provider, model, "Abre gedit y escribe Hola", { onEvent });
 *   for await (const event of runner) { ... }
 *
 * Modo RLM (Recursive Language Model):
 *   runAgent(provider, model, "objetivo", { useRlm: true, onEvent })
 *
 * Cuando useRlm=true, el executor usado es executeWithRlm (en vez del
 * executor legacy). Esto activa:
 *   - ContextStore (contexto como variable)
 *   - Tools de contexto (ctx_set/get/list, file_view_*, spawn_child_agent)
 *   - Recursión de subagentes con depth limit
 *   - Hook global para spawn_child_agent
 *
 * El evento 'rlm_context_updated' se emite cuando el ContextStore cambia,
 * para que la UI pueda reflejar los fragmentos disponibles.
 */

import type { LLMProvider } from '@/providers/types';
import type { Episode, Objective, Plan, Subtask, TraceStep } from './types';
import { plan as makePlan } from './planner';
import { executeSubtask } from './executor';
import { critique } from './critic';
import { reflect } from './reflection';
import { memory } from './memory';
import {
  executeWithRlm,
  createRootRecursionContext,
  registerSpawnChildAgentHook,
  type RecursionContext,
  type SpawnInfo,
  type ContextFragment,
} from './rlm';

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}`;

export type AgentEvent =
  | { type: 'planning_started' }
  | { type: 'plan_ready'; plan: Plan }
  | { type: 'subtask_started'; subtask: Subtask }
  | { type: 'trace'; subtaskId: string; step: TraceStep }
  | { type: 'subtask_finished'; subtask: Subtask; status: 'succeeded' | 'failed' | 'stuck'; summary: string }
  | { type: 'critic_verdict'; subtaskId: string; verdict: 'satisfied' | 'failed'; reason: string }
  | { type: 'replanning'; reason: string }
  | { type: 'reflection_started' }
  | { type: 'episode_finished'; episode: Episode }
  | { type: 'rlm_spawn'; info: SpawnInfo }
  | { type: 'rlm_context_updated'; fragments: ContextFragment[]; totalSize: number }
  | { type: 'error'; message: string };

export interface RunAgentOptions {
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
  /** Si true, usa executeWithRlm en vez del executor legacy. */
  useRlm?: boolean;
  /** Límites de recursión RLM (sólo si useRlm=true). */
  rlmLimits?: Partial<import('./rlm').RlmLimits>;
}

export async function* runAgent(
  provider: LLMProvider,
  model: string,
  objectiveText: string,
  opts: RunAgentOptions = {},
): AsyncGenerator<AgentEvent> {
  const objective: Objective = { id: newId(), text: objectiveText, createdAt: Date.now() };
  const emit = (e: AgentEvent) => {
    opts.onEvent?.(e);
    return e;
  };

  // Configurar contexto RLM si useRlm=true.
  let rlmCtx: RecursionContext | undefined;
  let cleanupRlmHook: (() => void) | undefined;
  const spawns: SpawnInfo[] = [];

  if (opts.useRlm) {
    rlmCtx = createRootRecursionContext({
      provider,
      model,
      limits: opts.rlmLimits,
      onSpawn: (info) => {
        spawns.push(info);
        emit({ type: 'rlm_spawn', info });
      },
      signal: opts.signal,
    });
    cleanupRlmHook = registerSpawnChildAgentHook(rlmCtx);
  }

  try {
    yield emit({ type: 'planning_started' });

    // Contexto para el planner.
    const similarEpisodes = await memory.findSimilar(objectiveText, 2);
    const similar = similarEpisodes.map((e) => e.objective);
    const plan = await makePlan(provider, model, objective, { similarEpisodes: similar }, { signal: opts.signal });
    yield emit({ type: 'plan_ready', plan });

    // Ejecutar subtareas en orden topológico.
    const completed = new Set<string>();
    let guard = 0;
    while (completed.size < plan.subtasks.length && guard < plan.subtasks.length * 2) {
      guard++;
      const next = pickNext(plan, completed);
      if (!next) break;

      next.status = 'in_progress';
      next.attempts++;
      yield emit({ type: 'subtask_started', subtask: next });

      let execResult: { status: 'succeeded' | 'failed' | 'stuck'; summary: string; trace: TraceStep[] };

      if (opts.useRlm && rlmCtx) {
        // Modo RLM: usar executeWithRlm.
        const rlmResult = await executeWithRlm(provider, model, next.description, next.successCriteria, {
          recursionCtx: rlmCtx,
          maxSteps: 12,
          signal: opts.signal,
          onTrace: (step) => emit({ type: 'trace', subtaskId: next.id, step }),
        });
        execResult = {
          status: rlmResult.status,
          summary: rlmResult.summary,
          trace: rlmResult.trace,
        };
        // Emitir actualización del context store para la UI.
        const fragments = rlmCtx.store.list().map((f) => ({ ...f })) as ContextFragment[];
        emit({
          type: 'rlm_context_updated',
          fragments,
          totalSize: rlmCtx.store.totalSize(),
        });
      } else {
        // Modo legacy: executor AT-SPI estándar.
        execResult = await executeSubtask(provider, model, next, {
          signal: opts.signal,
          onTrace: (step) => emit({ type: 'trace', subtaskId: next.id, step }),
        });
      }
      next.trace.push(...execResult.trace);

      // Crítico.
      const verdict = await critique(provider, model, next);
      yield emit({ type: 'critic_verdict', subtaskId: next.id, verdict: verdict.verdict, reason: verdict.reason });

      if (verdict.verdict === 'satisfied' || execResult.status === 'succeeded') {
        next.status = 'succeeded';
        next.lesson = execResult.summary;
        completed.add(next.id);
        yield emit({
          type: 'subtask_finished',
          subtask: next,
          status: 'succeeded',
          summary: execResult.summary,
        });
      } else if (next.attempts >= next.maxAttempts) {
        next.status = 'failed';
        yield emit({
          type: 'subtask_finished',
          subtask: next,
          status: 'failed',
          summary: execResult.summary || verdict.reason,
        });
        yield emit({ type: 'replanning', reason: `Subtarea ${next.id} falló tras ${next.attempts} intentos` });
        // Por simplicidad, marcamos como failed y continuamos con las que no dependen.
        completed.add(next.id);
      } else {
        // Reintento en siguiente iteración.
        next.status = 'pending';
        yield emit({
          type: 'subtask_finished',
          subtask: next,
          status: 'failed',
          summary: execResult.summary || verdict.reason,
        });
      }
    }

    // Reflexión.
    yield emit({ type: 'reflection_started' });
    const outcome: Episode['outcome'] = plan.subtasks.every((s) => s.status === 'succeeded')
      ? 'success'
      : plan.subtasks.some((s) => s.status === 'succeeded')
        ? 'partial'
        : 'failure';

    const episode: Episode = {
      id: newId(),
      objective: objectiveText,
      plan,
      startedAt: objective.createdAt,
      finishedAt: Date.now(),
      outcome,
      lessons: [],
    };

    try {
      const reflection = await reflect(provider, model, episode);
      episode.lessons = reflection.lessons;
      episode.skillGenerated = reflection.skill?.name;
      if (reflection.skill) {
        // TODO: persistir skill a ~/.weaver/skills/learned/<name>.md vía Tauri command.
        console.info('[Weaver] Skill aprendida (no persistida aún):', reflection.skill.name);
      }
    } catch (e) {
      console.warn('[Weaver] reflexión falló:', e);
    }

    memory.saveEpisode(episode);
    yield emit({ type: 'episode_finished', episode });
  } catch (e) {
    yield emit({
      type: 'error',
      message: e instanceof Error ? e.message : String(e),
    });
  } finally {
    // Limpiar hook global RLM si estaba activo.
    cleanupRlmHook?.();
  }
}

function pickNext(plan: Plan, completed: Set<string>): Subtask | undefined {
  return plan.subtasks.find(
    (s) => s.status === 'pending' && s.dependsOn.every((dep) => completed.has(plan.subtasks[dep]?.id ?? '')),
  );
}
