/**
 * Tools avanzadas del agente Weaver:
 *   - shell_exec: ejecuta comandos shell (con confirmación)
 *   - file_read / file_write / file_list: operaciones de archivos
 *   - web_search: busca en internet vía Tavily API
 *   - web_fetch: descarga una URL y devuelve texto/markdown
 *
 * En modo Tauri: file/shell vía comando Tauri (pendiente de implementar
 * `tools_*` en Rust). En modo navegador: web_search/web_fetch funcionan vía
 * fetch directo (con CORS proxy si hace falta); file ops no disponibles.
 */

import { runtime, keyring, sqlite } from './tauri';
import { invoke } from '@tauri-apps/api/core';

// Re-usa los wrappers de lib/tauri.ts
const invokeShellExec = sqlite.shellExec;
const invokeFileRead = sqlite.fileRead;
const invokeFileWrite = sqlite.fileWrite;
const invokeFileList = sqlite.fileList;

export interface ToolDef {
  name: string;
  description: string;
  category: 'shell' | 'fs' | 'web' | 'atspi' | 'automation';
  parameters: Record<string, unknown>;
  /** Si true, requiere confirmación del usuario antes de ejecutar. */
  destructive?: boolean;
}

export const ADVANCED_TOOLS: ToolDef[] = [
  {
    name: 'shell_exec',
    description:
      'Ejecuta un comando en la shell del sistema (bash). Devuelve stdout, stderr y código de salida. Útil para instalar paquetes, correr scripts, manipular archivos, etc. Requiere confirmación del usuario.',
    category: 'shell',
    destructive: true,
    parameters: {
      command: { type: 'string', description: 'Comando a ejecutar' },
      cwd: { type: 'string', description: 'Directorio de trabajo (opcional)' },
      timeout: { type: 'number', description: 'Timeout en ms (default 30000)' },
    },
  },
  {
    name: 'file_read',
    description: 'Lee el contenido de un archivo del filesystem.',
    category: 'fs',
    parameters: {
      path: { type: 'string', description: 'Ruta absoluta o relativa al cwd' },
    },
  },
  {
    name: 'file_write',
    description: 'Escribe contenido a un archivo. Sobrescribe si existe.',
    category: 'fs',
    destructive: true,
    parameters: {
      path: { type: 'string', description: 'Ruta del archivo' },
      content: { type: 'string', description: 'Contenido a escribir' },
      create_dirs: { type: 'boolean', description: 'Crear dirs padres si no existen' },
    },
  },
  {
    name: 'file_list',
    description: 'Lista archivos en un directorio.',
    category: 'fs',
    parameters: {
      path: { type: 'string', description: 'Directorio a listar' },
    },
  },
  {
    name: 'web_search',
    description:
      'Busca en internet usando Tavily API. Devuelve títulos, snippets y URLs. Requiere API key de Tavily en Configuración.',
    category: 'web',
    parameters: {
      query: { type: 'string', description: 'Consulta de búsqueda' },
      max_results: { type: 'number', description: 'Número de resultados (default 5)' },
    },
  },
  {
    name: 'web_fetch',
    description: 'Descarga una URL y devuelve su contenido como texto/markdown.',
    category: 'web',
    parameters: {
      url: { type: 'string', description: 'URL a descargar' },
      max_chars: { type: 'number', description: 'Máximo de caracteres (default 20000)' },
    },
  },
  {
    name: 'save_file',
    description:
      'Genera un archivo con el contenido proporcionado y lo hace disponible para que el usuario lo descargue. ' +
      'Útil cuando el usuario pide "crea un archivo", "genera un script", "hazme un resumen en un documento", etc. ' +
      'En modo Tauri, pregunta al usuario dónde guardarlo. En modo navegador, lo descarga directamente. ' +
      'El archivo aparece como un botón de descarga en el chat.',
    category: 'fs',
    parameters: {
      filename: { type: 'string', description: 'Nombre del archivo (ej. "resumen.md", "script.py")' },
      content: { type: 'string', description: 'Contenido completo del archivo' },
      mime_type: { type: 'string', description: 'Tipo MIME opcional (ej. "text/markdown", "application/json")' },
    },
  },
  // ===================== ME: Calendario y vida =====================
  {
    name: 'me_create_event',
    description:
      'Crea un evento en el calendario ME (la sección personal de Weaver). ' +
      'Antes de usar esta tool, si el usuario no especificó "calendario de aquí" o "calendario ME", ' +
      'pregunta: "¿Quieres que lo agregue al calendario ME (aquí) o al calendario de tu PC (Google Calendar, Outlook, Apple Calendar)?" ' +
      'Si responde "ME" o "aquí", usa esta tool. Si responde "PC", pídele que configure la integración en ME > Complementos > Integraciones nativas.',
    category: 'fs',
    parameters: {
      title: { type: 'string', description: 'Título del evento' },
      start_ts: { type: 'number', description: 'Timestamp en milisegundos (epoch) del inicio' },
      end_ts: { type: 'number', description: 'Timestamp en milisegundos (epoch) del fin' },
      description: { type: 'string', description: 'Descripción opcional' },
      location: { type: 'string', description: 'Ubicación opcional' },
      calendar_id: { type: 'string', description: 'ID del calendario (personal, work, family). Default: personal' },
      all_day: { type: 'boolean', description: 'Evento de todo el día. Default: false' },
    },
  },
  {
    name: 'me_list_events',
    description: 'Lista los eventos del calendario ME dentro de un rango de fechas.',
    category: 'fs',
    parameters: {
      from_ts: { type: 'number', description: 'Timestamp inicial (epoch ms). Default: ahora' },
      to_ts: { type: 'number', description: 'Timestamp final (epoch ms). Default: ahora + 30 días' },
    },
  },
  {
    name: 'me_create_task',
    description: 'Crea una tarea en la lista de ME.',
    category: 'fs',
    parameters: {
      title: { type: 'string', description: 'Texto de la tarea' },
      priority: { type: 'number', description: '0 = ninguna, 1 = media, 2 = alta. Default: 0' },
      due_ts: { type: 'number', description: 'Fecha límite (epoch ms). Opcional.' },
      list_id: { type: 'string', description: 'ID de la lista. Default: inbox' },
    },
  },
  {
    name: 'me_create_note',
    description: 'Crea una nota rápida en ME.',
    category: 'fs',
    parameters: {
      title: { type: 'string', description: 'Título opcional' },
      body: { type: 'string', description: 'Contenido de la nota' },
    },
  },
  {
    name: 'me_add_shopping',
    description: 'Añade un producto a la lista de la compra de ME.',
    category: 'fs',
    parameters: {
      name: { type: 'string', description: 'Nombre del producto' },
      qty: { type: 'string', description: 'Cantidad (ej. "2 litros")' },
      category: { type: 'string', description: 'Categoría: produce, dairy, meat, bakery, pantry, frozen, beverages, snacks, household, other. Default: other' },
    },
  },
  {
    name: 'me_log_health',
    description: 'Registra una medición de salud en ME.',
    category: 'fs',
    parameters: {
      kind: { type: 'string', description: 'Tipo: weight, sleep, water, meds, steps, heart' },
      value: { type: 'string', description: 'Valor' },
      notes: { type: 'string', description: 'Notas opcionales' },
    },
  },
  {
    name: 'render_html',
    description:
      'Renderiza HTML dentro del chat en una mini-ventana con botones refrescar/cerrar/ocultar/redimensionar. ' +
      'Útil para mostrar dashboards, tablas interactivas, animaciones, prototipos, etc. ' +
      'El HTML se ejecuta en un iframe sandboxed.',
    category: 'fs',
    parameters: {
      title: { type: 'string', description: 'Título de la ventana' },
      html: { type: 'string', description: 'HTML completo a renderizar' },
    },
  },
  {
    name: 'render_pdf',
    description: 'Renderiza un PDF (contenido binario como base64 o texto) dentro del chat en una mini-ventana.',
    category: 'fs',
    parameters: {
      title: { type: 'string', description: 'Título' },
      content: { type: 'string', description: 'Contenido del PDF. Si es texto/HTML, se renderiza como tal. Si es binario, pasar como base64.' },
    },
  },
  // ===================== Modo Cognitivo =====================
  {
    name: 'cognitive_graphify',
    description:
      'Escanea un directorio raíz y construye (o refresca) el Grafo Cognitivo del Proyecto: ' +
      'extrae funciones, clases, interfaces, métodos, variables, tipos, módulos, archivos y carpetas, ' +
      'y conecta con aristas de imports/contains/affects/depends_on. ' +
      'Uso típico: cognitive_graphify({ root_path: "/ruta/al/proyecto" }). ' +
      'Requiere modo Tauri. Tras ejecutarlo, el grafo queda persistido en localStorage ' +
      'y se puede consultar con cognitive_query.',
    category: 'fs',
    parameters: {
      root_path: { type: 'string', description: 'Ruta absoluta al directorio raíz del proyecto a escanear' },
    },
  },
  {
    name: 'cognitive_query',
    description:
      'Consulta el Grafo Cognitivo del Proyecto construido previamente con cognitive_graphify. ' +
      'Soporta 5 modos (pasa exactamente uno): ' +
      '(1) search: busca nodos por nombre (substring). ' +
      '(2) by_kind: lista nodos de un tipo concreto (file, folder, module, function, class, interface, method, variable, type). ' +
      '(3) neighbors: dado un id de nodo, devuelve los nodos conectados. ' +
      '(4) path: BFS más corto entre dos nodos por nombre (from, to). ' +
      '(5) stats: devuelve las estadísticas globales del grafo. ' +
      'En MODO COGNITIVO, el agente DEBE consultar este grafo ANTES de proponer cambios al código.',
    category: 'fs',
    parameters: {
      search: { type: 'string', description: 'Buscar nodos por nombre (substring, case-insensitive)' },
      by_kind: { type: 'string', description: 'Listar nodos de un tipo: file|folder|module|function|class|interface|method|variable|type' },
      neighbors: { type: 'string', description: 'ID del nodo del que se quiere conocer sus vecinos' },
      from: { type: 'string', description: 'Para modo path: nombre del nodo origen (substring)' },
      to: { type: 'string', description: 'Para modo path: nombre del nodo destino (substring)' },
      stats: { type: 'boolean', description: 'Si true, devuelve estadísticas globales del grafo' },
      limit: { type: 'number', description: 'Máximo de resultados (default 50)' },
    },
  },
];

