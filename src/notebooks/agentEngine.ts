/**
 * Fase 5 — Capa agéntica de Notebooks.
 *
 * Modo "Agente": en vez de una sola llamada al modelo con contexto fijo, se
 * corre un bucle acotado de Observación → Razonamiento → Acción:
 *
 *   1. El modelo recibe la pregunta + fuentes del notebook y decide, en un
 *      paso de razonamiento estructurado (JSON), si:
 *        - ya tiene suficiente información para responder → responde
 *        - necesita buscar en la web (vacío de información) → busca
 *        - necesita ejecutar código para calcular/procesar datos → ejecuta
 *   2. Cada acción se ejecuta y su resultado se añade al contexto del
 *      siguiente paso (esto es lo que hace "observable" el razonamiento:
 *      cada paso queda en el trace que se muestra en la UI).
 *   3. Al llegar a una respuesta final, un paso de autocrítica evalúa si
 *      responde lo que pidió el usuario y si está bien fundamentada; si no,
 *      se reintenta UNA vez con la crítica como contexto adicional.
 *
 * Límites honestos:
 *   - Máximo 6 iteraciones del bucle (evita loops infinitos y costos
 *     descontrolados); si se agota, responde con lo mejor que tenga.
 *   - `sandbox_run` (ejecución de código) solo funciona en la app de
 *     escritorio (Tauri) — en el navegador, dispatchAdvancedTool ya
 *     devuelve un error claro que se muestra en el trace, no se simula.
 *   - La autocrítica es una pasada adicional del mismo modelo, no un
 *     modelo separado ni verificación externa real.
 */

import { createProvider } from '@/providers';
import { dispatchAdvancedTool } from '@/lib/tools';
import type { Message, ProviderId } from '@/providers/types';
import type { Notebook } from './types';
import { runQuickSearch, runDeepResearch } from './search';
import { selectSourcesForBudget } from './grounding';

const MAX_AGENT_STEPS = 6;

export type AgentStepKind = 'reasoning' | 'web_search' | 'code_exec' | 'final_answer' | 'self_critique';

export interface AgentStep {
  kind: AgentStepKind;
  /** Texto legible para mostrar en el trace de la UI. */
  label: string;
  /** Detalle opcional (resultado de la acción, razonamiento completo, etc.). */
  detail?: string;
}

export interface AgentRunResult {
  content: string;
  steps: AgentStep[];
  usedSourceIds: string[];
}

const PLANNER_SYSTEM_PROMPT = `Eres el planificador de un agente de investigación dentro de un Notebook.

En cada turno, decides UNA sola acción a partir de la pregunta del usuario, las fuentes disponibles, y lo que ya se ha hecho en pasos anteriores (si los hay). Responde UNICAMENTE con JSON, una de estas formas:

Si necesitas buscar información que falta en las fuentes:
{"action": "web_search", "mode": "quick" | "deep", "query": "consulta de búsqueda", "reasoning": "por qué necesitas esto"}

Si necesitas ejecutar código para calcular, procesar datos o verificar algo exactamente (no para tareas triviales):
{"action": "code_exec", "language": "python" | "node", "code": "código completo", "reasoning": "por qué necesitas ejecutar esto"}

Si ya tienes suficiente información (de las fuentes y/o pasos anteriores) para responder completamente:
{"action": "final_answer", "reasoning": "por qué ya puedes responder"}

Reglas:
- Máximo una acción por turno.
- Prefiere responder directamente si las fuentes ya cubren la pregunta; no busques ni ejecutes código innecesariamente.
- Usa code_exec solo para cálculos, procesamiento de datos tabulares, o verificaciones que requieran precisión matemática — no para generar texto.
- No repitas una búsqueda o ejecución ya hecha en pasos anteriores con la misma query/código.`;

const CRITIC_SYSTEM_PROMPT = `Eres el crítico de un agente de investigación. Evalúas si una respuesta final cumple lo que pidió el usuario y si está bien fundamentada en el contexto disponible (fuentes, resultados de búsqueda, resultados de código).

Responde UNICAMENTE con JSON:
{"verdict": "ok" | "needs_revision", "reason": "explicación breve", "suggestion": "qué corregir, o null si verdict es ok"}`;

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

