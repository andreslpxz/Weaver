/**
 * Modo Cognitivo — Motor del Grafo del Proyecto (graphify).
 *
 * Cuando se activa, Weaver escanea un directorio raíz (típicamente el del
 * proyecto activo o `cwd`), extrae símbolos (funciones, clases, interfaces,
 * métodos, variables, tipos, archivos, carpetas) y construye un grafo de
 * dependencias basado en los imports de cada archivo.
 *
 * El grafo se persiste en localStorage (`weaver:cognitive-graph`) y se
 * expone al LLM a través de las tools `cognitive_query` y `cognitive_graphify`.
 *
 * El agente, en modo cognitivo, consulta el grafo antes de actuar:
 *   1. Intuición — busca nodos relacionados con el pedido del usuario y
 *      detecta restricciones previas (Performance_Budget, etc.).
 *   2. Lógica — traza los pasos como una cadena de nodos A → B → C y
 *      verifica si algún nodo prohíbe la lógica.
 *   3. Juicio — emite una propuesta con justificación y pide confirmación.
 *
 * El formato del grafo está inspirado en graph.json / LSIF:
 *   {
 *     nodes: [{ id, kind, name, file, line }],
 *     edges: [{ from, to, kind: 'imports' | 'contains' | 'affects' | 'depends_on' }]
 *   }
 */

import { runtime, sqlite } from './tauri';

// --- Tipos ----------------------------------------------------------------

export type NodeKind =
  | 'file'
  | 'folder'
  | 'module'
  | 'function'
  | 'class'
  | 'interface'
  | 'method'
  | 'variable'
  | 'type'
  | 'import';

export interface CognitiveNode {
  id: string;
  kind: NodeKind;
  name: string;
  file: string;
  line: number;
}

export type EdgeKind =
  | 'imports'      // A importa a B
  | 'contains'     // A contiene a B (folder→file, file→function, class→method)
  | 'affects'      // A afecta a B (relación semántica inferida, ej: performance)
  | 'depends_on';  // A depende de B (relación lógica/estructural)

export interface CognitiveEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface CognitiveGraph {
  rootPath: string;
  nodes: CognitiveNode[];
  edges: CognitiveEdge[];
  stats: {
    files: number;
    folders: number;
    functions: number;
    classes: number;
    interfaces: number;
    methods: number;
    variables: number;
    types: number;
    imports: number;
    edges: number;
    modules: number;
  };
  builtAt: number;
}

// --- Persistencia ---------------------------------------------------------

const GRAPH_KEY = 'weaver:cognitive-graph';

