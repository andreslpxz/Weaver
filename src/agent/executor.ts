/**
 * Executor del bucle agéntico (ReAct).
 *
 * Por cada subtarea:
 *   1. Lee el árbol AT-SPI relevante (sub-árbol con foco o árbol de una app específica).
 *   2. Llama al LLM con tools disponibles (atspi_click, atspi_type_text, ...).
 *   3. Ejecuta el tool call solicitado.
 *   4. Realimenta el resultado al LLM.
 *   5. Repite hasta que el LLM emita "done" o se agoten los intentos.
 */

import type { LLMProvider, Message, Tool } from '@/providers/types';
import type { Subtask, TraceStep } from './types';
import { atspi, automation, sqlite } from '@/lib/tauri';
import { streamChat } from '@/lib/chain';

const SYSTEM_PROMPT = `Eres el Ejecutor de Weaver, un agente de escritorio Linux autónomo.
Estás trabajando en una subtarea específica. Tienes acceso al árbol de accesibilidad AT-SPI,
herramientas de automatización de ventanas/teclado/ratón/portapapeles y ejecución en la shell.

Ciclo ReAct:
1. Thought: razona qué hacer ahora.
2. Tool call: invoca UNA herramienta.
3. Observation: recibe el resultado.
4. Repite hasta completar la subtarea.

Cuando termines la subtarea, responde con: DONE: <resumen breve>
Si no puedes continuar, responde con: STUCK: <motivo>

Herramientas disponibles (names):
- launch_app: lanza una aplicación de escritorio (ej: "gedit", "firefox") en segundo plano sin bloquear la PC.
- shell_exec: ejecuta comandos bash en el sistema.
- list_applications: lista apps visibles en AT-SPI.
- query_tree: lee el sub-árbol AT-SPI de una app (bus_name, root_path, max_depth).
- click: hace clic en un elemento AT-SPI (bus_name, path).
- double_click: hace doble clic en un elemento AT-SPI.
- focus: enfoca un elemento AT-SPI.
- type_text: escribe texto en un elemento AT-SPI (bus_name, path, text).
- press_key: presiona una combinación de teclas (key, ej. "ctrl+s", "Return").
- get_text: lee el texto de un elemento AT-SPI (bus_name, path).
- clipboard_get / clipboard_set: portapapeles.
- list_windows / activate_window: gestión de ventanas.
- mouse_click_at: clic en coordenadas (x, y, button?).

Las tools se invocan como JSON estándar (OpenAI tool_calls).`;

export interface ExecutorResult {
  status: 'succeeded' | 'failed' | 'stuck';
  summary: string;
  trace: TraceStep[];
}

const MAX_STEPS = 12;

