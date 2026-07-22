/**
 * Parser para tool calls emitidos como TEXTO por modelos que no soportan
 * function calling nativo o que están configurados para emitirlos como texto.
 *
 * Problema real (bug reportado):
 *   Usuario: "Busca en internet las últimas noticias de IA y haz un resumen"
 *   Agente: <function(web_search){"query": "noticias de ia ultimo",
 *           "max_results": "5"}</function>
 *
 *   El LLM emite el tool call como TEXTO en vez de usar el mecanismo nativo
 *   de function calling. Sin este parser, el loop runChatWithTools piensa
 *   que no hubo tool calls (result.toolCalls.length === 0) y rompe sin
 *   ejecutar la herramienta, dejando al usuario con el texto crudo del
 *   tool call (o peor: con respuesta vacía si ReactMarkdown strippa los
 *   tags HTML-like).
 *
 * Formatos soportados:
 *   1. Mistral / Mistral-Nemo:
 *        <function(name){args}</function>
 *      Ej: <function(web_search){"query": "ia", "max_results": 5}</function>
 *
 *   2. Mistral official (v7+):
 *        [TOOL_CALLS: [{"name": "...", "arguments": {...}}]]
 *
 *   3. Hermes 2 Pro / Nous Research:
 *        <tool_call>{"name": "...", "arguments": {...}}</tool_call>
 *
 *   4. Llama 3.1+ / Qwen (sin closing tag):
 *        <|tool_call|>{"name": "...", "arguments": {...}}
 *
 *   5. Generic XML fallback:
 *        <function name="...">{args}</function>
 *        <function_call name="...">{args}</function_call>
 *
 * El parser:
 *   - Extrae todos los tool calls encontrados en el texto.
 *   - Devuelve el texto "limpio" (sin las marcas de tool call) para que el
 *     UI no muestre basura al usuario.
 *   - Si un tool call tiene JSON malformado, lo deja como texto (no rompe).
 */

import type { ToolCall } from '@/providers/types';

export interface ParsedTextToolCalls {
  toolCalls: ToolCall[];
  /** Texto sin las marcas de tool call (puede ser string vacío). */
  cleanedText: string;
  /** True si se detectó al menos un tool call en el texto. */
  found: boolean;
}

let _callCounter = 0;

function nextCallId(): string {
  _callCounter += 1;
  return `textcall_${Date.now()}_${_callCounter}`;
}

/**
 * Normaliza los argumentos a string JSON (como lo espera el dispatcher).
 * Acepta string (lo deja igual) o objeto (lo serializa).
 */
function normalizeArgs(args: unknown): string {
  if (typeof args === 'string') return args;
  if (args && typeof args === 'object') return JSON.stringify(args);
  return '{}';
}

/**
 * Extrae un JSON balanceado empezando en `startPos` (donde text[startPos]
 * debe ser `{`). Recorre el string respetando strings, escapes y anidamiento
 * de braces. Devuelve el JSON completo + la posición siguiente al cierre.
 *
 * Esto es necesario porque una regex `\\{[\\s\\S]*?\\}` matchea el primer
 * `}` (no el balanceado), fallando para args con objetos anidados como
 *   {"name":"x","arguments":{"a":1}}   ← la regex cortaría en "1}"
 */
function extractBalancedJson(
  text: string,
  startPos: number,
): { json: string; endPos: number } | null {
  if (text[startPos] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startPos; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return { json: text.slice(startPos, i + 1), endPos: i + 1 };
      }
    }
  }
  return null; //nunca cerró — JSON incompleto
}

/**
 * Extrae tool calls de un texto emitido por el LLM.
 * Devuelve los tool calls encontrados + el texto limpio.
 */
