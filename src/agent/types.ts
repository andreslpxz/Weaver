/**
 * Tipos canónicos del bucle agéntico de Weaver.
 *
 * Flujo: Objective → Planner → Subtasks → Executor (ReAct loop) →
 *        Critic → (replan si falla) → Reflection → Memory.
 */

import type { Tool } from '@/providers/types';

export interface Objective {
  id: string;
  text: string;
  createdAt: number;
}

export interface Subtask {
  id: string;
  description: string;
  /** Criterio de éxito verificable (lo usa el Crítico). */
  successCriteria: string;
  /** Índices (0-based) de subtareas que deben completarse antes. */
  dependsOn: number[];
  status: 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'skipped';
  attempts: number;
  maxAttempts: number;
  /** Pasos ejecutados (tool calls) con su resultado. */
  trace: TraceStep[];
  /** Nota de la reflexión si la subtarea fue exitosa. */
  lesson?: string;
}

export interface TraceStep {
  ts: number;
  kind: 'thought' | 'tool_call' | 'tool_result' | 'observation' | 'error' | 'message';
  /** Para thought: razonamiento del LLM. Para tool_call: nombre. Para tool_result: stdout. */
  content: string;
  /** Si kind = 'tool_call', argumentos usados. */
  toolArgs?: Record<string, unknown>;
  /** Si kind = 'tool_result', el resultado crudo. */
  toolResult?: unknown;
}

export interface Plan {
  objective: Objective;
  subtasks: Subtask[];
}

export interface Episode {
  id: string;
  objective: string;
  plan: Plan;
  startedAt: number;
  finishedAt?: number;
  outcome: 'success' | 'failure' | 'partial' | 'aborted';
  lessons: string[];
  skillGenerated?: string; // nombre de skill auto-aprendida
}

export interface Fact {
  key: string;
  value: string;
  source: 'user' | 'agent' | 'system';
  updatedAt: number;
}

export type ToolCategory = 'atspi' | 'automation' | 'fs' | 'shell' | 'web' | 'mcp' | 'memory';

export interface ToolDef extends Tool {
  category: ToolCategory;
  /** Si true, requiere confirmación del usuario antes de ejecutar. */
  destructive?: boolean;
}

// Marcador que el LLM emite para indicar que su respuesta continúa en otra inferencia.
export const CONTINUE_MARKER = '<<CONTINUE>>';
export const END_MARKER = '<<END>>';
