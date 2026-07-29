/**
 * orchestrator.ts
 *
 * Orquestador de subagentes.
 *
 * Recibe un objetivo complejo, decide qué subagente(s) invocar, reparte
 * presupuesto, reintenta con otro subagente si falla, escala a plan
 * alternativo si hay timeout, y construye un ÁRBOL DE EJECUCIÓN
 * trazable (qué subagente hizo qué, con qué evidencia).
 *
 * Contrato con subagentes: ver ./subagent.ts (SubagentInvocation/Result).
 *
 * Trazabilidad:
 *   Cada invocación produce un ExecutionNode con:
 *     - subagentId, subagentName
 *     - invocation (objective + context + budget)
 *     - result (status + result + evidence + usage)
 *     - children (si el subagente invocó sub-subagentes — futuro)
 *
 * El árbol se puede serializar a JSON y exponer en la UI para depurar.
 */

import type { LLMProvider } from '@/providers/types';
import {
  subagentRegistry,
  runSubagent,
  type SubagentDef,
  type SubagentInvocation,
  type SubagentBudget,
  type SubagentResult,
  type SubagentStatus,
} from './subagent';
import { metrics } from '@/lib/metrics';

// ============================================================================
// Tipos
// ============================================================================

export interface ExecutionNode {
  id: string;
  subagentId: string;
  subagentName: string;
  invocation: SubagentInvocation;
  result: SubagentResult;
  children: ExecutionNode[];
  startedAt: number;
  finishedAt: number;
}

export interface OrchestratorInput {
  objective: string;
  /** Contexto mínimo que se pasa al primer subagente. */
  context: string;
  /** Presupuesto total del orquestador. */
  totalBudget: SubagentBudget;
  /** Si true, reintenta con otro subagente cuando el primero falla. */
  allowRetry?: boolean;
  /** Si true, escala a plan alternativo cuando hay timeout/budget_exceeded. */
  allowEscalation?: boolean;
}

export interface OrchestratorOutput {
  status: SubagentStatus | 'no_subagent_available';
  objective: string;
  tree: ExecutionNode[];
  totalCost: {
    inputTokens: number;
    outputTokens: number;
    steps: number;
    elapsedMs: number;
  };
  finalResult: string;
  evidence: { subagentName: string; kind: string; label: string; content: string }[];
}

// ============================================================================
// Orquestador
// ============================================================================

export interface OrchestratorOpts {
  provider: LLMProvider;
  model: string;
}

export async function orchestrate(
  input: OrchestratorInput,
  opts: OrchestratorOpts,
): Promise<OrchestratorOutput> {
  const tree: ExecutionNode[] = [];
  const start = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalSteps = 0;
  const allEvidence: OrchestratorOutput['evidence'] = [];

  // 1. Seleccionar subagente(s) candidatos por keyword match en descripción/name.
  const candidates = selectCandidates(input.objective);

  if (candidates.length === 0) {
    return {
      status: 'no_subagent_available',
      objective: input.objective,
      tree,
      totalCost: { inputTokens: 0, outputTokens: 0, steps: 0, elapsedMs: 0 },
      finalResult: 'No hay subagente registrado que parezca adecuado para esta tarea.',
      evidence: [],
    };
  }

  let finalStatus: SubagentStatus = 'failed';
  let finalResult = '';

  // 2. Probar cada candidato en orden hasta que uno tenga éxito (si allowRetry).
  const maxAttempts = input.allowRetry ? Math.min(candidates.length, 3) : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const def = candidates[attempt];
    const budget = splitBudget(input.totalBudget, maxAttempts);

    const invocation: SubagentInvocation = {
      objective: input.objective,
      context: input.context,
      budget,
    };

    const nodeStart = Date.now();
    const result = await runSubagent(def, {
      provider: opts.provider,
      model: opts.model,
      invocation,
      budgetOverride: budget,
    });
    const node: ExecutionNode = {
      id: `node-${Date.now()}-${attempt}`,
      subagentId: def.id,
      subagentName: def.name,
      invocation,
      result,
      children: [],
      startedAt: nodeStart,
      finishedAt: Date.now(),
    };
    tree.push(node);

    totalInputTokens += result.usage.inputTokens;
    totalOutputTokens += result.usage.outputTokens;
    totalSteps += result.usage.steps;

    for (const ev of result.evidence) {
      allEvidence.push({
        subagentName: def.name,
        kind: ev.kind,
        label: ev.label,
        content: ev.content,
      });
    }

    if (result.status === 'succeeded') {
      finalStatus = 'succeeded';
      finalResult = result.result;
      break;
    }

    // Si fue timeout o budget_exceeded y allowEscalation, salir y devolver
    // el estado para que el llamador decida el plan alternativo.
    if (
      (result.status === 'timeout' || result.status === 'budget_exceeded') &&
      !input.allowEscalation
    ) {
      finalStatus = result.status;
      finalResult = result.result;
      break;
    }

    // Si fue el último intento, registrar el fallo.
    if (attempt === maxAttempts - 1) {
      finalStatus = result.status;
      finalResult = result.result;
    }
    // Sino, continuar con el siguiente candidato.
  }

  // Registrar éxito/fracaso agregado en métricas.
  metrics.recordUsage({
    providerId: opts.provider.info.id,
    model: opts.model,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    source: 'orchestrator',
    success: finalStatus === 'succeeded',
    taskKind: 'orchestration',
    elapsedMs: Date.now() - start,
  });

  return {
    status: finalStatus,
    objective: input.objective,
    tree,
    totalCost: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      steps: totalSteps,
      elapsedMs: Date.now() - start,
    },
    finalResult,
    evidence: allEvidence,
  };
}

