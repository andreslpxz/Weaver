/**
 * Tipos del módulo Notebooks.
 *
 * Notebooks es una sección independiente de Weaver (separada del chat
 * principal y de Workflows), inspirada en NotebookLM: cuadernos que agrupan
 * "fuentes" (PDFs, Markdown, texto, URLs) y permiten chatear con el modelo
 * usando esas fuentes como contexto (grounding), además de generar
 * artefactos de Studio (resúmenes, mapas mentales, flashcards, etc.).
 *
 * Sigue el mismo patrón de persistencia simple que Workflows
 * (localStorage + evento custom), ver `./store.ts`.
 */

import type { ProviderId } from '@/providers/types';

/** Tipo de fuente cargada en un notebook. */
export type SourceKind = 'pdf' | 'markdown' | 'text' | 'url' | 'docx';

export interface NotebookSource {
  id: string;
  kind: SourceKind;
  /** Nombre visible (nombre de archivo o título de página/URL). */
  name: string;
  /** URL original, si kind === 'url'. */
  url?: string;
  /** Texto ya extraído, listo para usarse como contexto del chat. */
  content: string;
  /** Tamaño del contenido original en bytes (aprox, para mostrar en UI). */
  size: number;
  /** ¿Se truncó el contenido por límite de tamaño? */
  truncated?: boolean;
  /** Estado de procesamiento (extracción de texto puede tardar en PDFs grandes). */
  status: 'ready' | 'processing' | 'error';
  error?: string;
  addedAt: number;
}

export type NotebookToolMode = 'quick_search' | 'deep_research';

export interface NotebookChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** IDs de fuentes efectivamente incluidas en el contexto para responder este turno. */
  citedSourceIds?: string[];
  /** IDs de fuentes existentes que quedaron fuera por presupuesto de contexto del modelo. */
  excludedSourceIds?: string[];
  /** Si esta respuesta usó una herramienta de búsqueda, cuál. */
  toolUsed?: NotebookToolMode;
  /** Notas del proceso de búsqueda (queries lanzadas, urls visitadas), solo UI. */
  toolTrace?: string[];
  /** true si este mensaje es un error de generación (no se envía como historial real al modelo). */
  isError?: boolean;
  createdAt: number;
}

/** Artefacto generado en la pestaña Studio. */
export type StudioArtifactKind =
  | 'summary'
  | 'report'
  | 'mindmap'
  | 'flashcards'
  | 'quiz'
  | 'data_table'
  | 'infographic'
  | 'study_guide';

export interface StudioArtifact {
  id: string;
  kind: StudioArtifactKind;
  title: string;
  /** Contenido en markdown, mermaid (mindmap) o JSON serializado (flashcards/quiz/data_table). */
  content: string;
  outputFormat: 'markdown' | 'mermaid' | 'json';
  createdAt: number;
}

export interface Notebook {
  id: string;
  name: string;
  description?: string;
  sources: NotebookSource[];
  chat: NotebookChatMessage[];
  artifacts: StudioArtifact[];
  createdAt: number;
  updatedAt: number;
}
