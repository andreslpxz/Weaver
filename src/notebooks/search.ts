/**
 * Herramientas de búsqueda para el chat de Notebooks.
 *
 * - quick_search: una sola llamada a web_search (Tavily), rápida y barata.
 * - deep_research: varias queries relacionadas + web_fetch de las mejores
 *   URLs encontradas, para sintetizar un contexto más profundo antes de
 *   responder. Es deliberadamente más lenta.
 *
 * Ambas reusan `dispatchAdvancedTool` ya existente en Weaver (mismo Tavily
 * key configurada en Configuración > Búsqueda web), no duplican lógica de
 * red ni de credenciales.
 */

import { dispatchAdvancedTool } from '@/lib/tools';
import type { NotebookToolMode } from './types';

export interface SearchRunResult {
  /** Texto ya formateado, listo para inyectar como contexto adicional en el prompt. */
  contextText: string;
  /** Trace legible para mostrar en la UI ("Buscando: ...", "Leyendo: ..."). */
  trace: string[];
  ok: boolean;
  error?: string;
}

export interface SourceSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface SourceSearchRun {
  results: SourceSearchResultItem[];
  trace: string[];
  ok: boolean;
  error?: string;
}

export async function runQuickSearch(query: string): Promise<SearchRunResult> {
  const trace = [`Búsqueda rápida: "${query}"`];
  const res = await dispatchAdvancedTool('web_search', { query, max_results: 5 });
  if (!res.ok) {
    return { contextText: '', trace, ok: false, error: res.error };
  }
  return {
    contextText: `Resultados de búsqueda web para "${query}":\n\n${res.output}`,
    trace,
    ok: true,
  };
}

/**
 * Búsqueda profunda: genera variantes de la consulta original (sin usar el
 * modelo, con heurísticas simples de reformulación) para cubrir más ángulos,
 * agrega los resultados, y luego hace web_fetch del top de URLs distintas
 * para obtener contenido completo en vez de solo snippets.
 */
export async function runDeepResearch(query: string): Promise<SearchRunResult> {
  const trace: string[] = [];
  const queries = buildQueryVariants(query);

  const allResults: Array<{ title: string; url: string; snippet: string }> = [];
  for (const q of queries) {
    trace.push(`Buscando: "${q}"`);
    const res = await dispatchAdvancedTool('web_search', { query: q, max_results: 5 });
    if (res.ok) {
      allResults.push(...parseSearchOutput(res.output));
    }
  }

  // Deduplicar por URL, priorizando los que aparecieron en más de una búsqueda.
  const byUrl = new Map<string, { title: string; url: string; snippet: string; hits: number }>();
  for (const r of allResults) {
    const existing = byUrl.get(r.url);
    if (existing) existing.hits += 1;
    else byUrl.set(r.url, { ...r, hits: 1 });
  }
  const ranked = [...byUrl.values()].sort((a, b) => b.hits - a.hits).slice(0, 5);

  if (ranked.length === 0) {
    return { contextText: '', trace, ok: false, error: 'No se encontraron resultados en ninguna búsqueda.' };
  }

  const fetchedSections: string[] = [];
  for (const r of ranked) {
    trace.push(`Leyendo: ${r.url}`);
    const fetched = await dispatchAdvancedTool('web_fetch', { url: r.url, max_chars: 12000 });
    if (fetched.ok) {
      fetchedSections.push(`### Fuente: ${r.title}\nURL: ${r.url}\n\n${fetched.output}`);
    } else {
      // Si falla el fetch completo, al menos deja el snippet de búsqueda.
      fetchedSections.push(`### Fuente: ${r.title}\nURL: ${r.url}\n\n${r.snippet}`);
    }
  }

  return {
    contextText: `Investigación profunda sobre "${query}" (${ranked.length} fuentes consultadas):\n\n${fetchedSections.join('\n\n---\n\n')}`,
    trace,
    ok: true,
  };
}

export async function runSearchTool(mode: NotebookToolMode, query: string): Promise<SearchRunResult> {
  return mode === 'deep_research' ? runDeepResearch(query) : runQuickSearch(query);
}

/**
 * Busca fuentes para la pestaña "Fuentes" del notebook (no para responder un
 * mensaje de chat): devuelve la lista de resultados crudos (título, url,
 * snippet) para que el usuario elija cuáles importar como fuentes.
 *
 * quick_search: una sola consulta a Tavily.
 * deep_research: varias reformulaciones + deduplicado por URL, igual que en
 * el chat, pero SIN hacer web_fetch del contenido completo — el fetch real
 * se hace solo al momento de "Importar" (ver importSearchResultAsSource),
 * para no gastar llamadas de red en resultados que el usuario descarta.
 */
export async function searchSources(mode: NotebookToolMode, query: string): Promise<SourceSearchRun> {
  const trace: string[] = [];

  if (mode === 'quick_search') {
    trace.push(`Búsqueda rápida: "${query}"`);
    const res = await dispatchAdvancedTool('web_search', { query, max_results: 8 });
    if (!res.ok) return { results: [], trace, ok: false, error: res.error };
    return { results: parseSearchOutput(res.output), trace, ok: true };
  }

  // deep_research: varias variantes + dedupe por URL, priorizando repetidas.
  const queries = buildQueryVariants(query);
  const allResults: SourceSearchResultItem[] = [];
  for (const q of queries) {
    trace.push(`Buscando: "${q}"`);
    const res = await dispatchAdvancedTool('web_search', { query: q, max_results: 8 });
    if (res.ok) allResults.push(...parseSearchOutput(res.output));
  }

  const byUrl = new Map<string, SourceSearchResultItem & { hits: number }>();
  for (const r of allResults) {
    const existing = byUrl.get(r.url);
    if (existing) existing.hits += 1;
    else byUrl.set(r.url, { ...r, hits: 1 });
  }
  const ranked = [...byUrl.values()].sort((a, b) => b.hits - a.hits).slice(0, 10);

  if (ranked.length === 0) {
    return { results: [], trace, ok: false, error: 'No se encontraron resultados en ninguna búsqueda.' };
  }
  return { results: ranked, trace, ok: true };
}

/** Reformulaciones simples de la query original para ampliar cobertura en deep research. */
function buildQueryVariants(query: string): string[] {
  const variants = [query, `${query} explicación detallada`, `${query} datos y cifras recientes`];
  // Máximo 3 variantes para no disparar demasiadas llamadas de red por turno.
  return variants;
}

/** Parsea el output de texto plano que devuelve la tool web_search (ver src/lib/tools.ts). */
function parseSearchOutput(output: string): Array<{ title: string; url: string; snippet: string }> {
  const lines = output.split('\n');
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  let current: { title: string; url: string; snippet: string } | null = null;
  for (const line of lines) {
    if (line.startsWith('- ')) {
      if (current) results.push(current);
      current = { title: line.slice(2).trim(), url: '', snippet: '' };
    } else if (line.trim().startsWith('URL:') && current) {
      current.url = line.trim().slice(4).trim();
    } else if (current && line.trim() && !line.startsWith('Respuesta rápida') && !line.startsWith('Resultados:')) {
      current.snippet += line.trim() + ' ';
    }
  }
  if (current) results.push(current);
  return results.filter((r) => r.url);
}