// ============================================================================
// Selección de subagentes candidatos
// ============================================================================

function selectCandidates(objective: string): SubagentDef[] {
  const all = subagentRegistry.list();
  if (all.length === 0) return [];

  const obj = objective.toLowerCase();
  const scored = all.map((s) => {
    let score = 0;
    const name = s.name.toLowerCase();
    const desc = s.description.toLowerCase();

    // Coincidencias por keyword
    const keywords = name.split(/\s+/).concat(desc.split(/\s+/));
    for (const kw of keywords) {
      if (kw.length < 3) continue;
      if (obj.includes(kw)) score += 2;
    }

    // Bonus por nombre exacto en objetivo
    if (obj.includes(name)) score += 5;

    return { def: s, score };
  });

  // Ordenar por score descendente; si todos tienen 0, devolverlos en orden original.
  scored.sort((a, b) => b.score - a.score);
  const withScore = scored.filter((s) => s.score > 0);
  const result = (withScore.length > 0 ? withScore : scored).map((s) => s.def);
  return result;
}

// ============================================================================
// Particiona el presupuesto total entre N intentos
// ============================================================================

function splitBudget(total: SubagentBudget, attempts: number): SubagentBudget {
  if (attempts <= 1) return total;
  // Cada intento recibe 60% del presupuesto total — suficiente para reintentar
  // sin quedarse sin margen si el primer intento gasta poco.
  const factor = 0.6;
  return {
    maxSteps: Math.max(2, Math.floor(total.maxSteps * factor)),
    maxTokens: Math.max(1000, Math.floor(total.maxTokens * factor)),
    maxTimeMs: Math.max(10_000, Math.floor(total.maxTimeMs * factor)),
  };
}

// ============================================================================
// Helper: serializa un árbol de ejecución a texto legible para mostrar
// en el chat o en logs.
// ============================================================================

export function formatExecutionTree(tree: ExecutionNode[], indent = 0): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  for (const node of tree) {
    lines.push(
      `${pad}└─ ${node.subagentName} [${node.result.status}] ` +
        `${node.result.usage.steps} pasos · ${node.result.usage.inputTokens + node.result.usage.outputTokens} tokens · ${node.result.usage.elapsedMs}ms`,
    );
    if (node.result.evidence.length > 0) {
      lines.push(`${pad}   evidence:`);
      for (const ev of node.result.evidence.slice(0, 3)) {
        lines.push(`${pad}   • [${ev.kind}] ${ev.label}`);
      }
    }
    if (node.children.length > 0) {
      lines.push(formatExecutionTree(node.children, indent + 1));
    }
  }
  return lines.join('\n');
}
