/**
 * Planner jerárquico (HTN-lite).
 *
 * Entrada: un objetivo en lenguaje natural + contexto (skills relevantes,
 * episodios previos similares, hechos semánticos).
 * Salida: un Plan con subtareas verificables y dependencias.
 *
 * Estrategia:
 * 1. Arma un system prompt que explica el rol del planner.
 * 2. Pide al LLM un JSON con la descomposición.
 * 3. Parsea, valida y normaliza (IDs únicos, dependencias acíclicas).
 * 4. Si la respuesta se corta por límite de tokens (CONTINUE_MARKER),
 *    encadena otra inferencia para completar el plan.
 */

import type { LLMProvider, Message } from '@/providers/types';
import type { Objective, Plan, Subtask } from './types';
import { CONTINUE_MARKER, END_MARKER } from './types';
import { streamUntilDone } from '@/lib/chain';

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

const SYSTEM_PROMPT = `Eres el Planificador jerárquico de Weaver, un agente de escritorio Linux autónomo.
Tu trabajo: descomponer un objetivo del usuario en subtareas verificables y ordenadas.

Capacidades del agente:
- Lanzar aplicaciones en segundo plano (launch_app).
- Ejecutar comandos bash (shell_exec).
- Automatizar e interactuar con la interfaz gráfica vía AT-SPI (click, double_click, focus, type_text, press_key, mouse_click_at, query_tree, activate_window).
- Leer y modificar el portapapeles (clipboard_get, clipboard_set).

Reglas:
- Cada subtarea debe ser ATÓMICA y verificable con AT-SPI, automatización del sistema o la shell.
- Si el objetivo requiere interactuar con una aplicación que no está en ejecución, incluye una subtarea previa para iniciar la aplicación (ej: "Lanzar gedit en segundo plano").
- Devuelve ÚNICAMENTE JSON válido (sin texto adicional, sin markdown).
- Esquema:
  {
    "subtasks": [
      {
        "description": "qué hacer",
        "successCriteria": "cómo verificar que se cumplió",
        "dependsOn": [índices 0-based de subtareas previas]
      }
    ]
  }
- Si tu respuesta se acerca al límite de tokens, termina con la línea exacta: <<CONTINUE>>
- Cuando el plan esté completo, termina con la línea: <<END>>
- Máximo 12 subtareas. Si el objetivo es complejo, divide en sub-objetivos y pide al usuario confirmar.`;

export async function plan(
  provider: LLMProvider,
  model: string,
  objective: Objective,
  context: { skills?: string[]; similarEpisodes?: string[]; facts?: string[] } = {},
  opts: { signal?: AbortSignal } = {},
): Promise<Plan> {
  const userPrompt = buildUserPrompt(objective, context);

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  let fullText = '';
  try {
    fullText = await streamUntilDone(provider, model, messages, { maxChains: 4, signal: opts.signal });
  } catch (e) {
    console.warn('[Planner] Fallo en streamUntilDone:', e);
  }

  const json = extractJson(fullText);
  let raw: { subtasks?: Array<{ description: string; successCriteria: string; dependsOn: number[] }> } = {};
  if (json) {
    try {
      raw = JSON.parse(json);
    } catch (e) {
      console.warn('[Planner] Error al parsear JSON del plan:', e);
    }
  }

  const rawSubtasks = Array.isArray(raw.subtasks) && raw.subtasks.length > 0 ? raw.subtasks : null;

  if (!rawSubtasks) {
    // Fallback: plan trivial con el objetivo como única subtarea.
    return {
      objective,
      subtasks: [
        {
          id: newId(),
          description: objective.text,
          successCriteria: 'El usuario confirma que se cumplió.',
          dependsOn: [],
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          trace: [],
        },
      ],
    };
  }

  const subtasks: Subtask[] = rawSubtasks.map((s, idx) => ({
    id: newId(),
    description: s.description || objective.text,
    successCriteria: s.successCriteria || 'Se ejecutó la subtarea',
    dependsOn: (s.dependsOn ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < rawSubtasks.length && i !== idx),
    status: 'pending' as const,
    attempts: 0,
    maxAttempts: 3,
    trace: [],
  }));

  // Validar acíclico.
  if (hasCycle(subtasks)) {
    // Si hay ciclo, quitar dependencias.
    subtasks.forEach((s) => (s.dependsOn = []));
  }

  return { objective, subtasks };
}

function buildUserPrompt(
  objective: Objective,
  ctx: { skills?: string[]; similarEpisodes?: string[]; facts?: string[] },
): string {
  const parts: string[] = [`Objetivo: ${objective.text}`];
  if (ctx.skills?.length) {
    parts.push(`Skills relevantes:\n${ctx.skills.map((s) => `- ${s}`).join('\n')}`);
  }
  if (ctx.similarEpisodes?.length) {
    parts.push(`Episodios previos similares:\n${ctx.similarEpisodes.map((s) => `- ${s}`).join('\n')}`);
  }
  if (ctx.facts?.length) {
    parts.push(`Hechos conocidos:\n${ctx.facts.map((s) => `- ${s}`).join('\n')}`);
  }
  parts.push('Devuelve el plan en JSON.');
  return parts.join('\n\n');
}

function extractJson(text: string): string | null {
  // Buscar el primer { ... } balanceado.
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

function hasCycle(subtasks: Subtask[]): boolean {
  const visited = new Map<string, 'white' | 'gray' | 'black'>();
  for (const s of subtasks) visited.set(s.id, 'white');
  const dfs = (id: string): boolean => {
    const color = visited.get(id);
    if (color === 'gray') return true;
    if (color === 'black') return false;
    visited.set(id, 'gray');
    const node = subtasks.find((s) => s.id === id);
    if (node) {
      for (const depIdx of node.dependsOn) {
        const depNode = subtasks[depIdx];
        if (depNode && dfs(depNode.id)) return true;
      }
    }
    visited.set(id, 'black');
    return false;
  };
  for (const s of subtasks) if (dfs(s.id)) return true;
  return false;
}

export { CONTINUE_MARKER, END_MARKER };
