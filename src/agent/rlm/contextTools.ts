/**
 * RLM-1 — Tools de Context-as-Variable.
 *
 * Estas tools permiten al agente operar sobre el ContextStore:
 *   - ctx_set: guarda un fragmento bajo un key
 *   - ctx_get: recupera un fragmento por key
 *   - ctx_list: lista los keys disponibles (sin contenido)
 *   - ctx_delete: elimina un fragmento
 *   - ctx_clear: limpia todo
 *   - ctx_summarize: pide al LLM que resuma un fragmento grande
 *
 * Además, herramientas de "vista" que devuelven SÓLO fragmentos:
 *   - file_view_lines: lee N líneas específicas de un archivo (no todo)
 *   - file_view_structure: devuelve la estructura (headers, exports) sin contenido
 *   - file_view_symbols: lista funciones/clases/constantes de un archivo TS/JS
 *
 * La idea es que el agente NUNCA necesite tener todo un archivo en su
 * prompt. Siempre opera con fragmentos.
 */

import type { Tool } from '@/providers/types';
import { ContextStore } from './contextStore';
import { dispatchAdvancedTool } from '@/lib/tools';

export interface ToolExecResult {
  ok: boolean;
  output: string;
  error?: string;
}

/** Construye las tools de contexto (OpenAI-compatible). */
export function buildContextTools(): Tool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'ctx_set',
        description:
          'Guarda un fragmento de texto en el ContextStore bajo un key. Úsalo cuando necesites recordar información para pasos posteriores sin volver a leer la fuente. ' +
          'Ej: ctx_set("user file:42-58", "function foo() {...}", "file_view_lines"). ' +
          'El key debe ser descriptivo (no "data" o "tmp").',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Key descriptivo bajo el cual guardar el fragmento' },
            content: { type: 'string', description: 'Contenido del fragmento' },
            source: { type: 'string', description: 'Tool o acción que produjo el fragmento', default: 'manual' },
            metadata: { type: 'object', description: 'Metadata adicional (file, startLine, etc.)' },
          },
          required: ['key', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ctx_get',
        description:
          'Recupera un fragmento del ContextStore por su key. Devuelve el contenido. ' +
          'Úsalo cuando necesites información que ya guardaste, en vez de re-leer la fuente original.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Key del fragmento a recuperar' },
          },
          required: ['key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ctx_list',
        description:
          'Lista los fragmentos disponibles en el ContextStore (sólo keys y metadata, sin contenido). ' +
          'Úsalo al inicio de cada paso para ver qué información ya tienes disponible.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ctx_delete',
        description: 'Elimina un fragmento del ContextStore por su key.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Key del fragmento a eliminar' },
          },
          required: ['key'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'ctx_clear',
        description: 'Limpia todos los fragmentos del ContextStore. Úsalo cuando la información esté obsoleta.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_view_lines',
        description:
          'Lee N líneas específicas de un archivo (no todo). Devuelve SÓLO las líneas pedidas. ' +
          'Ej: file_view_lines("/path/file.ts", 42, 58) → devuelve líneas 42-58. ' +
          'Preferido sobre file_read cuando sólo necesitas una parte.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta absoluta o relativa al cwd' },
            startLine: { type: 'number', description: 'Línea inicial (1-indexed)' },
            endLine: { type: 'number', description: 'Línea final (inclusive)' },
          },
          required: ['path', 'startLine', 'endLine'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_view_structure',
        description:
          'Devuelve la estructura de un archivo (imports, exports, headers) sin el cuerpo de funciones. ' +
          'Útil para entender un archivo sin llenar el contexto de código.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta del archivo' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'file_view_symbols',
        description:
          'Lista funciones, clases y constantes exportadas de un archivo TS/JS. No devuelve el cuerpo. ' +
          'Útil para entender qué ofrece un módulo sin leer todo.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta del archivo .ts/.tsx/.js/.jsx' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'spawn_child_agent',
        description:
          'RLM-2: Spawnea un subagente hijo con su propia ventana de contexto limpia. ' +
          'El hijo recibe un objective específico y trabaja de forma aislada. ' +
          'Cuando termina, devuelve SÓLO el resultado (no su trace completo). ' +
          'Úsalo para delegar subtareas que requerirían mucho contexto si las hicieras tú mismo. ' +
          'Ej: spawn_child_agent("Resume los correos de la bandeja de entrada", "email-summarizer", {maxSteps: 6}).',
        parameters: {
          type: 'object',
          properties: {
            objective: { type: 'string', description: 'Objetivo específico del subagente hijo' },
            subagentName: { type: 'string', description: 'Nombre del subagente a invocar (del catálogo). Si se omite, se selecciona automáticamente por keyword match.' },
            context: { type: 'string', description: 'Contexto mínimo necesario (no todo el historial). Vacío por defecto.' },
            maxSteps: { type: 'number', description: 'Presupuesto de pasos. Default 8.' },
            maxTokens: { type: 'number', description: 'Presupuesto de tokens. Default 8000.' },
            maxTimeMs: { type: 'number', description: 'Timeout en ms. Default 90000.' },
          },
          required: ['objective'],
        },
      },
    },
  ];
}