async function askModel(
  providerId: ProviderId,
  modelId: string,
  messages: Message[],
  signal?: AbortSignal,
): Promise<string> {
  const llm = await createProvider(providerId);
  const stream = await llm.stream({ model: modelId, messages, temperature: 0.3, signal });
  let full = '';
  for await (const chunk of stream) {
    if (chunk.type === 'delta') full += chunk.content;
    if (chunk.type === 'error') throw new Error(chunk.message);
  }
  return full;
}

interface PlannerDecision {
  action: 'web_search' | 'code_exec' | 'final_answer';
  mode?: 'quick' | 'deep';
  query?: string;
  language?: 'python' | 'node';
  code?: string;
  reasoning?: string;
}

export interface AgentRunOpts {
  notebook: Notebook;
  userMessage: string;
  history: Message[];
  providerId: ProviderId;
  modelId: string;
  onStep?: (step: AgentStep) => void;
  signal?: AbortSignal;
}

export async function runNotebookAgent(opts: AgentRunOpts): Promise<AgentRunResult> {
  const { notebook, userMessage, history, providerId, modelId, onStep, signal } = opts;
  const steps: AgentStep[] = [];

  function pushStep(step: AgentStep) {
    steps.push(step);
    onStep?.(step);
  }

  // Contexto acumulado de acciones ya ejecutadas en este episodio (búsquedas,
  // código), que se va agregando al prompt del planificador en cada iteración.
  let actionsLog = '';
  let usedSourceIds: string[] = [];

  for (let i = 0; i < MAX_AGENT_STEPS; i++) {
    const selection = selectSourcesForBudget(notebook.sources, userMessage, providerId, modelId, history);
    usedSourceIds = selection.included.map((s) => s.source.id);
    const sourcesBlock = selection.included
      .map(
        ({ source, usedContent, wasTruncatedForBudget }, idx) =>
          `[Fuente ${idx + 1}: ${source.name}]${wasTruncatedForBudget ? ' (parcial)' : ''}\n${usedContent}`,
      )
      .join('\n\n---\n\n');

    const plannerMessages: Message[] = [
      { role: 'system', content: PLANNER_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Pregunta del usuario: ${userMessage}\n\n=== FUENTES DEL NOTEBOOK ===\n${sourcesBlock || '(sin fuentes)'}\n\n=== ACCIONES YA REALIZADAS EN ESTE TURNO ===\n${actionsLog || '(ninguna todavía)'}`,
      },
    ];

    const raw = await askModel(providerId, modelId, plannerMessages, signal);
    const json = extractJson(raw);
    const decision = json ? (JSON.parse(json) as PlannerDecision) : null;

    if (!decision || decision.action === 'final_answer') {
      pushStep({
        kind: 'reasoning',
        label: decision?.reasoning ?? 'Generando respuesta final con la información disponible.',
      });
      break;
    }

    if (decision.action === 'web_search') {
      const mode = decision.mode === 'deep' ? 'deep' : 'quick';
      const query = decision.query || userMessage;
      pushStep({ kind: 'reasoning', label: decision.reasoning ?? `Decide buscar: "${query}"` });
      pushStep({
        kind: 'web_search',
        label: mode === 'deep' ? `Investigación profunda: "${query}"` : `Búsqueda rápida: "${query}"`,
      });

      const result = mode === 'deep' ? await runDeepResearch(query) : await runQuickSearch(query);
      if (result.ok) {
        actionsLog += `\n\n[Búsqueda web: "${query}"]\n${result.contextText}`;
        pushStep({
          kind: 'web_search',
          label: `Resultados obtenidos para "${query}"`,
          detail: result.contextText.slice(0, 500),
        });
      } else {
        actionsLog += `\n\n[Búsqueda web fallida: "${query}" — ${result.error}]`;
        pushStep({ kind: 'web_search', label: `Búsqueda falló: ${result.error ?? 'error desconocido'}` });
      }
      continue;
    }

    if (decision.action === 'code_exec') {
      const language = decision.language === 'node' ? 'node' : 'python';
      pushStep({ kind: 'reasoning', label: decision.reasoning ?? 'Decide ejecutar código para procesar/calcular datos.' });
      pushStep({ kind: 'code_exec', label: `Ejecutando código (${language})…`, detail: decision.code });

      const result = await dispatchAdvancedTool('sandbox_run', {
        language,
        code: decision.code ?? '',
        timeout: 20000,
      });
      if (result.ok) {
        actionsLog += `\n\n[Código ejecutado (${language})]\n${decision.code}\n[Salida]\n${result.output}`;
        pushStep({
          kind: 'code_exec',
          label: 'Código ejecutado correctamente',
          detail: result.output.slice(0, 500),
        });
      } else {
        actionsLog += `\n\n[Código falló (${language})]\n${decision.code}\n[Error]\n${result.error}`;
        pushStep({ kind: 'code_exec', label: `Ejecución falló: ${result.error ?? 'error desconocido'}` });
      }
      continue;
    }

    // Acción desconocida: corta el bucle para no quedar atascado.
    break;
  }

  // Genera la respuesta final con todo el contexto acumulado.
  const finalSelection = selectSourcesForBudget(notebook.sources, userMessage, providerId, modelId, history);
  const finalSourcesBlock = finalSelection.included
    .map(
      ({ source, usedContent, wasTruncatedForBudget }, idx) =>
        `[Fuente ${idx + 1}: ${source.name}]${wasTruncatedForBudget ? ' (parcial)' : ''}\n${usedContent}`,
    )
    .join('\n\n---\n\n');

  const answerSystemPrompt = `Eres el asistente de un Notebook de investigación operando en modo Agente. Responde la pregunta del usuario basándote en las fuentes del notebook y en las acciones (búsquedas, código) ya realizadas en este turno, que se listan abajo. Cita fuentes por número [Fuente N] cuando corresponda. Sé preciso y no inventes datos que no estén respaldados.`;

  let answerMessages: Message[] = [
    {
      role: 'system',
      content: `${answerSystemPrompt}\n\n=== FUENTES ===\n${finalSourcesBlock || '(sin fuentes)'}\n\n=== ACCIONES REALIZADAS ===\n${actionsLog || '(ninguna)'}`,
    },
    ...history,
    { role: 'user', content: userMessage },
  ];

  let finalContent = await askModel(providerId, modelId, answerMessages, signal);
  pushStep({ kind: 'final_answer', label: 'Respuesta generada, verificando calidad…' });

  // Autocrítica: una pasada extra que evalúa la respuesta antes de mostrarla.
  const criticMessages: Message[] = [
    { role: 'system', content: CRITIC_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Pregunta del usuario: ${userMessage}\n\nRespuesta generada:\n${finalContent}\n\nContexto disponible (fuentes + acciones):\n${(finalSourcesBlock + actionsLog).slice(0, 3000)}`,
    },
  ];
  try {
    const criticRaw = await askModel(providerId, modelId, criticMessages, signal);
    const criticJson = extractJson(criticRaw);
    const verdict = criticJson
      ? (JSON.parse(criticJson) as { verdict?: string; reason?: string; suggestion?: string })
      : null;

    if (verdict?.verdict === 'needs_revision' && verdict.suggestion) {
      pushStep({
        kind: 'self_critique',
        label: `Autocrítica: se detectó una mejora necesaria — ${verdict.reason ?? ''}`,
        detail: verdict.suggestion,
      });
      answerMessages = [
        ...answerMessages,
        { role: 'assistant', content: finalContent },
        {
          role: 'user',
          content: `Revisa tu respuesta anterior. Un crítico señaló: "${verdict.suggestion}". Genera una versión corregida.`,
        },
      ];
      finalContent = await askModel(providerId, modelId, answerMessages, signal);
      pushStep({ kind: 'final_answer', label: 'Respuesta corregida tras autocrítica.' });
    } else {
      pushStep({ kind: 'self_critique', label: 'Autocrítica: la respuesta cumple lo solicitado.' });
    }
  } catch {
    // Si la autocrítica falla (red, parseo), se entrega la respuesta original sin bloquear al usuario.
    pushStep({ kind: 'self_critique', label: 'No se pudo completar la autocrítica; se entrega la respuesta generada.' });
  }

  return { content: finalContent, steps, usedSourceIds };
}
