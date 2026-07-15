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
];

/** Lista de tools para exponer al LLM (formato OpenAI function calling). */
export function buildAdvancedToolsList() {
  return ADVANCED_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.parameters,
        required: Object.keys(t.parameters).filter(
          (k) => k !== 'cwd' && k !== 'timeout' && k !== 'max_results' && k !== 'create_dirs' && k !== 'max_chars' && k !== 'mime_type',
        ),
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
