/**
 * RLM-3 — /refine command.
 *
 * Implementa auto-refinamiento del scaffolding del agente.
 *
 * Inspirado en el experimento de Seth Karten: el agente analiza sus
 * propias trazas de ejecución y propone cambios a su scaffolding
 * (prompts, skills, subagentes) sin intervención humana.
 *
 * Mecanismo de seguridad:
 *   - Antes de aplicar un cambio, se guarda un snapshot del estado actual.
 *   - Si el rendimiento decae tras N ejecuciones posteriores, se revert
 *     automáticamente al snapshot.
 *   - Si mejora o se mantiene, el cambio se "promueve" y se limpia el snapshot.
 *
 * Tipos de refinamiento soportados:
 *   - prompt_refine: mejora el systemPrompt de un subagente.
 *   - skill_create: crea una nueva skill a partir de un patrón detectado.
 *   - skill_update: modifica una skill existente.
 *   - subagent_create: crea un nuevo subagente especializado.
 *   - tool_allowlist_update: añade/quita tools de un subagente.
 */

import type { LLMProvider, Message } from '@/providers/types';
import type { Episode, TraceStep } from '../types';
import { streamUntilDone } from '@/lib/chain';
import { skillsRegistry } from '@/skills/registry';
import { subagentRegistry, type SubagentDef } from '../subagent';

// ============================================================================
// Tipos
// ============================================================================

export type RefineActionType =
  | 'prompt_refine'
  | 'skill_create'
  | 'skill_update'
  | 'subagent_create'
  | 'tool_allowlist_update';

export interface RefineAction {
  type: RefineActionType;
  /** Para prompt_refine: ID del subagente. Para skill_*: nombre de la skill. */
  target: string;
  /** Descripción human-readable del cambio propuesto. */
  description: string;
  /** Cambio específico a aplicar (JSON). */
  patch: Record<string, unknown>;
  /** Razón por la que el agente propone este cambio. */
  rationale: string;
  /** Métrica esperada (ej. "reduce steps by 30%"). */
  expectedImprovement?: string;
}

export interface RefineResult {
  actions: RefineAction[];
  /** Snapshot del estado pre-refinamiento (para revert). */
  snapshot: RefineSnapshot;
  /** True si se aplicaron los cambios. False si sólo se devolvieron para aprobación. */
  applied: boolean;
  /** Resumen legible del refinamiento. */
  summary: string;
}

export interface RefineSnapshot {
  timestamp: number;
  subagents: SubagentDef[];
  skills: unknown[];
  contextStoreSize: number;
  traceSteps: number;
  /** Versión del snapshot (para distinguir). */
  version: number;
}

export interface RefineEvaluation {
  /** Mejoró, empeoró o se mantuvo igual tras el refinamiento. */
  outcome: 'improved' | 'regressed' | 'neutral';
  /** Métrica comparada (ej. tokens ahorrados, pasos reducidos). */
  delta: {
    tokens?: number;
    steps?: number;
    elapsedMs?: number;
  };
  /** True si se debe revertir al snapshot. */
  shouldRevert: boolean;
}

// ============================================================================
// Prompt del refinador
// ============================================================================

const REFINE_SYSTEM_PROMPT = `Eres el módulo de Auto-Refinamiento de Weaver (RLM-3).

Analizas las trazas de ejecución del agente y propones cambios concretos a su scaffolding para mejorar rendimiento, reducir tokens o evitar errores repetidos.

Tipos de cambios que puedes proponer:
- prompt_refine: mejorar el systemPrompt de un subagente existente.
- skill_create: crear una nueva skill reutilizable a partir de un patrón detectado.
- skill_update: modificar una skill existente.
- subagent_create: crear un nuevo subagente especializado.
- tool_allowlist_update: añadir/quita tools de un subagente.

Reglas:
1. Sólo propone cambios que tengan evidencia en las trazas (no inventes problemas).
2. Cada cambio debe incluir rationale claro y expectedImprovement medible.
3. Máximo 3 cambios por refinamiento (no satures).
4. Si las trazas no muestran problemas, devuelve actions: [].

Devuelve ÚNICAMENTE JSON:
{
  "actions": [
    {
      "type": "prompt_refine" | "skill_create" | "skill_update" | "subagent_create" | "tool_allowlist_update",
      "target": "id o nombre del target",
      "description": "descripción breve del cambio",
      "patch": { ...cambio específico... },
      "rationale": "por qué este cambio ayudará",
      "expectedImprovement": "métrica esperada"
    }
  ],
  "summary": "resumen de 1-2 líneas"
}`;