export function loadGraph(): CognitiveGraph | null {
  try {
    const raw = localStorage.getItem(GRAPH_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CognitiveGraph;
  } catch {
    return null;
  }
}

export function saveGraph(g: CognitiveGraph) {
  try {
    localStorage.setItem(GRAPH_KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

export function clearGraph() {
  try {
    localStorage.removeItem(GRAPH_KEY);
  } catch {
    /* ignore */
  }
}

// --- Extracción de símbolos ----------------------------------------------

const SUPPORTED_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'cc',
  'cs', 'rb', 'php', 'kt', 'swift', 'scala',
  'vue', 'svelte', 'astro',
]);

interface ExtractedSymbol {
  kind: NodeKind;
  name: string;
  line: number;
}

interface ExtractedImport {
  /** Path o módulo importado, tal cual aparece en el código. */
  target: string;
  line: number;
}

interface FileSymbols {
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
}

/**
 * Extrae símbolos y imports de un archivo usando regex.
 * No es un parser completo, pero cubre los patrones más comunes en
 * TypeScript/JavaScript/Python/Rust/Go/Java/C/C++.
 */
function extractSymbols(content: string, _ext: string): FileSymbols {
  const symbols: ExtractedSymbol[] = [];
  const imports: ExtractedImport[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- imports / requires ---
    // TS/JS: import X from 'Y'  |  import { X } from 'Y'  |  import 'Y'
    let m = line.match(/^\s*import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/);
    if (m) {
      imports.push({ target: m[1], line: i + 1 });
      continue;
    }
    // TS/JS: const X = require('Y')
    m = line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m) {
      imports.push({ target: m[1], line: i + 1 });
      continue;
    }
    // Python: import Y  |  from Y import X
    m = line.match(/^\s*(?:from\s+([\w.]+)\s+)?import\s+([\w.]+(?:\s+as\s+\w+)?)/);
    if (m && (m[1] || m[2])) {
      imports.push({ target: m[1] ?? m[2], line: i + 1 });
      continue;
    }
    // Rust: use Y::Z;
    m = line.match(/^\s*use\s+([\w:]+)/);
    if (m) {
      imports.push({ target: m[1].replace(/::/g, '/'), line: i + 1 });
      continue;
    }
    // Go: import "Y"  |  import alias "Y"
    m = line.match(/^\s*import\s+(?:[\w_]+\s+)?["']([^"']+)["']/);
    if (m) {
      imports.push({ target: m[1], line: i + 1 });
      continue;
    }
    // Java/C/C++: #include "Y.h"  |  import Y.Z;
    m = line.match(/^\s*#include\s+[<"]([^>"]+)[>"]/);
    if (m) {
      imports.push({ target: m[1], line: i + 1 });
      continue;
    }
    m = line.match(/^\s*import\s+([\w.]+);/);
    if (m) {
      imports.push({ target: m[1].replace(/\./g, '/'), line: i + 1 });
      continue;
    }

    // --- function / def / fn / func ---
    m = line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (m) {
      symbols.push({ kind: 'function', name: m[1], line: i + 1 });
      continue;
    }
    m = line.match(/^\s*def\s+(\w+)/); // python
    if (m) {
      symbols.push({ kind: 'function', name: m[1], line: i + 1 });
      continue;
    }
    m = line.match(/^\s*(?:pub\s+)?fn\s+(\w+)/); // rust
    if (m) {
      symbols.push({ kind: 'function', name: m[1], line: i + 1 });
      continue;
    }
    m = line.match(/^\s*func\s+(?:\([^)]*\)\s+)?(\w+)/); // go
    if (m) {
      symbols.push({ kind: 'function', name: m[1], line: i + 1 });
      continue;
    }

    // --- class / struct / interface / type ---
    m = line.match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (m) {
      symbols.push({ kind: 'class', name: m[1], line: i + 1 });
      continue;
    }
    m = line.match(/^\s*(?:pub\s+)?struct\s+(\w+)/); // rust
    if (m) {
      symbols.push({ kind: 'class', name: m[1], line: i + 1 });
      continue;
    }
    m = line.match(/^\s*(?:export\s+)?interface\s+(\w+)/);
    if (m) {
      symbols.push({ kind: 'interface', name: m[1], line: i + 1 });
      continue;
    }
    m = line.match(/^\s*(?:export\s+)?type\s+(\w+)\s*[=<{]/);
    if (m) {
      symbols.push({ kind: 'type', name: m[1], line: i + 1 });
      continue;
    }

    // --- method (dentro de class) — patrón simple ---
    m = line.match(/^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(?:\w+(?:<[^>]+>)?\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\S+)?\s*[{;]/);
    if (m && !['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'class'].includes(m[1])) {
      // Heurística: si la línea empieza con espacios y parece un método
      symbols.push({ kind: 'method', name: m[1], line: i + 1 });
      continue;
    }

    // --- variable (const / let / var) — sólo topLevel ---
    m = line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/);
    if (m) {
      symbols.push({ kind: 'variable', name: m[1], line: i + 1 });
      continue;
    }
  }

  return { symbols, imports };
}

// --- Graphify: construir el grafo ----------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out',
  'target', '__pycache__', '.venv', 'venv', '.cache', '.idea', '.vscode',
  'coverage', '.turbo', '.parcel-cache', 'vendor',
]);

const MAX_FILES = 5000;
const MAX_FILE_SIZE = 256 * 1024; // 256 KB — archivos más grandes se ignoran

interface WalkResult {
  files: Array<{ path: string; ext: string }>;
  folders: string[];
}

async function walkDir(root: string, maxDepth = 12): Promise<WalkResult> {
  const files: Array<{ path: string; ext: string }> = [];
  const folders: string[] = [];

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || files.length > MAX_FILES) return;
    let entries: Array<{ name: string; is_dir: boolean; size: number }>;
    try {
      entries = await sqlite.fileList(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.') continue;
      const full = `${dir}/${e.name}`;
      if (e.is_dir) {
        if (SKIP_DIRS.has(e.name)) continue;
        folders.push(full);
        await walk(full, depth + 1);
      } else {
        const dot = e.name.lastIndexOf('.');
        const ext = dot > 0 ? e.name.slice(dot + 1).toLowerCase() : '';
        if (SUPPORTED_EXTS.has(ext) && e.size <= MAX_FILE_SIZE) {
          files.push({ path: full, ext });
        }
      }
    }
  }

  await walk(root, 0);
  return { files, folders };
}

