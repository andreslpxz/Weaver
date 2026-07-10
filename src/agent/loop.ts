/**
 * Bucle agéntico principal: orquesta planner → executor → critic → reflection.
 *
 * Uso:
 *   const runner = runAgent(provider, model, "Abre gedit y escribe Hola", { onEvent });
 *   for await (const event of runner) { ... }
 */

import type { LLMProvider } from '@/providers/types';
import type { Episode, Objective, Plan, Subtask, TraceStep } from './types';
import { plan as makePlan } from './planner';
import { executeSubtask } from './executor';
import { critique } from './critic';
import { reflect } from './reflection';
import { memory } from './memory';

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
  | { type: 'error'; message: string };

export interface RunAgentOptions {
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
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

  try {
    yield emit({ type: 'planning_started' });

    // Contexto para el planner.
    const similarEpisodes = await memory.findSimilar(objectiveText, 2);
    const similar = similarEpisodes.map((e) => e.objective);
    const plan = await makePlan(provider, model, objective, { similarEpisodes: similar });
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

      const execResult = await executeSubtask(provider, model, next, {
        onTrace: (step) => emit({ type: 'trace', subtaskId: next.id, step }),
      });
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
  }
}

function pickNext(plan: Plan, completed: Set<string>): Subtask | undefined {
  return plan.subtasks.find(
    (s) => s.status === 'pending' && s.dependsOn.every((dep) => completed.has(plan.subtasks[dep]?.id ?? '')),
  );
}