export async function executeSubtask(
  provider: LLMProvider,
  model: string,
  subtask: Subtask,
  opts: { onTrace?: (step: TraceStep) => void; signal?: AbortSignal } = {},
): Promise<ExecutorResult> {
  const trace: TraceStep[] = [];
  const tools = buildTools();

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Subtarea: ${subtask.description}\nCriterio de éxito: ${subtask.successCriteria}\nEmpieza listando las aplicaciones visibles o lanzando la app requerida si no está abierta.`,
    },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (opts.signal?.aborted) {
      return { status: 'failed', summary: 'Ejecución cancelada por el usuario', trace };
    }

    const result = await streamChat(provider, model, messages, { tools, signal: opts.signal });
    if (result.toolCalls.length > 0) {
      // Tomar el primer tool call.
      const tc = result.toolCalls[0];
      const args = JSON.parse(tc.function.arguments || '{}');
      const stepTrace: TraceStep = {
        ts: Date.now(),
        kind: 'tool_call',
        content: tc.function.name,
        toolArgs: args,
      };
      trace.push(stepTrace);
      opts.onTrace?.(stepTrace);
      messages.push({
        role: 'assistant',
        content: result.text || `Llamar ${tc.function.name}`,
        tool_calls: [tc],
      });

      try {
        const out = await dispatchTool(tc.function.name, args);
        const resultStep: TraceStep = {
          ts: Date.now(),
          kind: 'tool_result',
          content: summarize(out),
          toolResult: out,
        };
        trace.push(resultStep);
        opts.onTrace?.(resultStep);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof out === 'string' ? out : JSON.stringify(out),
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

    // Sin tool calls → mirar texto del LLM.
    const text = result.text.trim();
    trace.push({ ts: Date.now(), kind: 'thought', content: text });
    opts.onTrace?.({ ts: Date.now(), kind: 'thought', content: text });
    messages.push({ role: 'assistant', content: text });

    if (text.startsWith('DONE:')) {
      return { status: 'succeeded', summary: text.slice(5).trim(), trace };
    }
    if (text.startsWith('STUCK:')) {
      return { status: 'stuck', summary: text.slice(6).trim(), trace };
    }

    // Si no dijo DONE ni STUCK pero no hay tool calls, asumir DONE.
    if (step === MAX_STEPS - 1) {
      return { status: 'failed', summary: 'Límite de pasos agotado', trace };
    }
  }

  return { status: 'failed', summary: 'Límite de pasos agotado', trace };
}

// ============================================================================
// Tools
// ============================================================================

function buildTools(): Tool[] {
  return [
    tool('launch_app', 'Lanza una aplicación de escritorio (ej: "gedit", "firefox") en segundo plano sin bloquear el sistema.', {
      app_name: { type: 'string' },
      background: { type: 'boolean' },
    }),
    tool('shell_exec', 'Ejecuta un comando bash en la shell del sistema.', { command: { type: 'string' }, cwd: { type: 'string' } }),
    tool('list_applications', 'Lista las aplicaciones visibles en AT-SPI.', {}),
    tool('query_tree', 'Lee el sub-árbol AT-SPI.', { bus_name: { type: 'string' }, root_path: { type: 'string' }, max_depth: { type: 'number' } }),
    tool('click', 'Clic en un elemento AT-SPI.', { bus_name: { type: 'string' }, path: { type: 'string' } }),
    tool('double_click', 'Doble clic en un elemento AT-SPI.', { bus_name: { type: 'string' }, path: { type: 'string' } }),
    tool('focus', 'Enfoca un elemento AT-SPI.', { bus_name: { type: 'string' }, path: { type: 'string' } }),
    tool('type_text', 'Escribe texto en un elemento AT-SPI.', { bus_name: { type: 'string' }, path: { type: 'string' }, text: { type: 'string' } }),
    tool('press_key', 'Presiona una combinación de teclas (xdotool-like).', { key: { type: 'string' } }),
    tool('get_text', 'Lee texto de un elemento AT-SPI.', { bus_name: { type: 'string' }, path: { type: 'string' } }),
    tool('clipboard_get', 'Lee el portapapeles.', {}),
    tool('clipboard_set', 'Escribe en el portapapeles.', { content: { type: 'string' } }),
    tool('list_windows', 'Lista las ventanas top-level (X11/wmctrl).', {}),
    tool('activate_window', 'Activa una ventana por título o id.', { id_or_title: { type: 'string' } }),
    tool('mouse_click_at', 'Clic en coordenadas absolutas.', { x: { type: 'number' }, y: { type: 'number' }, button: { type: 'number' } }),
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

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'launch_app': {
      const app = String(args.app_name ?? '').trim();
      const bg = args.background !== false;
      if (!app) throw new Error('launch_app requiere app_name');
      const cmd = bg ? `nohup ${app} >/dev/null 2>&1 &` : app;
      const res = await sqlite.shellExec(cmd);
      return { ok: true, launched: app, background: bg, output: res.stdout || res.stderr || 'App iniciada en segundo plano' };
    }
    case 'shell_exec': {
      const cmd = String(args.command ?? '');
      const cwd = args.cwd ? String(args.cwd) : undefined;
      const res = await sqlite.shellExec(cmd, cwd);
      return { ok: res.code === 0, stdout: res.stdout, stderr: res.stderr, code: res.code };
    }
    case 'list_applications':
      return atspi.listApplications();
    case 'query_tree':
      return atspi.queryTree(String(args.bus_name), String(args.root_path), Number(args.max_depth ?? 4));
    case 'click':
      await atspi.click(String(args.bus_name), String(args.path));
      return { ok: true };
    case 'double_click':
      await atspi.doubleClick(String(args.bus_name), String(args.path));
      return { ok: true };
    case 'focus':
      await atspi.focus(String(args.bus_name), String(args.path));
      return { ok: true };
    case 'type_text':
      await atspi.typeText(String(args.bus_name), String(args.path), String(args.text));
      return { ok: true };
    case 'press_key':
      await atspi.pressKey(String(args.key));
      return { ok: true };
    case 'get_text':
      return atspi.getText(String(args.bus_name), String(args.path));
    case 'clipboard_get':
      return automation.clipboardGet();
    case 'clipboard_set':
      await automation.clipboardSet(String(args.content));
      return { ok: true };
    case 'list_windows':
      return automation.listWindows();
    case 'activate_window':
      await automation.activateWindow(String(args.id_or_title));
      return { ok: true };
    case 'mouse_click_at':
      await automation.mouseClickAt(Number(args.x), Number(args.y), Number(args.button ?? 1));
      return { ok: true };
    default:
      throw new Error(`Tool desconocido: ${name}`);
  }
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value.length > 500 ? value.slice(0, 500) + '...' : value;
  const json = JSON.stringify(value);
  return json.length > 500 ? json.slice(0, 500) + '...' : json;
}
