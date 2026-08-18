/**
 * Ingesta de fuentes para Notebooks: convierte archivos (PDF, Markdown,
 * texto, DOCX) y URLs en `NotebookSource` con el texto ya extraído,
 * listo para usarse como contexto del chat (grounding).
 *
 * PDF: usa pdfjs-dist (carga perezosa, solo si el usuario sube un PDF).
 * URL: usa la tool `web_fetch` ya existente en Weaver (Tavily / fetch directo).
 */

import type { NotebookSource, SourceKind } from './types';
import { dispatchAdvancedTool } from '@/lib/tools';

const MAX_SOURCE_CHARS = 400_000; // ~100k tokens aprox., límite por fuente individual

function getExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function detectSourceKind(file: File): SourceKind {
  const ext = getExt(file.name);
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'docx') return 'docx';
  return 'text';
}

function truncate(text: string): { content: string; truncated: boolean } {
  if (text.length <= MAX_SOURCE_CHARS) return { content: text, truncated: false };
  return { content: text.slice(0, MAX_SOURCE_CHARS), truncated: true };
}

/** Extrae texto de un PDF usando pdfjs-dist (import perezoso). */
async function extractPdfText(file: File): Promise<string> {
  // Import dinámico: pdfjs-dist es pesado, solo se carga si hace falta.
  const pdfjs = await import('pdfjs-dist');
  // El worker se sirve como URL vía Vite (?url) para que Tauri/webview lo resuelva sin CDN.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
    parts.push(`\n\n--- Página ${i} ---\n${pageText}`);
  }
  return parts.join('');
}

/** Convierte un File (subido por el usuario) en un NotebookSource listo. */
export async function fileToSource(file: File): Promise<NotebookSource> {
  const kind = detectSourceKind(file);
  const base = {
    id: crypto.randomUUID(),
    kind,
    name: file.name,
    size: file.size,
    status: 'processing' as const,
    addedAt: Date.now(),
  };

  try {
    if (kind === 'pdf') {
      const raw = await extractPdfText(file);
      const { content, truncated } = truncate(raw);
      return { ...base, content, truncated, status: 'ready' };
    }
    if (kind === 'docx') {
      // Import perezoso de mammoth (extractor de .docx a texto/HTML).
      // Se usa el paquete raíz (no /mammoth.browser) porque Vite resuelve
      // automáticamente el field "browser" de su package.json al bundlear.
      const mammoth = await import('mammoth');
      const buf = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      const { content, truncated } = truncate(result.value);
      return { ...base, content, truncated, status: 'ready' };
    }
    // markdown / text: lectura directa.
    const raw = await file.text();
    const { content, truncated } = truncate(raw);
    return { ...base, content, truncated, status: 'ready' };
  } catch (e) {
    return {
      ...base,
      content: '',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Convierte una URL en un NotebookSource, usando la tool web_fetch existente. */
export async function urlToSource(url: string, preferredName?: string): Promise<NotebookSource> {
  const base = {
    id: crypto.randomUUID(),
    kind: 'url' as const,
    name: preferredName ?? url,
    url,
    size: 0,
    status: 'processing' as const,
    addedAt: Date.now(),
  };
  try {
    const result = await dispatchAdvancedTool('web_fetch', { url, max_chars: MAX_SOURCE_CHARS });
    if (!result.ok) {
      return { ...base, content: '', status: 'error', error: result.error ?? 'No se pudo descargar la URL' };
    }
    const { content, truncated } = truncate(result.output);
    // Si no se pasó un título preferido (ej. desde resultados de búsqueda),
    // intenta usar el primer heading/línea del contenido como nombre visible.
    const firstLine = content.split('\n').find((l) => l.trim().length > 0)?.slice(0, 80);
    return {
      ...base,
      name: preferredName ?? (firstLine ? `${firstLine} — ${new URL(url).hostname}` : url),
      content,
      truncated,
      size: content.length,
      status: 'ready',
    };
  } catch (e) {
    return { ...base, content: '', status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/** URL del favicon de un sitio, usando el servicio público de Google (mismo que usa Chrome). */
export function faviconUrl(pageUrl: string): string | null {
  try {
    const host = new URL(pageUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return null;
  }
}

/** Formatea el tamaño de una fuente para mostrar en UI. */
export function formatSourceSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