export function parseTextToolCalls(text: string): ParsedTextToolCalls {
  if (!text || typeof text !== 'string') {
    return { toolCalls: [], cleanedText: text ?? '', found: false };
  }

  const toolCalls: ToolCall[] = [];
  // Marcamos los rangos del texto que deben eliminarse (las marcas del tool
  // call). Trabajamos con índices en lugar de regex+replace para poder usar
  // extractBalancedJson y no romper con JSON anidado.
  const rangesToRemove: Array<[number, number]> = [];

  // ----------------------------------------------------------------------
  // 1. Mistral / Mistral-Nemo: <function(name){args}</function>
  //    El nombre va DENTRO del paréntesis del tag de apertura.
  //    Ej: <function(web_search){"query": "ia"}</function>
  // ----------------------------------------------------------------------
  const mistralOpenRe = /<function\(([\w.-]+)\)>?/g;
  let m: RegExpExecArray | null;
  while ((m = mistralOpenRe.exec(text)) !== null) {
    const name = m[1];
    const openTagEnd = m.index + m[0].length;
    // Saltar espacios tras el tag de apertura.
    let pos = openTagEnd;
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (text[pos] !== '{') continue; // no hay JSON → no es tool call válido
    const extracted = extractBalancedJson(text, pos);
    if (!extracted) continue;
    try {
      const args = JSON.parse(extracted.json);
      toolCalls.push({
        id: nextCallId(),
        type: 'function',
        function: { name, arguments: normalizeArgs(args) },
      });
      // Buscar el closing tag </function> tras el JSON.
      let closeIdx = extracted.endPos;
      const closeMatch = text.slice(closeIdx).match(/^\s*<\/function>/);
      if (closeMatch) closeIdx += closeMatch[0].length;
      rangesToRemove.push([m.index, closeIdx]);
    } catch {
      // JSON malformado: lo dejamos como texto.
    }
  }

  // ----------------------------------------------------------------------
  // 2. Generic XML fallback: <function name="...">{args}</function>
  //                     y   <function_call name="...">{args}</function_call>
  // ----------------------------------------------------------------------
  const xmlOpenRe = /<(function|function_call)\s+name=["']([\w.-]+)["']\s*>/g;
  while ((m = xmlOpenRe.exec(text)) !== null) {
    const name = m[2];
    const openTagEnd = m.index + m[0].length;
    let pos = openTagEnd;
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (text[pos] !== '{') continue;
    const extracted = extractBalancedJson(text, pos);
    if (!extracted) continue;
    try {
      const args = JSON.parse(extracted.json);
      toolCalls.push({
        id: nextCallId(),
        type: 'function',
        function: { name, arguments: normalizeArgs(args) },
      });
      const closeTagRe = new RegExp(`</${m[1]}>`);
      let closeIdx = extracted.endPos;
      const closeMatch = text.slice(closeIdx).match(/^\s*<\/(?:function|function_call)>/);
      if (closeMatch) closeIdx += closeMatch[0].length;
      rangesToRemove.push([m.index, closeIdx]);
      closeTagRe.lastIndex = 0; // unused, evita warning
    } catch {
      // ignore
    }
  }

  // ----------------------------------------------------------------------
  // 3. Mistral official (v7+): [TOOL_CALLS: [{name, arguments}, ...]]
  //    El array puede contener varios tool calls. Soportamos JSON anidado
  //    usando extractBalancedJson a partir del `[` tras `TOOL_CALLS:`.
  // ----------------------------------------------------------------------
  const mistralOfficialRe = /\[TOOL_CALLS:\s*\[/g;
  while ((m = mistralOfficialRe.exec(text)) !== null) {
    let pos = m.index + m[0].length;
    // Extraer el array completo buscando el `]` balanceado.
    // (extractBalancedJson espera `{`, así que lo hacemos a mano para `]`.)
    let depth = 1;
    let i = pos;
    let inStr = false;
    let esc = false;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (esc) esc = false;
      else if (inStr) {
        if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '[') depth++;
      else if (ch === ']') depth--;
      i++;
    }
    if (depth !== 0) continue;
    const arrStr = '[' + text.slice(pos, i - 1) + ']';
    // Buscar el `]` que cierra `[TOOL_CALLS: [...]]` (uno más)
    let closeEnd = i;
    if (text[closeEnd] === ']') closeEnd++;
    try {
      const arr = JSON.parse(arrStr) as Array<{
        name?: string;
        arguments?: unknown;
      }>;
      let parsed = 0;
      for (const tc of arr) {
        if (tc.name) {
          toolCalls.push({
            id: nextCallId(),
            type: 'function',
            function: { name: tc.name, arguments: normalizeArgs(tc.arguments) },
          });
          parsed += 1;
        }
      }
      if (parsed > 0) rangesToRemove.push([m.index, closeEnd]);
    } catch {
      // ignore
    }
  }

  // ----------------------------------------------------------------------
  // 4. Hermes 2 Pro / Nous Research:
  //    <tool_call>{"name": "...", "arguments": {...}}</tool_call>
  //    Y variante sin closing tag (modelos que se cortan):
  //    <tool_call>{"name": "...", "arguments": {...}}
  // ----------------------------------------------------------------------
  const hermesOpenRe = /<tool_call>/g;
  while ((m = hermesOpenRe.exec(text)) !== null) {
    let pos = m.index + m[0].length;
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (text[pos] !== '{') continue;
    const extracted = extractBalancedJson(text, pos);
    if (!extracted) continue;
    try {
      const obj = JSON.parse(extracted.json) as {
        name?: string;
        arguments?: unknown;
      };
      if (!obj.name) continue;
      toolCalls.push({
        id: nextCallId(),
        type: 'function',
        function: { name: obj.name, arguments: normalizeArgs(obj.arguments) },
      });
      let closeIdx = extracted.endPos;
      const closeMatch = text.slice(closeIdx).match(/^\s*<\/tool_call>/);
      if (closeMatch) closeIdx += closeMatch[0].length;
      rangesToRemove.push([m.index, closeIdx]);
    } catch {
      // ignore
    }
  }

  // ----------------------------------------------------------------------
  // 5. Llama 3.1+ / Qwen: <|tool_call|>{name, arguments}
  //    No tiene closing tag — el JSON va inmediatamente después del marcador.
  // ----------------------------------------------------------------------
  const llamaRe = /<\|tool_call\|>/g;
  while ((m = llamaRe.exec(text)) !== null) {
    let pos = m.index + m[0].length;
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (text[pos] !== '{') continue;
    const extracted = extractBalancedJson(text, pos);
    if (!extracted) continue;
    try {
      const obj = JSON.parse(extracted.json) as {
        name?: string;
        arguments?: unknown;
      };
      if (!obj.name) continue;
      toolCalls.push({
        id: nextCallId(),
        type: 'function',
        function: { name: obj.name, arguments: normalizeArgs(obj.arguments) },
      });
      rangesToRemove.push([m.index, extracted.endPos]);
    } catch {
      // ignore
    }
  }

  // ----------------------------------------------------------------------
  // Construir cleanedText removiendo los rangos marcados.
  // ----------------------------------------------------------------------
  rangesToRemove.sort((a, b) => a[0] - b[0]);
  let cleaned = '';
  let cursor = 0;
  for (const [start, end] of rangesToRemove) {
    if (start < cursor) continue; // overlap, skip
    cleaned += text.slice(cursor, start);
    cursor = end;
  }
  cleaned += text.slice(cursor);

  // Limpieza final: colapsar espacios extra y saltos de línea múltiples.
  cleaned = cleaned
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  return {
    toolCalls,
    cleanedText: cleaned,
    found: toolCalls.length > 0,
  };
}

/**
 * Verifica rápidamente si un texto POSIBLEMENTE contiene un tool call en
 * formato texto. Es más rápido que parseTextToolCalls y se usa para decidir
 * si vale la pena hacer el parseo completo (que es regex-heavy).
 *
 * Falso positivos aceptables: prefieres falsos positivos (luego el parser
 * completo no encuentra nada y no pasa nada) que falsos negativos.
 */
export function maybeHasTextToolCall(text: string): boolean {
  if (!text) return false;
  return (
    text.includes('<function(') ||
    text.includes('<function ') ||
    text.includes('<function_call') ||
    text.includes('[TOOL_CALLS:') ||
    text.includes('<tool_call>') ||
    text.includes('<|tool_call|>')
  );
}
