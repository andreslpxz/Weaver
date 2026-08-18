/**
 * Fase 3 — Grounding robusto.
 *
 * Antes: se inyectaban TODAS las fuentes completas sin importar el modelo
 * elegido ni cuántas fuentes hubiera, con riesgo real de exceder el context
 * window o encarecer cada turno innecesariamente.
 *
 * Ahora: se calcula un presupuesto de tokens real a partir de
 * `contextWindow` del modelo activo (ver providers/registry.ts), se reserva
 * espacio para system prompt base + historial + respuesta, y se reparte el
 * resto entre las fuentes, priorizando:
 *   1) relevancia (coincidencia de términos con la pregunta actual)
 *   2) recencia (fuentes agregadas más tarde primero, a igualdad de score)
 * Si aun así no caben todas completas, se truncan las de menor prioridad
 * antes que excluirlas del todo (mejor un fragmento que nada).
 */

import { getProvider } from '@/providers/registry';
import type { ProviderId } from '@/providers/types';
import type { Message } from '@/providers/types';
import type { NotebookSource } from './types';

// Aproximación estándar: ~4 caracteres por token en textos en español/inglés.
const CHARS_PER_TOKEN = 4;

// Reservas conservadoras del presupuesto total del modelo.
const RESERVED_FOR_RESPONSE_TOKENS = 4_000;
const RESERVED_FOR_SYSTEM_AND_HISTORY_RATIO = 0.15; // 15% del contexto restante para prompt base + historial

export interface SourceSelection {
  /** Fuentes incluidas, ya truncadas si hizo falta, en el orden a mostrar. */
  included: Array<{ source: NotebookSource; usedContent: string; wasTruncatedForBudget: boolean }>;
  /** Fuentes excluidas por completo (no cupieron ni truncadas). */
  excluded: NotebookSource[];
  /** Tokens estimados usados por las fuentes incluidas. */
  estimatedTokensUsed: number;
  /** Presupuesto total de tokens disponible que se calculó para fuentes. */
  budgetTokens: number;
}

function estimateTokens(text: string | null | undefined): number {
  return Math.ceil((text?.length ?? 0) / CHARS_PER_TOKEN);
}

function getContextWindow(providerId: ProviderId, modelId: string): number {
  const provider = getProvider(providerId);
  const model = provider?.models.find((m) => m.id === modelId);
  // Fallback conservador (8k tokens) si el modelo no está en el registro
  // (p. ej. modelos remotos de OpenRouter no listados aquí).
  return model?.contextWindow ?? 8_000;
}

/** Puntaje simple de relevancia: cuenta coincidencias de palabras clave de la pregunta en el contenido. */
function relevanceScore(query: string, source: NotebookSource): number {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 3); // ignora palabras muy cortas/stopwords triviales
  if (terms.length === 0) return 0;
  const haystack = (source.name + ' ' + source.content).toLowerCase();
  let score = 0;
  for (const term of terms) {
    // Cuenta ocurrencias, con un tope para que un término repetido no domine todo el score.
    const occurrences = haystack.split(term).length - 1;
    score += Math.min(occurrences, 20);
  }
  return score;
}

/**
 * Selecciona y ajusta las fuentes que caben en el presupuesto de tokens
 * disponible para el modelo activo, priorizando por relevancia a la
 * pregunta actual y luego por recencia.
 */
export function selectSourcesForBudget(
  sources: NotebookSource[],
  query: string,
  providerId: ProviderId,
  modelId: string,
  historyMessages: Message[],
): SourceSelection {
  const ready = sources.filter((s) => s.status === 'ready' && s.content.trim());

  const contextWindow = getContextWindow(providerId, modelId);
  const historyTokens = historyMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const reservedBase = Math.max(
    Math.floor(contextWindow * RESERVED_FOR_SYSTEM_AND_HISTORY_RATIO),
    historyTokens + 500,
  );
  const budgetTokens = Math.max(contextWindow - reservedBase - RESERVED_FOR_RESPONSE_TOKENS, 1_000);

  // Orden de prioridad: mayor relevancia primero; empate → más reciente primero.
  const scored = ready
    .map((s) => ({ source: s, score: relevanceScore(query, s) }))
    .sort((a, b) => b.score - a.score || b.source.addedAt - a.source.addedAt);

  const included: SourceSelection['included'] = [];
  const excluded: NotebookSource[] = [];
  let used = 0;

  for (const { source } of scored) {
    const fullTokens = estimateTokens(source.content);
    if (used + fullTokens <= budgetTokens) {
      included.push({ source, usedContent: source.content, wasTruncatedForBudget: false });
      used += fullTokens;
      continue;
    }
    // No cabe completa: intenta meter un fragmento si queda presupuesto razonable.
    const remaining = budgetTokens - used;
    const minUsefulTokens = 300; // por debajo de esto un fragmento no aporta señal
    if (remaining >= minUsefulTokens) {
      const charsAllowed = remaining * CHARS_PER_TOKEN;
      included.push({
        source,
        usedContent: source.content.slice(0, charsAllowed),
        wasTruncatedForBudget: true,
      });
      used += remaining;
    } else {
      excluded.push(source);
    }
  }

  return { included, excluded, estimatedTokensUsed: used, budgetTokens };
}
