/**
 * RLM-6 — Executor con Context-as-Variable.
 *
 * Versión RLM-aware del executor. En lugar de volcar todo el contenido
 * al prompt del LLM, usa el ContextStore para mantener la ventana limpia.
 *
 * Integración con el executor existente (src/agent/executor.ts):
 *   - Si se pasa un RecursionContext, el executor usa las tools de contexto.
 *   - Si no, cae al comportamiento legacy.
 *
 * El system prompt RLM enseña al agente:
 *   1. Al inicio de cada paso, llama a ctx_list para ver qué tienes.
 *   2. Cuando necesites datos, usa file_view_lines/structure/symbols
 *      (NO file_read crudo).
 *   3. Guarda fragmentos importantes con ctx_set.
 *   4. Si una subtarea es compleja, delega con spawn_child_agent.
 *   5. Cuando termines, devuelve RESULT.
 */

import type { LLMProvider, Message, Tool } from '@/providers/types';
import type { TraceStep } from '../types';
import { streamChat } from '@/lib/chain';
import { dispatchAdvancedTool } from '@/lib/tools';
import {
  ContextStore,
  buildContextTools,
  dispatchContextTool,
  type RecursionContext,
  registerSpawnChildAgentHook,
} from './index';

const RLM_SYSTEM_PROMPT = `Eres el Executor RLM de Weaver (Recursive Language Model).

PARADIGMA: Operas con CONTEXTO COMO VARIABLE. No leas archivos completos en tu ventana de contexto — eso causa Context Rot. En su lugar:

1. AL INICIO DE CADA PASO, llama a ctx_list para ver qué fragmentos ya tienes disponibles.
2. Cuando necesites información de un archivo, usa:
   - file_view_lines(path, startLine, endLine) para leer líneas específicas.
   - file_view_structure(path) para ver imports/exports sin cuerpos.
   - file_view_symbols(path) para listar funciones/clases exportadas.
   NO uses file_read crudo salvo que el archivo sea pequeño (<100 líneas).
3. Guarda fragmentos importantes con ctx_set(key, content, source) para reusarlos después.
4. Si una subtarea requiere mucho contexto, DELEGA con spawn_child_agent. El hijo tiene su propia ventana limpia.
5. Cuando termines, responde: RESULT: <resultado estructurado>
6. Si no puedes continuar: STUCK: <motivo>

Ciclo ReAct:
1. Thought: razona qué hacer ahora (considerando qué tienes en ctx_list).
2. Tool call: invoca UNA herramienta.
3. Observation: recibe el resultado.
4. Repite hasta completar.

REGLAS:
- Máximo 1 tool call por turno.
- Si ctx_list tiene >20 fragmentos, limpia con ctx_clear los obsoletos.
- Nunca invoques spawn_child_agent si estás en depth >= 3 (recursion limit).
- Prefiere delegar a subagentes para tareas de investigación/búsqueda.`;

export interface RlmExecutorResult {
  status: 'succeeded' | 'failed' | 'stuck';
  summary: string;
  trace: TraceStep[];
  contextStore: ContextStore;
  usage: {
    inputTokens: number;
    outputTokens: number;
    steps: number;
    elapsedMs: number;
  };
}

export interface RlmExecutorOpts {
  recursionCtx?: RecursionContext;
  maxSteps?: number;
  onTrace?: (step: TraceStep) => void;
  signal?: AbortSignal;
}

/**
 * Executor RLM. Si se pasa un RecursionContext, usa tools de contexto
 * + spawn_child_agent. Si no, cae al comportamiento legacy.
 */