// ============================================================================
// Refine runner
// ============================================================================

export interface RefineOpts {
  /** Si true, aplica los cambios automáticamente. Si false, sólo los devuelve. */
  autoApply?: boolean;
  /** Número de episodios recientes a considerar para la evaluación. */
  evaluationWindow?: number;
}

export async function refine(
  provider: LLMProvider,
  model: string,
  episode: Episode,
  recentEpisodes: Episode[] = [],
  opts: RefineOpts = {},
): Promise<RefineResult> {
  const autoApply = opts.autoApply ?? false;

  // 1. Tomar snapshot del estado actual.
  const snapshot = takeSnapshot(episode);

  // 2. Construir prompt con trazas.
  const messages = buildRefineMessages(episode, recentEpisodes);

  // 3. Llamar al LLM.
  const text = await streamUntilDone(provider, model, messages, { maxChains: 3 });
  const json = extractJson(text);

  if (!json) {
    return {
      actions: [],
      snapshot,
      applied: false,
      summary: 'No se pudo generar refinamiento (LLM no devolvió JSON válido).',
    };
  }

  let actions: RefineAction[] = [];
  let summary = '';
  try {
    const parsed = JSON.parse(json) as { actions?: RefineAction[]; summary?: string };
    actions = (parsed.actions ?? []).slice(0, 3); // hard cap
    summary = parsed.summary ?? 'Refinamiento generado.';
  } catch {
    return {
      actions: [],
      snapshot,
      applied: false,
      summary: 'Refinamiento inválido (JSON parse error).',
    };
  }

  // 4. Aplicar cambios si autoApply.
  let applied = false;
  if (autoApply && actions.length > 0) {
    applied = true;
    for (const action of actions) {
      try {
        await applyRefineAction(action);
      } catch (e) {
        console.warn(`Failed to apply refine action ${action.type}:`, e);
      }
    }
  }

  return { actions, snapshot, applied, summary };
}

// ============================================================================
// Aplicar / revertir acciones
// ============================================================================

