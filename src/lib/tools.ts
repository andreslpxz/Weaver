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

import { runtime, keyring } from './tauri';
import { invoke } from '@tauri-apps/api/core';

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
          (k) => k !== 'cwd' && k !== 'timeout' && k !== 'max_results' && k !== 'create_dirs' && k !== 'max_chars',
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

async function shellExec(command: string, cwd?: string, timeout = 30000): Promise<ToolExecResult> {
  if (runtime.isBrowser) {
    return {
      ok: false,
      output: '',
      error: 'shell_exec solo está disponible en modo Tauri. Ejecuta con `npm run tauri:dev`.',
    };
  }
  try {
    const result = await invoke<{ stdout: string; stderr: string; code: number }>('tools_shell_exec', {
      args: { command, cwd, timeout },
    });
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
    const content = await invoke<string>('tools_file_read', { args: { path } });
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
    await invoke<void>('tools_file_write', { args: { path, content, create_dirs: createDirs } });
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
    const entries = await invoke<Array<{ name: string; is_dir: boolean; size: number }>>('tools_file_list', {
      args: { path },
    });
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

async function webFetch(url: string, maxChars: number): Promise<ToolExecResult> {
  try {
    // En navegador, evitar CORS usando un proxy público como fallback.
    const target = runtime.isBrowser
      ? `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
      : url;
    const resp = await fetch(target);
    if (!resp.ok) {
      return { ok: false, output: '', error: `HTTP ${resp.status}` };
    }
    const text = await resp.text();
    // Strip HTML básico si la respuesta es HTML.
    let clean = text;
    if (resp.headers.get('content-type')?.includes('text/html')) {
      clean = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    return { ok: true, output: clean.slice(0, maxChars) };
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}