export async function executeWithRlm(
  provider: LLMProvider,
  model: string,
  objective: string,
  successCriteria: string,
  opts: RlmExecutorOpts = {},
): Promise<RlmExecutorResult> {
  const start = Date.now();
  const trace: TraceStep[] = [];
  const maxSteps = opts.maxSteps ?? 12;

  // Crear ContextStore propio para esta ejecución (si no viene en recursionCtx).
  const store = opts.recursionCtx?.store ?? new ContextStore();
  const recursionCtx = opts.recursionCtx;

  // Construir tools: AT-SPI/automation legacy + context tools.
  const tools: Tool[] = [
    ...buildAtspiTools(),
    ...buildContextTools(),
  ];

  // Si hay recursionCtx, registrar el hook global para spawn_child_agent.
  let cleanupHook: (() => void) | undefined;
  if (recursionCtx) {
    cleanupHook = registerSpawnChildAgentHook(recursionCtx);
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let steps = 0;
  let status: RlmExecutorResult['status'] = 'failed';
  let summary = '';

  const messages: Message[] = [
    { role: 'system', content: RLM_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Objetivo: ${objective}\nCriterio de éxito: ${successCriteria}\n\nEmpieza llamando a ctx_list para ver tu contexto inicial (probablemente vacío).`,
    },
  ];

  try {
    for (let step = 0; step < maxSteps; step++) {
      steps = step + 1;

      if (opts.signal?.aborted) {
        status = 'failed';
        summary = 'Cancelado por AbortSignal.';
        break;
      }

      const result = await streamChat(provider, model, messages, { tools });
      inputTokens += result.usage.inputTokens;
      outputTokens += result.usage.outputTokens;

      if (result.toolCalls.length > 0) {
        const tc = result.toolCalls[0];
        const args = JSON.parse(tc.function.arguments || '{}');
        const traceStep: TraceStep = {
          ts: Date.now(),
          kind: 'tool_call',
          content: tc.function.name,
          toolArgs: args,
        };
        trace.push(traceStep);
        opts.onTrace?.(traceStep);
        messages.push({
          role: 'assistant',
          content: result.text || `Llamar ${tc.function.name}`,
          tool_calls: [tc],
        });

        try {
          let out: { ok: boolean; output: string; error?: string };

          // Dispatch: tools de contexto → dispatchContextTool.
          // Tools AT-SPI/legacy → dispatchAdvancedTool.
          // spawn_child_agent → ya está dentro de context tools (resuelto por el hook).
          if (
            tc.function.name.startsWith('ctx_') ||
            tc.function.name.startsWith('file_view_') ||
            tc.function.name === 'spawn_child_agent'
          ) {
            // Para spawn_child_agent, el hook global lo intercepta si está activo.
            // Si no está activo, devolvemos error.
            if (tc.function.name === 'spawn_child_agent') {
              const hook = (window as unknown as { __weaverRlmSpawnHook?: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; output: string; error?: string } | null> }).__weaverRlmSpawnHook;
              if (hook) {
                const hooked = await hook(tc.function.name, args);
                if (hooked) {
                  out = hooked;
                } else {
                  out = await dispatchContextTool(tc.function.name, args, store);
                }
              } else {
                out = {
                  ok: false,
                  output: '',
                  error: 'spawn_child_agent no disponible (sin RecursionContext activo).',
                };
              }
            } else {
              out = await dispatchContextTool(tc.function.name, args, store);
            }
          } else {
            // Tool legacy (atspi, automation, shell, etc.).
            const advancedResult = await dispatchAdvancedTool(tc.function.name, args);
            out = {
              ok: advancedResult.ok,
              output: advancedResult.output,
              error: advancedResult.error,
            };
          }

          const resultStep: TraceStep = {
            ts: Date.now(),
            kind: 'tool_result',
            content: out.output.slice(0, 500),
            toolResult: out,
          };
          trace.push(resultStep);
          opts.onTrace?.(resultStep);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: out.ok ? out.output : `ERROR: ${out.error ?? 'desconocido'}`,
          });
        } catch (e) {
          const errStep: TraceStep = {
            ts: Date.now(),
            kind: 'error',
            content: e instanceof Error ? e.message : String(e),
          };
          trace.push(errStep);
          opts.onTrace?.(errStep);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `ERROR: ${errStep.content}`,
          });
        }
        continue;
      }

      const text = result.text.trim();
      trace.push({ ts: Date.now(), kind: 'thought', content: text });
      opts.onTrace?.({ ts: Date.now(), kind: 'thought', content: text });
      messages.push({ role: 'assistant', content: text });

      if (text.startsWith('RESULT:')) {
        status = 'succeeded';
        summary = text.slice(7).trim();
        break;
      }
      if (text.startsWith('STUCK:')) {
        status = 'stuck';
        summary = text.slice(6).trim();
        break;
      }

      if (step === maxSteps - 1) {
        status = 'failed';
        summary = 'Límite de pasos agotado sin RESULT ni STUCK.';
      }
    }
  } finally {
    cleanupHook?.();
  }

  return {
    status,
    summary,
    trace,
    contextStore: store,
    usage: {
      inputTokens,
      outputTokens,
      steps,
      elapsedMs: Date.now() - start,
    },
  };
}

// ============================================================================
// Tools AT-SPI (mismas que executor.ts legacy, pero aquí las exponemos
// para que el agente RLM también pueda operar el escritorio).
// ============================================================================

function buildAtspiTools(): Tool[] {
  return [
    tool('list_applications', 'Lista las aplicaciones visibles en AT-SPI.', {}),
    tool('query_tree', 'Lee el sub-árbol AT-SPI.', { bus_name: { type: 'string' }, root_path: { type: 'string' }, max_depth: { type: 'number' } }),
    tool('click', 'Clic en un elemento AT-SPI.', { bus_name: { type: 'string' }, path: { type: 'string' } }),
    tool('type_text', 'Escribe texto en un elemento AT-SPI.', { bus_name: { type: 'string' }, path: { type: 'string' }, text: { type: 'string' } }),
    tool('press_key', 'Presiona una combinación de teclas.', { key: { type: 'string' } }),
    tool('get_text', 'Lee texto de un elemento AT-SPI.', { bus_name: { type: 'string' }, path: { type: 'string' } }),
    tool('clipboard_get', 'Lee el portapapeles.', {}),
    tool('clipboard_set', 'Escribe en el portapapeles.', { content: { type: 'string' } }),
    tool('list_windows', 'Lista las ventanas top-level.', {}),
    tool('activate_window', 'Activa una ventana por título o id.', { id_or_title: { type: 'string' } }),
    tool('mouse_click_at', 'Clic en coordenadas absolutas.', { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'number' } }),
    // Legacy tools (fs, shell, web) — disponibles también.
    tool('file_read', 'Lee un archivo COMPLETO. Preferir file_view_lines/structure/symbols.', { path: { type: 'string' } }),
    tool('file_write', 'Escribe un archivo.', { path: { type: 'string' }, content: { type: 'string' }, create_dirs: { type: 'boolean' } }),
    tool('file_list', 'Lista archivos en un directorio.', { path: { type: 'string' } }),
    tool('shell_exec', 'Ejecuta un comando shell.', { command: { type: 'string' }, cwd: { type: 'string' }, timeout: { type: 'number' } }),
    tool('web_search', 'Busca en internet (Tavily).', { query: { type: 'string' }, max_results: { type: 'number' } }),
    tool('web_fetch', 'Descarga una URL.', { url: { type: 'string' }, max_chars: { type: 'number' } }),
    tool('sandbox_run', 'Ejecuta código en sandbox.', { language: { type: 'string' }, code: { type: 'string' }, stdin: { type: 'string' } }),
  ];
}

function tool(name: string, description: string, properties: Record<string, unknown>): Tool {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties,
        required: Object.keys(properties),
      },
    },
  };
}