async function applyRefineAction(action: RefineAction): Promise<void> {
  switch (action.type) {
    case 'prompt_refine': {
      const def = subagentRegistry.get(action.target);
      if (!def) throw new Error(`Subagente ${action.target} no encontrado`);
      const newPrompt = action.patch.systemPrompt as string;
      if (!newPrompt) throw new Error('patch.systemPrompt requerido');
      subagentRegistry.save({ ...def, systemPrompt: newPrompt });
      break;
    }

    case 'skill_create': {
      const patch = action.patch as {
        name: string;
        description: string;
        triggers: string[];
        body: string;
      };
      await skillsRegistry.saveLearnedSkill({
        name: patch.name,
        description: patch.description,
        triggers: patch.triggers,
        toolsRequired: [],
        body: patch.body,
        source: 'learned',
      });
      break;
    }

    case 'skill_update': {
      // skillsRegistry no tiene update directo — usamos saveLearnedSkill que sobrescribe.
      const patch = action.patch as {
        name: string;
        description: string;
        triggers: string[];
        body: string;
      };
      await skillsRegistry.saveLearnedSkill({
        name: patch.name,
        description: patch.description,
        triggers: patch.triggers,
        toolsRequired: [],
        body: patch.body,
        source: 'learned',
      });
      break;
    }

    case 'subagent_create': {
      const patch = action.patch as Partial<SubagentDef>;
      if (!patch.name) throw new Error('patch.name requerido');
      const def: SubagentDef = {
        id: patch.id ?? `refined-${Date.now()}`,
        name: patch.name,
        description: patch.description ?? '',
        providerId: patch.providerId ?? null,
        model: patch.model ?? null,
        allowedTools: patch.allowedTools ?? [],
        systemPrompt: patch.systemPrompt ?? '',
        verificationPrompt: patch.verificationPrompt ?? '',
        defaultBudget: patch.defaultBudget ?? { maxSteps: 6, maxTokens: 6000, maxTimeMs: 60_000 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      subagentRegistry.save(def);
      break;
    }

    case 'tool_allowlist_update': {
      const def = subagentRegistry.get(action.target);
      if (!def) throw new Error(`Subagente ${action.target} no encontrado`);
      const addTools = (action.patch.add as string[] | undefined) ?? [];
      const removeTools = (action.patch.remove as string[] | undefined) ?? [];
      const newAllowed = [
        ...def.allowedTools.filter((t) => !removeTools.includes(t)),
        ...addTools.filter((t) => !def.allowedTools.includes(t)),
      ];
      subagentRegistry.save({ ...def, allowedTools: newAllowed });
      break;
    }
  }
}

/** Revierte al snapshot. */
export async function revertToSnapshot(snapshot: RefineSnapshot): Promise<void> {
  // Restaurar subagentes.
  const currentSubagents = subagentRegistry.list();
  for (const sa of currentSubagents) {
    if (!snapshot.subagents.find((s) => s.id === sa.id)) {
      subagentRegistry.delete(sa.id);
    }
  }
  for (const sa of snapshot.subagents) {
    subagentRegistry.save(sa);
  }
  // Skills: no se pueden des-borrar fácilmente, pero sí sobrescribir.
  // Para una implementación completa, habría que guardar snapshots de skills también.
}

// ============================================================================
// Evaluación post-refinamiento
// ============================================================================

export function evaluateRefine(
  before: RefineSnapshot,
  afterEpisodes: Episode[],
): RefineEvaluation {
  if (afterEpisodes.length === 0) {
    return { outcome: 'neutral', delta: {}, shouldRevert: false };
  }

  // Calcular métricas promedio de los episodios posteriores.
  const afterTokens = afterEpisodes.reduce(
    (sum, e) => sum + estimateEpisodeTokens(e),
    0,
  ) / afterEpisodes.length;
  const afterSteps = afterEpisodes.reduce(
    (sum, e) => sum + e.plan.subtasks.reduce((s2, st) => s2 + st.attempts, 0),
    0,
  ) / afterEpisodes.length;
  const afterMs = afterEpisodes.reduce(
    (sum, e) => sum + ((e.finishedAt ?? 0) - e.startedAt),
    0,
  ) / afterEpisodes.length;

  // Comparar con el snapshot (approx: traceSteps * 500 tokens/step).
  const beforeTokens = snapshotToEstimatedTokens(before);
  const beforeSteps = before.traceSteps;
  const beforeMs = 30_000; // placeholder

  const tokensDelta = beforeTokens - afterTokens;
  const stepsDelta = beforeSteps - afterSteps;
  const msDelta = beforeMs - afterMs;

  // Decidir outcome.
  let outcome: RefineEvaluation['outcome'] = 'neutral';
  let shouldRevert = false;

  if (tokensDelta > 0 && stepsDelta > 0) {
    outcome = 'improved';
  } else if (tokensDelta < -1000 || stepsDelta < -3) {
    outcome = 'regressed';
    shouldRevert = true;
  }

  return {
    outcome,
    delta: {
      tokens: tokensDelta,
      steps: stepsDelta,
      elapsedMs: msDelta,
    },
    shouldRevert,
  };
}

function estimateEpisodeTokens(e: Episode): number {
  // Aproximación: cada traceStep ≈ 500 tokens.
  return e.plan.subtasks.reduce(
    (sum, s) => sum + s.trace.length * 500,
    0,
  );
}

function snapshotToEstimatedTokens(s: RefineSnapshot): number {
  return s.traceSteps * 500;
}

// ============================================================================
// Snapshot
// ============================================================================

function takeSnapshot(episode: Episode): RefineSnapshot {
  return {
    timestamp: Date.now(),
    subagents: subagentRegistry.list().map((s) => ({ ...s })),
    skills: [],
    contextStoreSize: 0,
    traceSteps: episode.plan.subtasks.reduce((sum, s) => sum + s.trace.length, 0),
    version: 1,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function buildRefineMessages(episode: Episode, recentEpisodes: Episode[]): Message[] {
  const recentTrace = episode.plan.subtasks
    .flatMap((s) => s.trace.map((t) => `[${s.id.slice(0, 4)}][${t.kind}] ${t.content}`))
    .slice(-30);

  const recentOutcome: string[] = recentEpisodes.length > 0
    ? recentEpisodes.map((e) => `- ${e.outcome} (${e.plan.subtasks.reduce((s, st) => s + st.attempts, 0)} attempts, ${e.plan.subtasks.reduce((s, st) => s + st.trace.length, 0)} steps)`)
    : ['(sin episodios recientes)'];

  const subagents = subagentRegistry.list().map((s) =>
    `- ${s.name} (${s.id}): ${s.description} — tools: ${s.allowedTools.join(', ')}`,
  );

  return [
    { role: 'system', content: REFINE_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Analiza este episodio y propón refinamientos:

OBJETIVO: ${episode.objective}
OUTCOME: ${episode.outcome}

SUBTAREAS:
${episode.plan.subtasks.map((s, i) =>
  `${i + 1}. ${s.description} → ${s.status} (intentos: ${s.attempts})`,
).join('\n')}

TRAZA RECIENTE (últimos 30 pasos):
${recentTrace.join('\n')}

EPISODIOS RECIENTES:
${recentOutcome.join('\n')}

SUBAGENTES REGISTRADOS:
${subagents.join('\n') || '(ninguno)'}

Propón cambios concretos para mejorar.`,
    },
  ];
}

function extractJson(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// ============================================================================
// Comando /refine — para invocar desde el chat del usuario
// ============================================================================

export interface RefineCommandResult {
  ok: boolean;
  message: string;
  actionsCount: number;
  applied: boolean;
}

/**
 * Comando /refine — lo invoca el usuario desde el chat.
 * Toma el último episodio, lo analiza, y propone/aplica cambios.
 */
export async function runRefineCommand(
  provider: LLMProvider,
  model: string,
  recentEpisodes: Episode[] = [],
  autoApply = false,
): Promise<RefineCommandResult> {
  if (recentEpisodes.length === 0) {
    return {
      ok: false,
      message: 'No hay episodios recientes para refinar.',
      actionsCount: 0,
      applied: false,
    };
  }

  const lastEpisode = recentEpisodes[0];
  const result = await refine(provider, model, lastEpisode, recentEpisodes.slice(1, 5), { autoApply });

  let message = result.summary;
  if (result.actions.length > 0) {
    message += '\n\nCambios propuestos:\n';
    message += result.actions.map((a, i) =>
      `${i + 1}. [${a.type}] ${a.target}: ${a.description}\n   Razón: ${a.rationale}`,
    ).join('\n');
    if (result.applied) {
      message += '\n\n✓ Cambios aplicados. Se guardó snapshot para revert si empeora.';
    } else {
      message += '\n\n(Cambios NO aplicados — usa autoApply=true para aplicarlos.)';
    }
  }

  return {
    ok: true,
    message,
    actionsCount: result.actions.length,
    applied: result.applied,
  };
}
