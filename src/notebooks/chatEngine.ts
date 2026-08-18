/**
 * Motor de chat de Notebooks.
 *
 * Este motor es DELIBERADAMENTE independiente del Composer/loop de agente
 * principal de Weaver: tiene su propio system prompt, su propia forma de
 * construir contexto (grounding directo en las fuentes cargadas, sin pasar
 * por el planner/critic general) y sus propias herramientas (búsqueda
 * rápida/profunda). Esto evita mezclar comportamientos y prompts entre
 * Weaver-chat y Notebooks, tal como se pidió.
 */

import { createProvider } from '@/providers';
import type { Message, StreamChunk } from '@/providers/types';
import type { ProviderId } from '@/providers/types';
import type { Notebook, NotebookSource, NotebookToolMode } from './types';
import { runSearchTool } from './search';
import { selectSourcesForBudget, type SourceSelection } from './grounding';

const NOTEBOOK_SYSTEM_PROMPT = `Eres el asistente de un Notebook (cuaderno de investigación), inspirado en NotebookLM.

Reglas de comportamiento:
1. GROUNDING: Debes basar tus respuestas principalmente en las FUENTES proporcionadas más abajo (documentos, PDFs, URLs cargadas por el usuario). Cuando uses información de una fuente, indica claramente de cuál fuente proviene citando su número entre corchetes, por ejemplo: "Según [Fuente 2]...".
2. Si la pregunta no puede responderse con las fuentes disponibles y no se usó ninguna herramienta de búsqueda, dilo explícitamente en vez de inventar información.
3. Si se te da contexto adicional de una búsqueda web (rápida o profunda), intégralo y distíngueló claramente de las fuentes cargadas por el usuario.
4. Sé preciso, evita alucinar cifras, nombres o citas que no estén respaldadas por el contexto proporcionado.
5. Responde en el mismo idioma en el que te escribe el usuario.
6. Puedes sintetizar y cruzar información entre múltiples fuentes para señalar patrones, coincidencias o contradicciones cuando sea relevante.
7. Algunas fuentes pueden estar marcadas como "(fragmento parcial, contenido truncado por espacio)": si citas una de ellas, ten presente que puede faltar contexto adicional que no se incluyó por límite de tamaño.`;

function buildSourcesBlock(selection: SourceSelection): string {
  if (selection.included.length === 0) return 'No hay fuentes cargadas todavía en este notebook.';
  const blocks = selection.included.map(
    ({ source, usedContent, wasTruncatedForBudget }, i) =>
      `[Fuente ${i + 1}: ${source.name}]${wasTruncatedForBudget ? ' (fragmento parcial, contenido truncado por espacio)' : ''}\n${usedContent}`,
  );
  let text = blocks.join('\n\n---\n\n');
  if (selection.excluded.length > 0) {
    text += `\n\n(Nota: ${selection.excluded.length} fuente(s) no se incluyeron en este turno por límite de contexto del modelo: ${selection.excluded.map((s) => s.name).join(', ')}. Si el usuario pregunta por ellas específicamente, indícalo.)`;
  }
  return text;
}

export interface NotebookChatRunOpts {
  notebook: Notebook;
  userMessage: string;
  /** Historial previo del chat (sin el mensaje nuevo). */
  history: Message[];
  /** Herramienta de búsqueda activa para este turno, si el usuario la seleccionó. */
  toolMode?: NotebookToolMode | null;
  /** Modelo activo: mismo modelo global que usa el chat principal de Weaver. */
  providerId: ProviderId;
  modelId: string;
  onChunk?: (chunk: StreamChunk) => void;
  onToolTrace?: (trace: string[]) => void;
  signal?: AbortSignal;
}

export interface NotebookChatRunResult {
  content: string;
  toolTrace: string[];
  /** IDs de las fuentes del notebook que efectivamente se incluyeron en el contexto de este turno. */
  usedSourceIds: string[];
  /** IDs de fuentes existentes que se excluyeron por presupuesto de contexto del modelo. */
  excludedSourceIds: string[];
}

export async function runNotebookChat(opts: NotebookChatRunOpts): Promise<NotebookChatRunResult> {
  const { notebook, userMessage, history, toolMode, providerId, modelId, onChunk, onToolTrace, signal } = opts;

  let toolContext = '';
  let trace: string[] = [];

  if (toolMode) {
    const result = await runSearchTool(toolMode, userMessage);
    trace = result.trace;
    onToolTrace?.(trace);
    if (result.ok) {
      toolContext = `\n\n=== CONTEXTO DE BÚSQUEDA WEB (${toolMode === 'deep_research' ? 'investigación profunda' : 'búsqueda rápida'}) ===\n${result.contextText}`;
    } else {
      toolContext = `\n\n(La búsqueda web falló: ${result.error ?? 'error desconocido'}. Responde solo con las fuentes del notebook si es posible.)`;
    }
  }

  const selection = selectSourcesForBudget(notebook.sources, userMessage, providerId, modelId, history);
  const systemContent = `${NOTEBOOK_SYSTEM_PROMPT}\n\n=== FUENTES DEL NOTEBOOK ===\n${buildSourcesBlock(selection)}${toolContext}`;

  const messages: Message[] = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const llm = await createProvider(providerId);
  const stream = await llm.stream({
    model: modelId,
    messages,
    temperature: 0.4,
    signal,
    onChunk,
  });

  let full = '';
  for await (const chunk of stream) {
    if (chunk.type === 'delta') full += chunk.content;
    if (chunk.type === 'error') throw new Error(chunk.message);
  }

  return {
    content: full,
    toolTrace: trace,
    usedSourceIds: selection.included.map((i) => i.source.id),
    excludedSourceIds: selection.excluded.map((s) => s.id),
  };
}

/** Convierte el historial de NotebookChatMessage[] al formato Message[] del provider.
 * Excluye mensajes marcados como error (isError): no son turnos reales de
 * conversación y no deben mezclarse con el historial que ve el modelo. */
export function toProviderMessages(
  history: Array<{ role: 'user' | 'assistant'; content: string; isError?: boolean }>,
): Message[] {
  return history.filter((m) => !m.isError).map((m) => ({ role: m.role, content: m.content }));
}