/** Lista de tools para exponer al LLM (formato OpenAI function calling). */
export function buildAdvancedToolsList() {
  const OPTIONAL_KEYS = new Set([
    'cwd', 'timeout', 'max_results', 'create_dirs', 'max_chars', 'mime_type',
    'description', 'location', 'calendar_id', 'all_day', 'priority', 'due_ts', 'list_id',
    'from_ts', 'to_ts', 'notes', 'qty', 'category', 'title',
    'search', 'by_kind', 'neighbors', 'from', 'to', 'stats', 'limit', 'root_path',
  ]);
  return ADVANCED_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.parameters,
        required: Object.keys(t.parameters).filter((k) => !OPTIONAL_KEYS.has(k)),
      },
    },
  }));
}

// ============================================================================
// Dispatcher
// ============================================================================

export interface ToolExecResult {
  ok: boolean;
  output: string;
  error?: string;
}

export async function dispatchAdvancedTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecResult> {
  try {
    switch (name) {
      case 'shell_exec':
        return await shellExec(String(args.command), args.cwd ? String(args.cwd) : undefined, Number(args.timeout ?? 30000));
      case 'file_read':
        return await fileRead(String(args.path));
      case 'file_write':
        return await fileWrite(String(args.path), String(args.content), Boolean(args.create_dirs));
      case 'file_list':
        return await fileList(String(args.path));
      case 'web_search':
        return await webSearch(String(args.query), Number(args.max_results ?? 5));
      case 'web_fetch':
        return await webFetch(String(args.url), Number(args.max_chars ?? 20000));
      case 'save_file':
        return await saveFile(
          String(args.filename),
          String(args.content),
          args.mime_type ? String(args.mime_type) : undefined,
        );
      case 'me_create_event':
        return await meCreateEvent(args);
      case 'me_list_events':
        return await meListEvents(args);
      case 'me_create_task':
        return await meCreateTask(args);
      case 'me_create_note':
        return await meCreateNote(args);
      case 'me_add_shopping':
        return await meAddShopping(args);
      case 'me_log_health':
        return await meLogHealth(args);
      case 'render_html':
        return await renderHtml(args);
      case 'render_pdf':
        return await renderPdf(args);
      case 'cognitive_graphify':
        return await cognitiveGraphify(args);
      case 'cognitive_query':
        return await cognitiveQuery(args);
      default:
        return { ok: false, output: '', error: `Tool desconocida: ${name}` };
    }
  } catch (e) {
    return {
      ok: false,
      output: '',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// ============================================================================
// ME tools — usan el store Zustand directamente vía import dinámico
// ============================================================================

async function meCreateEvent(args: Record<string, unknown>): Promise<ToolExecResult> {
  const { useWeaver } = await import('@/store/weaver');
  const now = Date.now();
  const startTs = Number(args.start_ts);
  const endTs = Number(args.end_ts) || (startTs + 60 * 60 * 1000);
  const ev = {
    id: crypto.randomUUID(),
    title: String(args.title),
    description: args.description ? String(args.description) : null,
    location: args.location ? String(args.location) : null,
    calendar_id: args.calendar_id ? String(args.calendar_id) : 'personal',
    start_ts: startTs,
    end_ts: endTs,
    all_day: Boolean(args.all_day),
    color: null,
    recurrence: null,
    reminder_minutes: 15,
    created_at: now,
    updated_at: now,
  };
  await useWeaver.getState().upsertMeEvent(ev);
  return {
    ok: true,
    output: `Evento creado en ME: "${ev.title}" · ${new Date(ev.start_ts).toLocaleString('es-MX')} → ${new Date(ev.end_ts).toLocaleString('es-MX')}`,
  };
}

async function meListEvents(args: Record<string, unknown>): Promise<ToolExecResult> {
  const { useWeaver } = await import('@/store/weaver');
  await useWeaver.getState().loadMeEvents();
  const events = useWeaver.getState().meEvents;
  const fromTs = args.from_ts ? Number(args.from_ts) : Date.now();
  const toTs = args.to_ts ? Number(args.to_ts) : Date.now() + 30 * 24 * 60 * 60 * 1000;
  const filtered = events.filter((e) => e.start_ts >= fromTs && e.start_ts <= toTs);
  if (filtered.length === 0) return { ok: true, output: 'No hay eventos en el rango.' };
  const lines = filtered.map((e) =>
    `- ${new Date(e.start_ts).toLocaleString('es-MX')} → ${new Date(e.end_ts).toLocaleString('es-MX')}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`,
  );
  return { ok: true, output: `Eventos en ME (${filtered.length}):\n${lines.join('\n')}` };
}

async function meCreateTask(args: Record<string, unknown>): Promise<ToolExecResult> {
  const { useWeaver } = await import('@/store/weaver');
  const t = {
    id: crypto.randomUUID(),
    title: String(args.title),
    notes: null,
    priority: Number(args.priority ?? 0),
    done: false,
    due_ts: args.due_ts ? Number(args.due_ts) : null,
    list_id: args.list_id ? String(args.list_id) : 'inbox',
    created_at: Date.now(),
    completed_at: null,
  };
  await useWeaver.getState().upsertMeTask(t);
  return { ok: true, output: `Tarea creada en ME: "${t.title}"` };
}

async function meCreateNote(args: Record<string, unknown>): Promise<ToolExecResult> {
  const { useWeaver } = await import('@/store/weaver');
  const n = {
    id: crypto.randomUUID(),
    title: args.title ? String(args.title) : null,
    body: String(args.body),
    color: '#7aa67a',
    tags_json: null,
    pinned: false,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  await useWeaver.getState().upsertMeNote(n);
  return { ok: true, output: `Nota creada en ME: "${n.title ?? n.body.slice(0, 40)}…"` };
}

async function meAddShopping(args: Record<string, unknown>): Promise<ToolExecResult> {
  const { useWeaver } = await import('@/store/weaver');
  const it = {
    id: crypto.randomUUID(),
    list_id: 'default',
    name: String(args.name),
    qty: args.qty ? String(args.qty) : null,
    category: args.category ? String(args.category) : 'other',
    checked: false,
    created_at: Date.now(),
    checked_at: null,
  };
  await useWeaver.getState().upsertMeShopping(it);
  return { ok: true, output: `Añadido a la lista de compra: "${it.name}"${it.qty ? ` (${it.qty})` : ''}` };
}

async function meLogHealth(args: Record<string, unknown>): Promise<ToolExecResult> {
  const { useWeaver } = await import('@/store/weaver');
  const units: Record<string, string> = { weight: 'kg', sleep: 'h', water: 'ml', steps: '', heart: 'bpm', meds: '' };
  const kind = String(args.kind);
  const h = {
    id: crypto.randomUUID(),
    kind,
    value: String(args.value),
    unit: units[kind] ?? null,
    ts: Date.now(),
    notes: args.notes ? String(args.notes) : null,
  };
  await useWeaver.getState().upsertMeHealth(h);
  return { ok: true, output: `Registro de salud añadido: ${kind} = ${h.value}${h.unit ? ' ' + h.unit : ''}` };
}

// ============================================================================
// Render tools — devuelven un patrón que el MessageList renderiza
// ============================================================================

async function renderHtml(args: Record<string, unknown>): Promise<ToolExecResult> {
  const title = String(args.title ?? 'HTML');
  const html = String(args.html);
  const id = crypto.randomUUID();
  return {
    ok: true,
    output: `\n[render:html:${id}:${title}]\n[render-content:${id}:text/html]\n${html}\n[/render-content]\n`,
  };
}

async function renderPdf(args: Record<string, unknown>): Promise<ToolExecResult> {
  const title = String(args.title ?? 'PDF');
  const content = String(args.content);
  const id = crypto.randomUUID();
  return {
    ok: true,
    output: `\n[render:pdf:${id}:${title}]\n[render-content:${id}:application/pdf]\n${content}\n[/render-content]\n`,
  };
}

// ============================================================================
// Shell + filesystem (requieren Tauri)
// ============================================================================

async function shellExec(command: string, _cwd?: string, _timeout = 30000): Promise<ToolExecResult> {
  if (runtime.isBrowser) {
    return {
      ok: false,
      output: '',
      error: 'shell_exec solo está disponible en modo Tauri. Ejecuta con `npm run tauri:dev`.',
    };
  }
  try {
    const result = await invokeShellExec(command, _cwd, _timeout);
    return {
      ok: result.code === 0,
      output: result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ''),
      error: result.code !== 0 ? `exit code ${result.code}` : undefined,
    };
  } catch (e) {
    return { ok: false, output: '', error: String(e) };
  }
}

async function fileRead(path: string): Promise<ToolExecResult> {
  if (runtime.isBrowser) {
    return { ok: false, output: '', error: 'file_read solo disponible en modo Tauri.' };
  }
  try {
    const content = await invokeFileRead(path);
    return { ok: true, output: content };
  } catch (e) {
    return { ok: false, output: '', error: String(e) };
  }
}

async function fileWrite(path: string, content: string, createDirs: boolean): Promise<ToolExecResult> {
  if (runtime.isBrowser) {
    return { ok: false, output: '', error: 'file_write solo disponible en modo Tauri.' };
  }
  try {
    await invokeFileWrite(path, content, createDirs);
    return { ok: true, output: `Escrito: ${path} (${content.length} bytes)` };
  } catch (e) {
    return { ok: false, output: '', error: String(e) };
  }
}

async function fileList(path: string): Promise<ToolExecResult> {
  if (runtime.isBrowser) {
    return { ok: false, output: '', error: 'file_list solo disponible en modo Tauri.' };
  }
  try {
    const entries = await invokeFileList(path);
    const text = entries
      .map((e) => (e.is_dir ? `📁 ${e.name}/` : `📄 ${e.name} (${e.size} B)`))
      .join('\n');
    return { ok: true, output: text };
  } catch (e) {
    return { ok: false, output: '', error: String(e) };
  }
}

// ============================================================================
// Web search (Tavily) — funciona en navegador y Tauri
// ============================================================================

const TAVILY_STORAGE_KEY = 'weaver:tavily';

export async function getTavilyApiKey(): Promise<string | null> {
  if (runtime.isTauri) {
    try {
      const k = await keyring.getApiKeyRaw('tavily');
      return k;
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem(TAVILY_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function setTavilyApiKey(key: string): Promise<void> {
  if (runtime.isTauri) {
    await keyring.setApiKey('tavily', key);
    return;
  }
  try {
    localStorage.setItem(TAVILY_STORAGE_KEY, key);
  } catch {
    // ignore
  }
}

export async function deleteTavilyApiKey(): Promise<void> {
  if (runtime.isTauri) {
    await keyring.deleteApiKey('tavily');
    return;
  }
  try {
    localStorage.removeItem(TAVILY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function webSearch(query: string, maxResults: number): Promise<ToolExecResult> {
  const apiKey = await getTavilyApiKey();
  if (!apiKey) {
    return {
      ok: false,
      output: '',
      error:
        'No hay API key de Tavily configurada. Añádela en Configuración > Búsqueda web (Tavily). Obtén una en https://tavily.com',
    };
  }
  try {
    const resp = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: Math.min(maxResults, 10),
        include_answer: true,
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { ok: false, output: '', error: `Tavily ${resp.status}: ${t.slice(0, 200)}` };
    }
    const data = (await resp.json()) as {
      answer?: string;
      results: Array<{ title: string; url: string; content: string; score?: number }>;
    };
    const lines: string[] = [];
    if (data.answer) lines.push(`Respuesta rápida: ${data.answer}`, '');
    lines.push('Resultados:');
    for (const r of data.results) {
      lines.push(`- ${r.title}`);
      lines.push(`  URL: ${r.url}`);
      lines.push(`  ${r.content.slice(0, 300)}`);
      lines.push('');
    }
    return { ok: true, output: lines.join('\n') };
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

// ============================================================================
// Web fetch — funciona en navegador y Tauri (con proxy CORS si hace falta)
// ============================================================================

/**
 * Lista de proxies CORS públicos. Si uno falla, se intenta el siguiente.
 * En Tauri (backend Rust), no se necesita proxy — se hace fetch directo.
 */
const CORS_PROXIES = [
  (url: string) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
];

async function webFetch(url: string, maxChars: number): Promise<ToolExecResult> {
  // En Tauri, fetch directo sin proxy (no hay restricciones CORS).
  if (runtime.isTauri) {
    return webFetchDirect(url, maxChars);
  }

  // En navegador, intentar con cada proxy CORS hasta que uno funcione.
  const errors: string[] = [];
  for (const proxy of CORS_PROXIES) {
    const proxyUrl = proxy(url);
    try {
      const result = await webFetchWithTimeout(proxyUrl, maxChars, 8000);
      if (result.ok && result.output.length > 100) {
        return result;
      }
      if (result.error) errors.push(`${proxyUrl.slice(0, 40)}: ${result.error}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${proxyUrl.slice(0, 40)}: ${msg}`);
    }
  }

  return {
    ok: false,
    output: '',
    error: `Todos los proxies CORS fallaron. Detalles:\n${errors.join('\n')}`,
  };
}

/** Fetch directo (para Tauri o entornos sin CORS). */
async function webFetchDirect(url: string, maxChars: number): Promise<ToolExecResult> {
  try {
    return await webFetchWithTimeout(url, maxChars, 15000);
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Fetch con timeout y limpieza básica de HTML. */
async function webFetchWithTimeout(
  target: string,
  maxChars: number,
  timeoutMs: number,
): Promise<ToolExecResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(target, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Weaver/0.1)' },
    });
    if (!resp.ok) {
      return { ok: false, output: '', error: `HTTP ${resp.status} ${resp.statusText}` };
    }
    const text = await resp.text();
    // Strip HTML básico si la respuesta es HTML.
    let clean = text;
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('text/html') || text.trimStart().startsWith('<')) {
      clean = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    }
    return { ok: true, output: clean.slice(0, maxChars) };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// Save file — genera archivos descargables en el chat
// ============================================================================

/**
 * Genera un archivo con el contenido proporcionado y lo hace disponible
 * para que el usuario lo descargue.
 *
 * - En navegador: descarga directa vía Blob + anchor.
 * - En Tauri: usa file picker dialog para elegir dónde guardar, luego
 *   escribe el archivo con el comando file_write.
 *
 * Devuelve un resultado especial con el formato [file:filename:size]
 * que el MessageList detecta y renderiza como botón de descarga.
 */
async function saveFile(
  filename: string,
  content: string,
  mimeType?: string,
): Promise<ToolExecResult> {
  const sizeBytes = new Blob([content]).size;
  const sizeLabel = formatBytes(sizeBytes);

  // En Tauri: usar file picker para elegir dónde guardar.
  if (runtime.isTauri) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const filePath = await save({
        defaultPath: filename,
        filters: [{ name: filename.split('.').pop()?.toUpperCase() || 'File', extensions: [filename.split('.').pop() || 'txt'] }],
      });
      if (!filePath) {
        return { ok: false, output: '', error: 'El usuario canceló el guardado.' };
      }
      await invokeFileWrite(filePath, content, true);
      return {
        ok: true,
        output: `[file:${filename}:${sizeBytes}:${filePath}]`,
      };
    } catch (e) {
      // Si falla el dialog, hacer descarga directa como fallback.
      console.warn('[save_file] Tauri dialog falló, usando descarga directa:', e);
    }
  }

  // En navegador (o fallback de Tauri): descarga directa vía Blob.
  const mime = mimeType || guessMime(filename);
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Limpiar el URL después de 1s (tiempo para que inicie la descarga).
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return {
    ok: true,
    output: `[file:${filename}:${sizeBytes}:${sizeLabel}]`,
  };
}

/** Infiere el MIME type desde la extensión del archivo. */
function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    ts: 'application/typescript',
    json: 'application/json',
    xml: 'application/xml',
    csv: 'text/csv',
    py: 'text/x-python',
    rs: 'text/x-rust',
    go: 'text/x-go',
    java: 'text/x-java',
    c: 'text/x-c',
    cpp: 'text/x-c++',
    sh: 'application/x-sh',
    yaml: 'application/x-yaml',
    yml: 'application/x-yaml',
    toml: 'application/x-toml',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    zip: 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** Formatea bytes a string legible (ej. 1234 → "1.2 KB"). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Modo Cognitivo — graphify + query
// ============================================================================

async function cognitiveGraphify(args: Record<string, unknown>): Promise<ToolExecResult> {
  const rootPath = String(args.root_path ?? args.rootPath ?? '').trim();
  if (!rootPath) {
    return { ok: false, output: '', error: 'Falta root_path' };
  }
  try {
    const { graphify } = await import('@/lib/cognitive');
    const graph = await graphify(rootPath);
    const s = graph.stats;
    const summary =
      `✅ Grafo Cognitivo construido para: ${graph.rootPath}\n` +
      `   Files: ${s.files}  ·  Folders: ${s.folders}  ·  Modules: ${s.modules}\n` +
      `   Functions: ${s.functions}  ·  Classes: ${s.classes}  ·  Interfaces: ${s.interfaces}\n` +
      `   Methods: ${s.methods}  ·  Variables: ${s.variables}  ·  Types: ${s.types}\n` +
      `   Imports: ${s.imports}  ·  Edges totales: ${s.edges}\n` +
      `   Construido: ${new Date(graph.builtAt).toLocaleString()}`;
    return { ok: true, output: summary };
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

async function cognitiveQuery(args: Record<string, unknown>): Promise<ToolExecResult> {
  try {
    const { loadGraph, queryGraph } = await import('@/lib/cognitive');
    type NodeKind = import('@/lib/cognitive').NodeKind;
    type CognitiveGraph = import('@/lib/cognitive').CognitiveGraph;
    const graph = loadGraph();
    if (!graph) {
      return {
        ok: false,
        output: '',
        error:
          'No hay Grafo Cognitivo construido. Pídele al usuario que ejecute cognitive_graphify ' +
          'con la ruta del proyecto (o hazlo tú si tienes la ruta).',
      };
    }
    const opts: Parameters<typeof queryGraph>[1] = {};
    if (typeof args.search === 'string') opts.search = args.search;
    if (typeof args.by_kind === 'string') opts.byKind = args.by_kind as NodeKind;
    if (typeof args.neighbors === 'string') opts.neighbors = args.neighbors;
    if (typeof args.from === 'string' && typeof args.to === 'string') {
      opts.path = { from: args.from, to: args.to };
    }
    if (args.stats === true) opts.stats = true;
    if (typeof args.limit === 'number') opts.limit = args.limit;

    const result = queryGraph(graph as CognitiveGraph, opts);
    const lines: string[] = [result.summary];
    if (result.nodes.length > 0) {
      lines.push('', 'Nodos:');
      for (const n of result.nodes) {
        lines.push(`  · [${n.kind}] ${n.name}  (${n.file}${n.line > 0 ? `:${n.line}` : ''})`);
      }
    }
    if (result.edges.length > 0) {
      lines.push('', 'Aristas:');
      for (const e of result.edges) {
        lines.push(`  · ${e.fromName} --${e.kind}--> ${e.toName}`);
      }
    }
    return { ok: true, output: lines.join('\n') };
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}