/** Ejecuta una tool de contexto contra un ContextStore dado. */
export async function dispatchContextTool(
  name: string,
  args: Record<string, unknown>,
  store: ContextStore,
  spawnChildAgent?: (objective: string, subagentName: string | undefined, context: string, budget: { maxSteps: number; maxTokens: number; maxTimeMs: number }) => Promise<{ status: string; result: string; usage?: { inputTokens: number; outputTokens: number; steps: number; elapsedMs: number } }>,
): Promise<ToolExecResult> {
  try {
    switch (name) {
      case 'ctx_set': {
        const key = String(args.key ?? '');
        const content = String(args.content ?? '');
        const source = String(args.source ?? 'manual');
        const metadata = args.metadata as Record<string, unknown> | undefined;
        if (!key || !content) {
          return { ok: false, output: '', error: 'ctx_set requiere key y content' };
        }
        const fragment = store.set(key, content, source, metadata);
        return {
          ok: true,
          output: `Fragmento guardado: key="${key}" (${fragment.size} chars, id=${fragment.id})`,
        };
      }

      case 'ctx_get': {
        const key = String(args.key ?? '');
        const fragment = store.get(key);
        if (!fragment) {
          return { ok: false, output: '', error: `No hay fragmento con key "${key}"` };
        }
        return { ok: true, output: fragment.content };
      }

      case 'ctx_list': {
        const list = store.list();
        if (list.length === 0) {
          return { ok: true, output: '(ContextStore vacío)' };
        }
        const lines = list.map((f) =>
          `- "${f.key}" (${f.size} chars, source: ${f.source}${f.metadata ? ', meta: ' + JSON.stringify(f.metadata) : ''})`,
        );
        return {
          ok: true,
          output: `${list.length} fragmento(s), ${store.totalSize()} chars total:\n${lines.join('\n')}`,
        };
      }

      case 'ctx_delete': {
        const key = String(args.key ?? '');
        const deleted = store.delete(key);
        if (!deleted) {
          return { ok: false, output: '', error: `No hay fragmento con key "${key}"` };
        }
        return { ok: true, output: `Fragmento "${key}" eliminado.` };
      }

      case 'ctx_clear': {
        const count = store.count();
        store.clear();
        return { ok: true, output: `ContextStore limpiado (${count} fragmentos eliminados).` };
      }

      case 'file_view_lines': {
        const path = String(args.path ?? '');
        const startLine = Math.max(1, Number(args.startLine ?? 1));
        const endLine = Math.max(startLine, Number(args.endLine ?? startLine));
        if (!path) {
          return { ok: false, output: '', error: 'file_view_lines requiere path' };
        }
        // Usar file_read existente y extraer líneas.
        const result = await dispatchAdvancedTool('file_read', { path });
        if (!result.ok) {
          return { ok: false, output: '', error: result.error ?? 'Error leyendo archivo' };
        }
        const lines = result.output.split('\n');
        const sliced = lines.slice(startLine - 1, endLine);
        // Añadir números de línea para referencia.
        const numbered = sliced.map((line, i) => `${startLine + i}: ${line}`).join('\n');
        return {
          ok: true,
          output: `${path}:${startLine}-${endLine} (${sliced.length} líneas)\n${numbered}`,
        };
      }

      case 'file_view_structure': {
        const path = String(args.path ?? '');
        if (!path) {
          return { ok: false, output: '', error: 'file_view_structure requiere path' };
        }
        const result = await dispatchAdvancedTool('file_read', { path });
        if (!result.ok) {
          return { ok: false, output: '', error: result.error ?? 'Error leyendo archivo' };
        }
        const structure = extractStructure(result.output, path);
        return { ok: true, output: structure };
      }

      case 'file_view_symbols': {
        const path = String(args.path ?? '');
        if (!path) {
          return { ok: false, output: '', error: 'file_view_symbols requiere path' };
        }
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) {
          return { ok: false, output: '', error: 'file_view_symbols sólo soporta archivos .ts/.tsx/.js/.jsx' };
        }
        const result = await dispatchAdvancedTool('file_read', { path });
        if (!result.ok) {
          return { ok: false, output: '', error: result.error ?? 'Error leyendo archivo' };
        }
        const symbols = extractSymbols(result.output);
        return { ok: true, output: `${path}:\n${symbols}` };
      }

      case 'spawn_child_agent': {
        if (!spawnChildAgent) {
          return { ok: false, output: '', error: 'spawn_child_agent no disponible en este contexto.' };
        }
        const objective = String(args.objective ?? '');
        const subagentName = args.subagentName ? String(args.subagentName) : undefined;
        const context = String(args.context ?? '');
        const maxSteps = Number(args.maxSteps ?? 8);
        const maxTokens = Number(args.maxTokens ?? 8000);
        const maxTimeMs = Number(args.maxTimeMs ?? 90_000);
        if (!objective) {
          return { ok: false, output: '', error: 'spawn_child_agent requiere objective' };
        }
        const result = await spawnChildAgent(objective, subagentName, context, { maxSteps, maxTokens, maxTimeMs });
        return {
          ok: result.status === 'succeeded',
          output: JSON.stringify(result, null, 2),
          error: result.status === 'succeeded' ? undefined : `Subagente terminó con status: ${result.status}`,
        };
      }

      default:
        return { ok: false, output: '', error: `Tool de contexto desconocida: ${name}` };
    }
  } catch (e) {
    return { ok: false, output: '', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Extrae la estructura de un archivo (imports, exports, headers) sin cuerpos. */
function extractStructure(content: string, _path: string): string {
  const lines = content.split('\n');
  const structure: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Imports
    if (/^\s*(import|export|from|const|let|var|function|class|interface|type|enum)\s/.test(line)) {
      // Si es función o clase, sólo la firma (no el cuerpo).
      if (/^(export\s+)?(async\s+)?function\s+/.test(line) || /^(export\s+)?class\s+/.test(line)) {
        structure.push(`${i + 1}: ${line.trim()}`);
      } else {
        structure.push(`${i + 1}: ${line.trim()}`);
      }
    }
    // Comentarios de bloque al inicio
    if (/^\s*\/\*\*/.test(line) && structure.length < 5) {
      structure.push(`${i + 1}: ${line.trim()}`);
    }
  }

  return structure.length > 0
    ? `Estructura (${structure.length} elementos):\n${structure.join('\n')}`
    : '(no se detectó estructura)';
}

/** Extrae símbolos (funciones, clases, constantes exportadas) de un archivo TS/JS. */
function extractSymbols(content: string): string {
  const symbols: string[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // export function foo(...)
    let m = line.match(/^export\s+(async\s+)?function\s+(\w+)/);
    if (m) {
      symbols.push(`function ${m[2]}${m[1] ? ' (async)' : ''} (line ${i + 1})`);
      continue;
    }

    // export class Foo
    m = line.match(/^export\s+class\s+(\w+)/);
    if (m) {
      symbols.push(`class ${m[1]} (line ${i + 1})`);
      continue;
    }

    // export const foo = ...
    m = line.match(/^export\s+const\s+(\w+)/);
    if (m) {
      symbols.push(`const ${m[1]} (line ${i + 1})`);
      continue;
    }

    // export interface Foo
    m = line.match(/^export\s+interface\s+(\w+)/);
    if (m) {
      symbols.push(`interface ${m[1]} (line ${i + 1})`);
      continue;
    }

    // export type Foo
    m = line.match(/^export\s+type\s+(\w+)/);
    if (m) {
      symbols.push(`type ${m[1]} (line ${i + 1})`);
      continue;
    }

    // function foo(...) — sin export
    m = line.match(/^(async\s+)?function\s+(\w+)/);
    if (m) {
      symbols.push(`function ${m[2]}${m[1] ? ' (async)' : ''} (line ${i + 1}, no exportado)`);
      continue;
    }

    // const foo = (...) =>
    m = line.match(/^const\s+(\w+)\s*=\s*(async\s*)?\([^)]*\)\s*=>/);
    if (m) {
      symbols.push(`const ${m[1]} (arrow function, line ${i + 1})`);
      continue;
    }
  }

  return symbols.length > 0
    ? symbols.join('\n')
    : '(no se detectaron símbolos)';
}