/** Convierte un target de import (relativo o paquete) en un path de archivo candidato. */
function resolveImportTarget(importTarget: string, fromFile: string): string | null {
  // Sólo resolver imports relativos (./  ../). Los bare imports ('react', 'fs')
  // se marcan como módulos externos sin resolver a archivo concreto.
  if (!importTarget.startsWith('.') && !importTarget.startsWith('..')) {
    return null;
  }
  const dir = fromFile.slice(0, fromFile.lastIndexOf('/'));
  const parts = importTarget.split('/');
  const stack = dir.split('/').filter(Boolean);
  for (const p of parts) {
    if (p === '.') continue;
    if (p === '..') {
      stack.pop();
      continue;
    }
    stack.push(p);
  }
  let resolved = '/' + stack.join('/');
  // Probar extensiones si el path no existe tal cual.
  return resolved;
}

/**
 * Escanea `rootPath`, extrae símbolos e imports de cada archivo y construye
 * el grafo cognitivo. Devuelve el grafo completo con stats.
 *
 * Requiere modo Tauri (fileList + fileRead).
 */
export async function graphify(rootPath: string): Promise<CognitiveGraph> {
  if (!runtime.isTauri) {
    throw new Error('Modo Cognitivo requiere Tauri (acceso al filesystem).');
  }

  const root = rootPath.replace(/\/+$/, '');
  const { files, folders } = await walkDir(root);

  const nodes: CognitiveNode[] = [];
  const edges: CognitiveEdge[] = [];

  // 1) Carpeta raíz y subcarpetas como nodos.
  nodes.push({ id: root, kind: 'folder', name: root.split('/').pop() ?? root, file: root, line: 0 });
  for (const f of folders) {
    nodes.push({ id: f, kind: 'folder', name: f.split('/').pop() ?? f, file: f, line: 0 });
    // edge: parent folder contains subfolder
    const parent = f.slice(0, f.lastIndexOf('/'));
    if (parent) edges.push({ from: parent, to: f, kind: 'contains' });
  }

  // 2) Archivos y sus símbolos.
  const fileToId = new Map<string, string>();
  for (const f of files) {
    const fileId = f.path;
    fileToId.set(f.path, fileId);
    nodes.push({ id: fileId, kind: 'file', name: f.path.split('/').pop() ?? f.path, file: f.path, line: 0 });
    const parent = f.path.slice(0, f.path.lastIndexOf('/'));
    if (parent) edges.push({ from: parent, to: fileId, kind: 'contains' });

    // Leer contenido y extraer símbolos.
    let content: string;
    try {
      content = await sqlite.fileRead(f.path);
    } catch {
      continue;
    }
    if (!content) continue;
    const { symbols, imports } = extractSymbols(content, f.ext);

    for (const sym of symbols) {
      const symId = `${f.path}#${sym.kind}:${sym.name}@${sym.line}`;
      nodes.push({ id: symId, kind: sym.kind, name: sym.name, file: f.path, line: sym.line });
      edges.push({ from: fileId, to: symId, kind: 'contains' });
    }

    // Módulo (archivo como módulo): si el archivo es index.ts o tiene exports
    // lo marcamos como módulo. Heurística simple: si tiene >0 exports o se llama
    // index/main/mod/lib.
    const baseName = f.path.split('/').pop() ?? '';
    if (/^(index|main|mod|lib|app)\./.test(baseName) || /export\s+/.test(content)) {
      const modId = `${f.path}#module`;
      nodes.push({ id: modId, kind: 'module', name: baseName.replace(/\.\w+$/, ''), file: f.path, line: 0 });
      edges.push({ from: fileId, to: modId, kind: 'contains' });
    }

    // Edges de imports.
    for (const imp of imports) {
      const target = resolveImportTarget(imp.target, f.path);
      if (!target) continue;
      // Buscar archivo real que coincida con target (con extensión).
      const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}.js`, `${target}.jsx`, `${target}.py`, `${target}.rs`, `${target}.go`, `${target}/index.ts`, `${target}/index.js`];
      for (const c of candidates) {
        if (fileToId.has(c)) {
          edges.push({ from: f.path, to: c, kind: 'imports' });
          break;
        }
        // También comparar sin normalización de barras.
        const norm = c.startsWith('/') ? c : '/' + c;
        if (fileToId.has(norm)) {
          edges.push({ from: f.path, to: norm, kind: 'imports' });
          break;
        }
      }
    }
  }

  // 3) Stats.
  const stats = {
    files: nodes.filter((n) => n.kind === 'file').length,
    folders: nodes.filter((n) => n.kind === 'folder').length,
    functions: nodes.filter((n) => n.kind === 'function').length,
    classes: nodes.filter((n) => n.kind === 'class').length,
    interfaces: nodes.filter((n) => n.kind === 'interface').length,
    methods: nodes.filter((n) => n.kind === 'method').length,
    variables: nodes.filter((n) => n.kind === 'variable').length,
    types: nodes.filter((n) => n.kind === 'type').length,
    imports: edges.filter((e) => e.kind === 'imports').length,
    edges: edges.length,
    modules: nodes.filter((n) => n.kind === 'module').length,
  };

  const graph: CognitiveGraph = {
    rootPath: root,
    nodes,
    edges,
    stats,
    builtAt: Date.now(),
  };
  saveGraph(graph);
  return graph;
}

// --- Consultas al grafo ---------------------------------------------------

export interface QueryResult {
  summary: string;
  nodes: Array<{ id: string; kind: NodeKind; name: string; file: string; line: number }>;
  edges: Array<{ from: string; fromName: string; to: string; toName: string; kind: EdgeKind }>;
}

/**
 * Consulta el grafo cognitivo. Soporta:
 *   - search: buscar nodos por nombre (substring, case-insensitive).
 *   - byKind: listar nodos de un kind concreto.
 *   - neighbors: dado un nodeId, devolver todos los nodos conectados (imports + contains + affects + depends_on).
 *   - stats: devolver las stats globales del grafo.
 *   - path: BFS más corto entre dos nodos por nombre.
 */
export function queryGraph(graph: CognitiveGraph, opts: {
  search?: string;
  byKind?: NodeKind;
  neighbors?: string;
  path?: { from: string; to: string };
  stats?: boolean;
  limit?: number;
}): QueryResult {
  const limit = opts.limit ?? 50;
  let nodes: CognitiveNode[] = [];

  if (opts.stats) {
    return {
      summary: `Grafo del proyecto: ${graph.stats.files} archivos, ${graph.stats.folders} carpetas, ${graph.stats.functions} funciones, ${graph.stats.classes} clases, ${graph.stats.interfaces} interfaces, ${graph.stats.methods} métodos, ${graph.stats.variables} variables, ${graph.stats.types} tipos, ${graph.stats.modules} módulos, ${graph.stats.imports} imports, ${graph.stats.edges} aristas totales. Raíz: ${graph.rootPath}. Construido: ${new Date(graph.builtAt).toLocaleString()}.`,
      nodes: [],
      edges: [],
    };
  }

  if (opts.search) {
    const q = opts.search.toLowerCase();
    nodes = graph.nodes.filter((n) => n.name.toLowerCase().includes(q)).slice(0, limit);
  } else if (opts.byKind) {
    nodes = graph.nodes.filter((n) => n.kind === opts.byKind).slice(0, limit);
  } else if (opts.neighbors) {
    const id = opts.neighbors;
    const neighborIds = new Set<string>();
    for (const e of graph.edges) {
      if (e.from === id) neighborIds.add(e.to);
      if (e.to === id) neighborIds.add(e.from);
    }
    nodes = graph.nodes.filter((n) => neighborIds.has(n.id)).slice(0, limit);
  } else if (opts.path) {
    const from = graph.nodes.find((n) => n.name.toLowerCase().includes(opts.path!.from.toLowerCase()));
    const to = graph.nodes.find((n) => n.name.toLowerCase().includes(opts.path!.to.toLowerCase()));
    if (!from || !to) {
      return {
        summary: `No se encontraron nodos para '${opts.path.from}' o '${opts.path.to}'.`,
        nodes: [],
        edges: [],
      };
    }
    // BFS
    const visited = new Set<string>([from.id]);
    const queue: Array<{ id: string; path: string[] }> = [{ id: from.id, path: [from.id] }];
    let foundPath: string[] | null = null;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur.id === to.id) {
        foundPath = cur.path;
        break;
      }
      for (const e of graph.edges) {
        if (e.from === cur.id && !visited.has(e.to)) {
          visited.add(e.to);
          queue.push({ id: e.to, path: [...cur.path, e.to] });
        }
        if (e.to === cur.id && !visited.has(e.from)) {
          visited.add(e.from);
          queue.push({ id: e.from, path: [...cur.path, e.from] });
        }
      }
    }
    if (!foundPath) {
      return {
        summary: `No hay camino entre '${from.name}' y '${to.name}' en el grafo.`,
        nodes: [],
        edges: [],
      };
    }
    nodes = foundPath
      .map((id) => graph.nodes.find((n) => n.id === id))
      .filter((n): n is CognitiveNode => n !== undefined);
    const pathEdges = [];
    for (let i = 0; i < foundPath.length - 1; i++) {
      const e = graph.edges.find((ed) => (ed.from === foundPath[i] && ed.to === foundPath[i + 1]) || (ed.to === foundPath[i] && ed.from === foundPath[i + 1]));
      if (e) pathEdges.push(e);
    }
    const nodeName = (id: string) => graph.nodes.find((n) => n.id === id)?.name ?? id;
    return {
      summary: `Camino encontrado (${foundPath.length} nodos): ${foundPath.map((id) => nodeName(id)).join(' → ')}`,
      nodes,
      edges: pathEdges.map((e) => ({ from: e.from, fromName: nodeName(e.from), to: e.to, toName: nodeName(e.to), kind: e.kind })),
    };
  }

  // Construir edges relevantes a los nodos devueltos.
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = graph.edges
    .filter((e) => nodeIds.has(e.from) || nodeIds.has(e.to))
    .slice(0, limit * 2)
    .map((e) => ({
      from: e.from,
      fromName: graph.nodes.find((n) => n.id === e.from)?.name ?? e.from,
      to: e.to,
      toName: graph.nodes.find((n) => n.id === e.to)?.name ?? e.to,
      kind: e.kind,
    }));

  const summary = `${nodes.length} nodo(s) encontrado(s).`;
  return { summary, nodes, edges };
}
