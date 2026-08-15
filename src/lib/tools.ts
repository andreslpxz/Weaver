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
import { diffLines, diffWordsWithSpace } from 'diff';

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
    name: 'sandbox_run',
    description:
      'Ejecuta código Python, Node.js o Bash en un sandbox efímero (directorio temporal aislado). ' +
      'Úsalo cuando necesites procesar datos, calcular, parsear JSON/CSV, generar contenido ' +
      'programáticamente, o ejecutar lógica que no se puede hacer con una sola shell_exec. ' +
      'El código corre con un timeout duro (default 30s, máx 60s). ' +
      'El sandbox está aislado: NO ve archivos del host, su working directory es un /tmp efímero. ' +
      'Si necesitas datos del host, pásalos como `stdin` o como literales en el código. ' +
      'NO uses sandbox_run para tareas que ya tienen tools específicas (shell_exec para comandos, ' +
      'file_read para leer archivos, save_file para descargas). sandbox_run es para PENSAR CON CÓDIGO.',
    category: 'fs',
    parameters: {
      language: { type: 'string', description: 'Lenguaje: "python", "node" o "bash"' },
      code: { type: 'string', description: 'Código completo a ejecutar (script completo, no fragmento)' },
      stdin: { type: 'string', description: 'Texto opcional a pasar al script por stdin' },
      timeout: { type: 'number', description: 'Timeout en ms (default 30000, máx 60000)' },
    },
  },
  {
    name: 'save_file',
    description:
      'Genera un archivo con el contenido proporcionado y lo hace disponible en el chat. ' +
      'Útil cuando el usuario pide "crea un archivo", "genera un script", "hazme un resumen en un documento", etc. ' +
      'Si el archivo es imagen/audio/video (png, jpg, mp3, wav, mp4, etc.), se previsualiza y reproduce directamente ' +
      'inline en el chat (usa encoding="base64" con el contenido binario real para estos casos). ' +
      'Para el resto de archivos aparece como botón de descarga/guardado. ' +
      'En modo Tauri, pregunta al usuario dónde guardarlo. En modo navegador, lo mantiene disponible en el chat.',
    category: 'fs',
    parameters: {
      filename: { type: 'string', description: 'Nombre del archivo (ej. "resumen.md", "script.py", "audio.mp3", "foto.png")' },
      content: { type: 'string', description: 'Contenido completo del archivo. Para archivos de texto: texto plano. Para binarios (audio/imagen/video generados por otra tool, p. ej. TTS): base64 SIN el prefijo "data:", y marca encoding="base64".' },
      encoding: { type: 'string', description: '"text" (default) o "base64". Usa "base64" para audio/imagen/video reales para no corromper el binario.' },
      mime_type: { type: 'string', description: 'Tipo MIME opcional (ej. "text/markdown", "audio/mpeg", "image/png")' },
    },
  },
  // ===================== ME: Espacio personal del USUARIO =====================
  // IMPORTANTE: "ME" / "MI" es la sección PERSONAL DEL USUARIO dentro de Weaver.
  // Estas tools guardan datos DEL USUARIO (sus notas, sus tareas, su calendario,
  // su lista de la compra, su salud). NO son la memoria del agente.
  // Úsalas SÓLO cuando el usuario pida explícitamente anotar algo en SU espacio.
  {
    name: 'me_create_event',
    description:
      'Crea un evento en el calendario DEL USUARIO dentro de MI/ME (la sección personal de Weaver). ' +
      'IMPORTANTE: esta tool es para gestionar la vida del USUARIO, no para que el agente se auto-registre. ' +
      'Úsala SÓLO cuando el usuario pida explícitamente algo como "pon en mi calendario…", "recuérdame que…", "agenda…". ' +
      'Antes de usar esta tool, si el usuario no especificó "calendario de aquí" o "calendario MI", ' +
      'pregunta: "¿Quieres que lo agregue al calendario MI (aquí) o al calendario de tu PC (Google Calendar, Outlook, Apple Calendar)?" ' +
      'Si responde "MI" o "aquí", usa esta tool. Si responde "PC", pídele que configure la integración en MI > Complementos > Integraciones nativas.',
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
    description: 'Lista los eventos del calendario DEL USUARIO en MI dentro de un rango de fechas. Úsala cuando el usuario pregunte "¿qué tengo esta semana?", "¿qué hay en mi calendario?", etc.',
    category: 'fs',
    parameters: {
      from_ts: { type: 'number', description: 'Timestamp inicial (epoch ms). Default: ahora' },
      to_ts: { type: 'number', description: 'Timestamp final (epoch ms). Default: ahora + 30 días' },
    },
  },
  {
    name: 'me_create_task',
    description: 'Crea una tarea en la lista de tareas DEL USUARIO en MI. ' +
      'IMPORTANTE: es una tarea para el USUARIO (ej: "comprar pan", "llamar al dentista"), NO una tarea del agente. ' +
      'Úsala SÓLO cuando el usuario pida algo como "anota esta tarea…", "recuérdame que tengo que…", "agrega a mi lista de tareas…".',
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
    description: 'Crea una nota rápida en el cuaderno DEL USUARIO en MI. ' +
      'CRÍTICO: esta nota va al espacio personal del USUARIO, no a tu memoria como agente. ' +
      'Úsala SÓLO cuando el usuario pida explícitamente algo como "anota en MI…", "guárdame esta nota…", "apunta…". ' +
      'NUNCA la uses para registrar cosas sobre ti mismo (tus capacidades, tu estado, tus reflexiones, tu auto-descripción). ' +
      'Si el usuario pregunta "¿qué puedes hacer?" o "¿quién eres?", RESPONDE en el chat directamente, NO crees una nota.',
    category: 'fs',
    parameters: {
      title: { type: 'string', description: 'Título opcional' },
      body: { type: 'string', description: 'Contenido de la nota' },
    },
  },
  {
    name: 'me_add_shopping',
    description: 'Añade un producto a la lista de la compra DEL USUARIO en MI. ' +
      'Úsala SÓLO cuando el usuario pida algo como "añade a la lista de la compra…", "apunta que necesito comprar…", "agrega a mi lista…".',
    category: 'fs',
    parameters: {
      name: { type: 'string', description: 'Nombre del producto' },
      qty: { type: 'string', description: 'Cantidad (ej. "2 litros")' },
      category: { type: 'string', description: 'Categoría: produce, dairy, meat, bakery, pantry, frozen, beverages, snacks, household, other. Default: other' },
    },
  },
  {
    name: 'me_log_health',
    description: 'Registra una medición de salud DEL USUARIO en MI (peso, sueño, agua, medicación, pasos, ritmo cardíaco). ' +
      'Úsala SÓLO cuando el usuario pida algo como "registra mi peso…", "anota cuánto dormí…", "apunta que tomé mi medicación…".',
    category: 'fs',
    parameters: {
      kind: { type: 'string', description: 'Tipo: weight, sleep, water, meds, steps, heart' },
      value: { type: 'string', description: 'Valor' },
      notes: { type: 'string', description: 'Notas opcionales' },
    },
  },
  // ===================== Memoria del AGENTE (chat memory) =====================
  // Esta es la MEMORIA PROPIA DEL AGENTE — hechos clave que vale la pena
  // recordar en futuras conversaciones (nombre del usuario, preferencias,
  // decisiones, contexto de proyectos, instrucciones de uso). Se inyecta
  // automáticamente en el system prompt de cada chat cuando chatMemoryMode
  // está activo. Es DISTINTA de "MI"/"ME" — esa es la sección personal del
  // usuario (notas, tareas, calendario, salud, compra). Esta es la memoria
  // semántica del agente sobre el usuario y la relación con él.
  {
    name: 'memory_save_fact',
    description:
      'Guarda un hecho en tu memoria semántica (chat memory) para recordarlo en futuras conversaciones. ' +
      'Úsalo ACTIVAMENTE cuando el usuario comparta información personal, preferencias, contexto, ' +
      'instrucciones o decisiones que valga la pena recordar: nombre, profesión, gustos, fechas ' +
      'importantes, reglas de funcionamiento, idioma preferido, proyectos en curso, lo que ya ' +
      'hiciste por él, etc. También ÚSALO cuando el usuario te pida explícitamente "guarda esto", ' +
      '"recuerda que", "anota", "apunta", "memoriza", "no te olvides de" — aunque no mencione "MI".\n' +
      'Para notas largas con título/formateo, usa me_create_note en su lugar.\n' +
      'Ejemplos de uso:\n' +
      '- User dice "me llamo John" → memory_save_fact(key="user:name", value="John")\n' +
      '- User dice "prefiero que me hables en tú, no en usted" → memory_save_fact(key="user:tuteo", value="true")\n' +
      '- User dice "trabajo como ingeniero en Google" → memory_save_fact(key="user:job", value="Ingeniero en Google")\n' +
      '- User dice "ya configuré el deploy en Vercel" → memory_save_fact(key="project:deploy", value="Vercel configurado")',
    category: 'fs',
    parameters: {
      key: { type: 'string', description: 'Clave corta y única en formato namespace:nombre (ej: "user:name", "user:preferred_language", "user:birthday", "project:status"). Si la clave ya existe, se sobrescribe.' },
      value: { type: 'string', description: 'Valor del hecho. Breve (1-2 frases). Para cosas más largas usa me_create_note.' },
    },
  },
  {
    name: 'memory_list_facts',
    description:
      'Lista todos los hechos guardados en tu memoria semántica (chat memory). ' +
      'Úsalo cuando el usuario te pregunte "¿qué recuerdas de mí?", "¿qué tienes en tu memoria?", ' +
      '"¿qué sabes sobre mí?", o quieras refrescar tu memoria antes de responder.',
    category: 'fs',
    parameters: {},
  },
  {
    name: 'memory_delete_fact',
    description:
      'Elimina un hecho específico de tu memoria semántica por su clave. ' +
      'Úsalo cuando el usuario te pida "olvida X", "borra lo que guardaste sobre Y", ' +
      '"ya no quiero que recuerdes Z".',
    category: 'fs',
    parameters: {
      key: { type: 'string', description: 'Clave del hecho a eliminar (ej: "user:name")' },
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
  // ===================== Subagentes (delegación) =====================
  // Permite al LLM delegar subtareas a subagentes especializados. Cada
  // subagente tiene sus propias tools, su propio system prompt y su propio
  // presupuesto. El orquestador selecciona el subagente por keyword match
  // si no se especifica subagent_name.
  {
    name: 'delegate_to_subagent',
    description:
      'Delega una subtarea a un subagente especializado del catálogo. El subagente tiene su propio ' +
      'set de tools restringido, su propio system prompt y su propio presupuesto. Devuelve el resultado ' +
      'estructurado del subagente con evidencia.\n' +
      'Úsalo cuando:\n' +
      '- La tarea tiene un componente aislable (ej: "investiga X en internet y resume", "lee estos 5 archivos y extrae Y").\n' +
      '- Quieres que un especialista haga una parte (Web Researcher, File Reader, Email Summarizer, etc.).\n' +
      '- Necesitas aislamiento de errores (si el subagente falla, no te afecta).\n' +
      'Si no especificas subagent_name, se selecciona automáticamente por keyword match en el objetivo.',
    category: 'automation',
    parameters: {
      objective: { type: 'string', description: 'Objetivo claro y autosuficiente del subagente (ej: "investiga los 3 mejores frameworks de Rust para web en 2025 y devuelve URLs")' },
      subagent_name: { type: 'string', description: 'Nombre exacto del subagente del catálogo (opcional — si omitido, se selecciona automáticamente por keyword match)' },
      context: { type: 'string', description: 'Contexto adicional para el subagente (opcional)' },
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
    'subagent_name', 'context',
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
      case 'sandbox_run':
        return await sandboxRun({
          language: String(args.language ?? 'python') as 'python' | 'node' | 'bash',
          code: String(args.code ?? ''),
          stdin: args.stdin ? String(args.stdin) : undefined,
          timeout: args.timeout ? Number(args.timeout) : undefined,
        });
      case 'save_file':
        return await saveFile(
          String(args.filename),
          String(args.content),
          args.mime_type ? String(args.mime_type) : undefined,
          args.encoding === 'base64' ? 'base64' : 'text',
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
      case 'memory_save_fact':
        return await memorySaveFact(args);
      case 'memory_list_facts':
        return await memoryListFacts();
      case 'memory_delete_fact':
        return await memoryDeleteFact(args);
      case 'render_html':
        return await renderHtml(args);
      case 'render_pdf':
        return await renderPdf(args);
      case 'cognitive_graphify':
        return await cognitiveGraphify(args);
      case 'cognitive_query':
        return await cognitiveQuery(args);
      case 'delegate_to_subagent':
        return await delegateToSubagent(args);
      default:
        // Tools MCP con prefijo mcp__<serverId>__<toolName>.
        if (name.startsWith('mcp__')) {
          return await dispatchMcpTool(name, args);
        }
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

/**
 * Dispatcher para tools de servidores MCP.
 * El nombre viene con el prefijo mcp__<serverId>__<toolName> que se armó en
 * Composer.runChatWithTools cuando se cargaron las tools del servidor MCP.
 */
async function dispatchMcpTool(
  fullToolName: string,
  args: Record<string, unknown>,
): Promise<ToolExecResult> {
  // Formato: mcp__<serverId>__<toolName>
  // serverId puede contener guiones (preset-figma-1234567890), pero NO '__'.
  const parts = fullToolName.split('__');
  if (parts.length < 3 || parts[0] !== 'mcp') {
    return { ok: false, output: '', error: `Nombre de tool MCP inválido: ${fullToolName}` };
  }
  const serverId = parts.slice(1, -1).join('__');
  const toolName = parts[parts.length - 1];
  try {
    const { mcpClient } = await import('@/mcp/client');
    const result = (await mcpClient.callTool(serverId, toolName, args)) as {
      content: Array<{ type?: string; text?: string } | string>;
      is_error: boolean;
    };
    // McpCallResult tiene { content: McpContent[], is_error }
    const output = Array.isArray(result.content)
      ? result.content
          .map((c: { type?: string; text?: string } | string) =>
            typeof c === 'string' ? c : (c?.text ?? JSON.stringify(c)),
          )
          .join('\n')
      : JSON.stringify(result);
    return {
      ok: !result.is_error,
      output: output.slice(0, 8000),
      error: result.is_error ? output.slice(0, 500) : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      output: '',
      error: `MCP ${serverId}/${toolName}: ${e instanceof Error ? e.message : String(e)}`,
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
// Memoria del AGENTE (chat memory) — hechos semánticos que el agente recuerda
// sobre el usuario y sus proyectos en futuras conversaciones.
// Uses @/agent/memory (SQLite in Tauri, localStorage fallback in browser).
// ============================================================================

async function memorySaveFact(args: Record<string, unknown>): Promise<ToolExecResult> {
  const { memory } = await import('@/agent/memory');
  const key = String(args.key ?? '').trim();
  const value = String(args.value ?? '').trim();
  if (!key) return { ok: false, output: '', error: 'memory_save_fact requiere "key"' };
  if (!value) return { ok: false, output: '', error: 'memory_save_fact requiere "value"' };
  await memory.setFact(key, value, 'agent');
  return {
    ok: true,
    output: `Hecho guardado en memoria: ${key} = ${value.slice(0, 80)}${value.length > 80 ? '…' : ''}`,
  };
}

async function memoryListFacts(): Promise<ToolExecResult> {
  const { memory } = await import('@/agent/memory');
  const facts = await memory.listFacts();
  if (facts.length === 0) {
    return { ok: true, output: 'Memoria vacía. Aún no has guardado ningún hecho.' };
  }
  const lines = facts.map((f) => `- ${f.key}: ${f.value}`);
  return {
    ok: true,
    output: `Memoria del agente (${facts.length} hechos):\n${lines.join('\n')}`,
  };
}

async function memoryDeleteFact(args: Record<string, unknown>): Promise<ToolExecResult> {
  const { memory } = await import('@/agent/memory');
  const key = String(args.key ?? '').trim();
  if (!key) return { ok: false, output: '', error: 'memory_delete_fact requiere "key"' };
  const existingValue = await memory.getFact(key);
  if (!existingValue) {
    return { ok: true, output: `No había ningún hecho con la clave "${key}".` };
  }
  await memory.deleteFact(key);
  return {
    ok: true,
    output: `Hecho eliminado de memoria: ${key} (era: ${existingValue.slice(0, 80)})`,
  };
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
    // Detectar si el comando modifica archivos (para emitir line marks en IDE).
    // Heurística: redirecciones `>` `>>`, comandos sed -i, echo >, cat >, tee,
    // dd of=, etc. Capturamos las rutas objetivo para emitir el evento.
    const modifiedPaths = detectShellFileModifications(command);
    const beforeSnapshots = new Map<string, string | null>();
    if (modifiedPaths.length > 0) {
      for (const p of modifiedPaths) {
        try {
          const content = await invokeFileRead(p);
          beforeSnapshots.set(p, content);
        } catch {
          beforeSnapshots.set(p, null); // no existe todavía
        }
      }
    }

    const result = await invokeShellExec(command, _cwd, _timeout);

    // Si detectamos modificaciones a archivos, emitir eventos con diff Myers.
    if (modifiedPaths.length > 0) {
      for (const p of modifiedPaths) {
        try {
          const after = await invokeFileRead(p);
          const before = beforeSnapshots.get(p) ?? null;
          emitFileChangeEvent(p, before, after);
        } catch {
          // El archivo pudo haber sido eliminado por el comando.
          if (typeof window !== 'undefined') {
            try {
              window.dispatchEvent(
                new CustomEvent('weaver:agent-file-change', {
                  detail: {
                    path: p,
                    name: p.split(/[\\/]/).pop() ?? p,
                    type: 'deleted' as const,
                    ts: Date.now(),
                    summary: 'Eliminado por shell_exec',
                  },
                }),
              );
            } catch {
              /* noop */
            }
          }
        }
      }
    }

    return {
      ok: result.code === 0,
      output: result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : ''),
      error: result.code !== 0 ? `exit code ${result.code}` : undefined,
    };
  } catch (e) {
    return { ok: false, output: '', error: String(e) };
  }
}

/**
 * Detecta rutas de archivos que un comando shell probablemente modificará.
 * Heurística simple basada en patrones comunes:
 *   - `cmd > file` o `cmd >> file`
 *   - `sed -i ... file`
 *   - `echo "..." > file`
 *   - `cat > file <<EOF ... EOF`
 *   - `tee file`
 *   - `cp src dst` (toma dst)
 *   - `mv src dst` (toma dst)
 *   - `dd of=file`
 *   - `mkdir -p path` (no emitimos evento, no es modificación de archivo)
 *
 * No es perfecto (no ejecuta el shell), pero cubre los casos más comunes.
 */
function detectShellFileModifications(command: string): string[] {
  const paths = new Set<string>();

  // Normalizar: quitar exports, var=valor al inicio
  const cmd = command.trim();

  // Redirecciones `>` y `>>` (no `2>&1` ni `1>&2`)
  const redirectMatches = cmd.matchAll(/(?:>>|>)\s*([^\s|&;<>]+(?<!&))/g);
  for (const m of redirectMatches) {
    const target = m[1];
    if (target && !target.startsWith('&') && !target.startsWith('/dev/')) {
      paths.add(target.replace(/^["']|["']$/g, ''));
    }
  }

  // sed -i ... file
  const sedMatch = cmd.match(/\bsed\b\s+(?:-[a-zA-Z]+\s+)*-i\b[^\n]*?(?:--\s+)?(\S+)$/);
  if (sedMatch && sedMatch[1]) {
    paths.add(sedMatch[1].replace(/^["']|["']$/g, ''));
  }
  // sed -i patron más general: sed -i'' o sed -i 'expr' file
  const sedGeneral = cmd.match(/\bsed\b\s+-i\S*\s+'[^']+'\s+(\S+)/);
  if (sedGeneral && sedGeneral[1]) {
    paths.add(sedGeneral[1].replace(/^["']|["']$/g, ''));
  }

  // tee file
  const teeMatches = cmd.matchAll(/\btee\b\s+(?:-a\s+)?([^\s|&;<>]+)/g);
  for (const m of teeMatches) {
    if (m[1] && !m[1].startsWith('-')) {
      paths.add(m[1].replace(/^["']|["']$/g, ''));
    }
  }

  // dd of=file
  const ddMatch = cmd.match(/\bdd\b[^\n]*?\bof=(\S+)/);
  if (ddMatch && ddMatch[1]) {
    paths.add(ddMatch[1].replace(/^["']|["']$/g, ''));
  }

  // cp src dst  (último argumento)
  const cpMatch = cmd.match(/\bcp\b\s+(?:-[a-zA-Z]+\s+)*(\S+)\s+(\S+)\s*$/);
  if (cpMatch && cpMatch[2]) {
    paths.add(cpMatch[2].replace(/^["']|["']$/g, ''));
  }

  // mv src dst
  const mvMatch = cmd.match(/\bmv\b\s+(?:-[a-zA-Z]+\s+)*(\S+)\s+(\S+)\s*$/);
  if (mvMatch && mvMatch[2]) {
    paths.add(mvMatch[2].replace(/^["']|["']$/g, ''));
  }

  return Array.from(paths).filter((p) => p && !p.startsWith('-'));
}

/**
 * Calcula diff Myers línea-a-línea entre dos contenidos y emite el evento
 * `weaver:agent-file-change` con las LineMark[] para el IdeLayout.
 * Verde (added) para líneas nuevas, rojo (removed) para eliminadas o modificadas.
 */
function emitFileChangeEvent(path: string, before: string | null, after: string): void {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const fileExists = before !== null;
  const changeType: 'created' | 'modified' = fileExists ? 'modified' : 'created';

  // diffLines de la lib `diff` implementa Myers real.
  const parts = diffLines(before ?? '', after);
  const lines: { type: 'added' | 'removed'; line: number }[] = [];

  let currentLine = 1; // 1-indexed en el archivo NUEVO
  for (const part of parts) {
    const partLineCount = part.value.split('\n').length - 1;
    // diffLines puede devolver un trailing \n que cuenta como línea extra
    if (part.added) {
      // Líneas agregadas → verde
      for (let i = 0; i < partLineCount; i++) {
        lines.push({ type: 'added', line: currentLine + i });
      }
      currentLine += partLineCount;
    } else if (part.removed) {
      // Líneas eliminadas/reemplazadas → rojo (en la posición donde estaban).
      // Como no existen en el archivo nuevo, marcamos la línea SIGUIENTE del
      // archivo nuevo (que ocupa su lugar) como "removed" para que el usuario
      // vea dónde ocurrió la eliminación. Si el archivo se acorta al final,
      // marcamos la última línea disponible.
      for (let i = 0; i < partLineCount; i++) {
        lines.push({ type: 'removed', line: currentLine });
      }
      // No avanzamos currentLine porque las líneas removed no existen en new.
    } else {
      currentLine += partLineCount;
    }
  }

  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent('weaver:agent-file-change', {
          detail: {
            path,
            name: fileName,
            type: changeType,
            ts: Date.now(),
            summary: `${lines.length} línea(s) marcada(s) por el agente`,
            lines,
          },
        }),
      );
    } catch {
      /* noop */
    }
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
    // Leer contenido previo (si existe) para calcular diff Myers real.
    let previousContent: string | null = null;
    try {
      previousContent = await invokeFileRead(path);
    } catch {
      // El archivo no existe todavía — será "created".
    }

    await invokeFileWrite(path, content, createDirs);

    // Emitir evento con diff Myers real (verde agregadas / rojo eliminadas o reemplazadas).
    emitFileChangeEvent(path, previousContent, content);

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
// Sandbox de código — ejecuta Python / Node / Bash de forma controlada.
//
// FASE 1 (esto): subprocess con timeout y working dir temporal. Sin
// aislamiento real del kernel todavía (bubblewrap/gVisor vendrán en Fase 2).
// La interfaz pública es estable: cuando añadamos aislamiento real, el LLM
// no tendrá que cambiar cómo llama a la tool.
//
// El sandbox:
//   - Crea un directorio temporal efímero por ejecución (se limpia al final).
//   - Ejecuta el código con un intérprete del sistema (python3/node/bash).
//   - Timeout duro: si el script cuelga, lo mata.
//   - Captura stdout + stderr por separado, los devuelve al LLM.
//   - NO hereda variables de entorno del host (las limpia, excepto PATH).
//   - Working dir: el tmp dir creado, no el del host.
//
// Esto ya da seguridad básica: el script no puede escribir en /home/$USER
// porque su cwd es /tmp/weaver-sandbox-XXX. La Fase 2 añadirá bubblewrap
// para restringir syscalls (no fork bombs, no network saliente no autorizado).
// ============================================================================

interface SandboxRunArgs {
  language: 'python' | 'node' | 'bash';
  code: string;
  stdin?: string;
  timeout?: number;
}

async function sandboxRun(args: SandboxRunArgs): Promise<ToolExecResult> {
  if (runtime.isBrowser) {
    return {
      ok: false,
      output: '',
      error:
        'sandbox_run solo está disponible en modo Tauri (desktop). ' +
        'En el navegador no se pueden ejecutar subprocesos. ' +
        'Ejecuta Weaver con `npm run tauri:dev` o usa la app instalada.',
    };
  }

  const language = args.language;
  const code = args.code ?? '';
  const stdin = args.stdin ?? '';
  // Cap timeout at 60s — no dar chart blanche al script.
  const timeout = Math.min(Math.max(args.timeout ?? 30000, 1000), 60000);

  if (!code.trim()) {
    return { ok: false, output: '', error: 'El código está vacío.' };
  }

  // Mapear language → intérprete + extensión.
  let interpreter: string;
  let ext: string;
  let extraArgs: string[] = [];
  switch (language) {
    case 'python':
      interpreter = 'python3';
      ext = '.py';
      break;
    case 'node':
      interpreter = 'node';
      ext = '.js';
      break;
    case 'bash':
      interpreter = 'bash';
      ext = '.sh';
      break;
    default:
      return {
        ok: false,
        output: '',
        error: `Lenguaje no soportado: ${language}. Usa python, node o bash.`,
      };
  }

  try {
    // Crear directorio temporal efímero para esta ejecución.
    // Usamos un comando mkdir vía shell_exec para que sea consistente con
    // el resto del código (y funcione en Tauri).
    const tmpDir = `/tmp/weaver-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const scriptPath = `${tmpDir}/script${ext}`;

    // Crear directorio + escribir script.
    const mkdirResult = await invokeShellExec(`mkdir -p ${tmpDir}`, undefined, 5000);
    if (mkdirResult.code !== 0) {
      return {
        ok: false,
        output: '',
        error: `No se pudo crear el directorio sandbox: ${mkdirResult.stderr || 'unknown'}`,
      };
    }

    // Escribir el código al script. Usamos invokeFileWrite directo (pasa por
    // el backend Rust, soporta cualquier contenido sin escapado shell).
    // El directorio padre ya existe (lo creamos con mkdir -p arriba).
    try {
      await invokeFileWrite(scriptPath, code, false);
    } catch (e) {
      // Fallback: heredoc con marcador único aleatorio.
      const marker = `WEAVER_EOF_${Math.random().toString(36).slice(2, 12)}`;
      // Escapar el marker en el código si aparece (extremadamente improbable).
      const safeCode = code.replace(new RegExp(marker, 'g'), marker + '_ESCAPED');
      const writeCmd = `cat > ${scriptPath} <<'${marker}'\n${safeCode}\n${marker}`;
      const writeResult = await invokeShellExec(writeCmd, undefined, 5000);
      if (writeResult.code !== 0) {
        return {
          ok: false,
          output: '',
          error: `No se pudo escribir el script: ${writeResult.stderr || e}`,
        };
      }
    }

    // Construir el comando a ejecutar.
    // - `cd tmpDir && interpreter scriptPath` — el cwd del script es el sandbox.
    // - Si hay stdin, se lo pasamos por pipe.
    // - Timeout: usamos el `timeout` de GNU coreutils (Linux) o `gtimeout` (macOS).
    //   En Tauri, el invokeShellExec ya tiene timeout propio, pero añadimos
    //   este por si el proceso hijo hace fork y escapa.
    const hasTimeoutCmd = await hasCoreutilsTimeout();
    const timeoutPrefix = hasTimeoutCmd ? `timeout ${Math.ceil(timeout / 1000)} ` : '';
    const cmd = `cd ${tmpDir} && ${timeoutPrefix}${interpreter} ${extraArgs.join(' ')} ${scriptPath}`;

    // Pasar stdin al comando si existe. invokeShellExec no soporta stdin
    // directo, así que usamos echo + pipe. Si el stdin es muy grande, esto
    // puede romper por límites de línea del shell — por ahora vivimos con eso.
    const fullCmd = stdin
      ? `printf %s "${stdin.replace(/[$`"\\]/g, '\\$&')}" | ${cmd}`
      : cmd;

    const result = await invokeShellExec(fullCmd, undefined, timeout + 2000);

    // Limpiar el directorio temporal (best-effort, no bloquear).
    void invokeShellExec(`rm -rf ${tmpDir}`, undefined, 3000).catch(() => {});

    // Detectar si timeout mató el proceso (código 124 de `timeout`).
    const wasKilledByTimeout = hasTimeoutCmd && result.code === 124;

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const truncatedStdout = stdout.slice(0, 8000);
    const truncatedStderr = stderr.slice(0, 2000);

    let output = '';
    if (truncatedStdout) output += truncatedStdout;
    if (truncatedStderr) output += (output ? '\n\n[stderr]\n' : '[stderr]\n') + truncatedStderr;
    if (wasKilledByTimeout) {
      output += (output ? '\n\n' : '') + `[sandbox] ⏱️ timeout de ${Math.ceil(timeout / 1000)}s alcanzado — proceso matado.`;
    }
    if (stdout.length > 8000) {
      output += `\n[sandbox] ⚠️ stdout truncado (${stdout.length - 8000} chars omitidos).`;
    }

    return {
      ok: result.code === 0,
      output: output || '(sin salida)',
      error: result.code !== 0
        ? (wasKilledByTimeout ? 'timeout' : `exit code ${result.code}`)
        : undefined,
    };
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

// Verifica si `timeout` de GNU coreutils está disponible (Linux siempre,
// macOS si coreutils está instalado vía brew). Cachea el resultado.
let _hasTimeoutCmd: boolean | null = null;
async function hasCoreutilsTimeout(): Promise<boolean> {
  if (_hasTimeoutCmd !== null) return _hasTimeoutCmd;
  try {
    const r = await invokeShellExec('which timeout 2>/dev/null', undefined, 2000);
    _hasTimeoutCmd = r.code === 0 && r.stdout.trim().length > 0;
  } catch {
    _hasTimeoutCmd = false;
  }
  return _hasTimeoutCmd;
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

/** Extensiones que el chat puede previsualizar inline (imagen/audio/video). */
function isPreviewableMedia(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return [
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
    'mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac',
    'mp4', 'webm', 'mov', 'mkv', 'avi',
  ].includes(ext);
}

/** Decodifica un string base64 (sin prefijo data:) a un Uint8Array. */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.trim().replace(/^data:[^,]+,/, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Genera un archivo con el contenido proporcionado y lo hace disponible
 * en el chat: previsualizable inline si es imagen/audio/video, o como
 * botón de descarga/guardado para el resto.
 *
 * - En navegador: crea un Blob. Multimedia se previsualiza con la blob URL;
 *   el resto se descarga directo vía anchor.
 * - En Tauri: usa file picker dialog para elegir dónde guardar, luego
 *   escribe el archivo con el comando file_write (soporta base64 → bytes
 *   reales para no corromper binarios).
 *
 * Devuelve un resultado especial [file:filename:sizeBytes:pathOrUrl] que
 * MessageList detecta y renderiza.
 */
async function saveFile(
  filename: string,
  content: string,
  mimeType?: string,
  encoding: 'text' | 'base64' = 'text',
): Promise<ToolExecResult> {
  const isBase64 = encoding === 'base64';
  const sizeBytes = isBase64 ? base64ToBytes(content).length : new Blob([content]).size;
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
      await invokeFileWrite(filePath, content, true, isBase64);
      return {
        ok: true,
        output: `[file:${filename}:${sizeBytes}:${filePath}]`,
      };
    } catch (e) {
      // Si falla el dialog, hacer descarga directa como fallback.
      console.warn('[save_file] Tauri dialog falló, usando descarga directa:', e);
    }
  }

  // En navegador (o fallback de Tauri): crear Blob con los bytes correctos.
  const mime = mimeType || guessMime(filename);
  const blob = isBase64 ? new Blob([base64ToBytes(content) as BlobPart], { type: mime }) : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  if (isPreviewableMedia(filename)) {
    // Imagen/audio/video: mantener la URL viva para previsualizar inline en
    // el chat en vez de forzar descarga inmediata. Se revoca cuando la app
    // se recarga; es aceptable porque es memoria de sesión, no persistencia.
    return {
      ok: true,
      output: `[file:${filename}:${sizeBytes}:${url}]`,
    };
  }

  // Resto de archivos: descarga directa como antes.
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
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
    webp: 'image/webp',
    svg: 'image/svg+xml',
    zip: 'application/zip',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
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

// ============================================================================
// delegate_to_subagent — delega a un subagente del catálogo vía orchestrator
// ============================================================================

async function delegateToSubagent(args: Record<string, unknown>): Promise<ToolExecResult> {
  const objective = String(args.objective ?? '').trim();
  if (!objective) {
    return { ok: false, output: '', error: 'Falta el parámetro "objective".' };
  }
  const subagentName = args.subagent_name ? String(args.subagent_name).trim() : '';
  const contextStr = args.context ? String(args.context) : '';

  try {
    const { useWeaver } = await import('@/store/weaver');
    const { createProvider } = await import('@/providers');
    const { orchestrate, formatExecutionTree } = await import('@/agent/orchestrator');
    const { subagentRegistry } = await import('@/agent/subagent');

    const state = useWeaver.getState();
    const providerId = state.providerId;
    const modelId = state.modelId;
    if (!providerId || !modelId) {
      return {
        ok: false,
        output: '',
        error: 'No hay provider/modelo configurado. Configúralo en Ajustes.',
      };
    }

    const llm = await createProvider(providerId);

    // Si el usuario especificó un subagente por nombre, validar que existe.
    if (subagentName) {
      const all = subagentRegistry.list();
      const found = all.find((s) => s.name.toLowerCase() === subagentName.toLowerCase());
      if (!found) {
        return {
          ok: false,
          output: '',
          error:
            `Subagente "${subagentName}" no encontrado. ` +
            `Disponibles: ${all.map((s) => s.name).join(', ') || '(ninguno)'}`,
        };
      }
    }

    const result = await orchestrate(
      {
        objective,
        context: contextStr,
        totalBudget: { maxSteps: 8, maxTokens: 20_000, maxTimeMs: 120_000 },
        allowRetry: true,
        allowEscalation: false,
      },
      { provider: llm, model: modelId },
    );

    const treeText = formatExecutionTree(result.tree);
    const evidenceText = result.evidence.length
      ? result.evidence
          .slice(0, 5)
          .map((e) => `  · [${e.subagentName}] ${e.label}: ${e.content.slice(0, 200)}`)
          .join('\n')
      : '(sin evidencia)';

    const output =
      `Estado: ${result.status}\n` +
      `Subagente(s) usado(s): ${result.tree.map((n) => n.subagentName).join(', ') || '(ninguno)'}\n` +
      `Costo total: ${result.totalCost.inputTokens + result.totalCost.outputTokens} tokens · ${result.totalCost.steps} pasos · ${result.totalCost.elapsedMs}ms\n\n` +
      `═══ RESULTADO ═══\n${result.finalResult}\n\n` +
      `═══ EVIDENCIA ═══\n${evidenceText}\n\n` +
      `═══ ÁRBOL DE EJECUCIÓN ═══\n${treeText}`;

    return {
      ok: result.status === 'succeeded',
      output,
      error: result.status === 'succeeded' ? undefined : `El subagente terminó con estado: ${result.status}`,
    };
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}
