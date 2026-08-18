/**
 * Fase 4 — Motor de generación de artefactos de Studio.
 *
 * Cada tipo de artefacto tiene su propio prompt especializado (no reusa el
 * NOTEBOOK_SYSTEM_PROMPT del chat) y le pide al modelo un formato de salida
 * concreto y parseable:
 *   - mindmap            → sintaxis Mermaid (mindmap)
 *   - flashcards, quiz,
 *     data_table         → JSON estricto (se valida y parsea)
 *   - report, summary,
 *     study_guide,
 *     infographic        → Markdown (la "infografía" se renderiza como
 *                          markdown con estructura visual: no hay generación
 *                          de imágenes real aquí, se documenta la limitación)
 *
 * Reusa el mismo presupuesto de fuentes de `grounding.ts` (Fase 3) para no
 * exceder el context window del modelo activo, y el mismo `createProvider`
 * que el chat — pero SIN streaming, porque se necesita la respuesta
 * completa antes de poder parsear/renderizar.
 */

import { createProvider } from '@/providers';
import type { Message, ProviderId } from '@/providers/types';
import type { NotebookSource, StudioArtifactKind } from './types';
import { selectSourcesForBudget } from './grounding';

interface ArtifactSpec {
  title: string;
  /** Instrucciones específicas de formato para el modelo. */
  instructions: string;
  /** Cómo se debe interpretar/renderizar la respuesta en la UI. */
  outputFormat: 'markdown' | 'mermaid' | 'json';
}

const ARTIFACT_SPECS: Record<StudioArtifactKind, ArtifactSpec> = {
  summary: {
    title: 'Resumen',
    outputFormat: 'markdown',
    instructions:
      'Escribe un resumen ejecutivo claro y bien estructurado (con subtítulos si el contenido lo amerita) de las fuentes proporcionadas. Máximo 500 palabras. No inventes información que no esté en las fuentes.',
  },
  report: {
    title: 'Informe',
    outputFormat: 'markdown',
    instructions:
      'Redacta un informe detallado en Markdown con: 1) Introducción, 2) Hallazgos principales (con subtítulos), 3) Conclusiones. Cita el nombre de la fuente entre corchetes cuando uses un dato específico, ej. [Fuente 1]. Basa todo el contenido exclusivamente en las fuentes proporcionadas.',
  },
  study_guide: {
    title: 'Guía de estudio',
    outputFormat: 'markdown',
    instructions:
      'Crea una guía de estudio en Markdown con: conceptos clave (definidos brevemente), una línea de tiempo o secuencia si aplica, y una sección de "preguntas para repasar" al final (solo preguntas, sin respuestas). Basa todo en las fuentes proporcionadas.',
  },
  infographic: {
    title: 'Infografía',
    outputFormat: 'markdown',
    instructions:
      'Genera el contenido de una infografía en Markdown: usa encabezados cortos, listas con cifras destacadas en negrita, y separa la información en bloques temáticos breves (2-3 líneas cada uno). Prioriza datos concretos y cifras de las fuentes sobre texto largo. Esto se mostrará como un documento visual compacto, no como prosa larga.',
  },
  mindmap: {
    title: 'Mapa mental',
    outputFormat: 'mermaid',
    instructions:
      'Genera UNICAMENTE un diagrama en sintaxis Mermaid tipo "mindmap" que represente los conceptos principales de las fuentes y sus relaciones jerárquicas. No incluyas explicaciones antes o después, ni bloques de código markdown, solo el código Mermaid puro empezando por "mindmap".',
  },
  flashcards: {
    title: 'Tarjetas didácticas',
    outputFormat: 'json',
    instructions:
      'Genera entre 8 y 15 tarjetas didácticas (flashcards) basadas en las fuentes. Responde UNICAMENTE con un JSON válido (sin markdown) con esta forma exacta: {"cards": [{"front": "pregunta o término", "back": "respuesta o definición"}]}',
  },
  quiz: {
    title: 'Cuestionario',
    outputFormat: 'json',
    instructions:
      'Genera un cuestionario de opción múltiple con 6 a 10 preguntas basadas en las fuentes. Responde UNICAMENTE con un JSON válido (sin markdown) con esta forma exacta: {"questions": [{"question": "...", "options": ["...", "...", "...", "..."], "correctIndex": 0, "explanation": "breve justificación"}]}',
  },
  data_table: {
    title: 'Tabla de datos',
    outputFormat: 'json',
    instructions:
      'Extrae los datos tabulables más relevantes de las fuentes (cifras, comparaciones, series) y estructúralos. Responde UNICAMENTE con un JSON válido (sin markdown) con esta forma exacta: {"columns": ["Columna 1", "Columna 2"], "rows": [["valor", "valor"]]}. Si no hay datos tabulables reales en las fuentes, responde {"columns": [], "rows": []}.',
  },
};

export function getArtifactSpec(kind: StudioArtifactKind): ArtifactSpec {
  return ARTIFACT_SPECS[kind];
}

function buildSourcesBlockForStudio(sources: ReturnType<typeof selectSourcesForBudget>['included']): string {
  if (sources.length === 0) return 'No hay fuentes cargadas en este notebook.';
  return sources
    .map(
      ({ source, usedContent, wasTruncatedForBudget }, i) =>
        `[Fuente ${i + 1}: ${source.name}]${wasTruncatedForBudget ? ' (fragmento parcial)' : ''}\n${usedContent}`,
    )
    .join('\n\n---\n\n');
}

export interface GenerateArtifactOpts {
  kind: StudioArtifactKind;
  sources: NotebookSource[];
  providerId: ProviderId;
  modelId: string;
  /** Instrucción libre opcional del usuario (ej. "enfócate en la sección de precios"). */
  extraInstruction?: string;
  signal?: AbortSignal;
}

export interface GenerateArtifactResult {
  content: string;
  outputFormat: ArtifactSpec['outputFormat'];
  excludedSourceCount: number;
}

export async function generateStudioArtifact(opts: GenerateArtifactOpts): Promise<GenerateArtifactResult> {
  const { kind, sources, providerId, modelId, extraInstruction, signal } = opts;
  const spec = getArtifactSpec(kind);

  // Reusa el mismo presupuesto de contexto de la Fase 3 (sin query de
  // relevancia específica: para artefactos de Studio se prioriza cobertura
  // general, no una pregunta puntual).
  const selection = selectSourcesForBudget(sources, spec.title, providerId, modelId, []);

  const systemContent = `Eres un generador de artefactos para un Notebook de investigación.\n\nTarea: ${spec.instructions}\n\n=== FUENTES ===\n${buildSourcesBlockForStudio(selection.included)}`;

  const messages: Message[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: extraInstruction?.trim() || `Genera: ${spec.title}` },
  ];

  const llm = await createProvider(providerId);
  const stream = await llm.stream({ model: modelId, messages, temperature: 0.5, signal });

  let full = '';
  for await (const chunk of stream) {
    if (chunk.type === 'delta') full += chunk.content;
    if (chunk.type === 'error') throw new Error(chunk.message);
  }

  return {
    content: cleanModelOutput(full, spec.outputFormat),
    outputFormat: spec.outputFormat,
    excludedSourceCount: selection.excluded.length,
  };
}

/** Limpia envolturas de markdown (```json, ```mermaid) que el modelo a veces agrega pese a la instrucción. */
function cleanModelOutput(text: string, format: ArtifactSpec['outputFormat']): string {
  let cleaned = text.trim();
  if (format === 'json' || format === 'mermaid') {
    cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '');
  }
  return cleaned.trim();
}
