/**
 * Crítico: valida si una subtarea cumplió su criterio de éxito.
 *
 * Recibe el árbol AT-SPI después de la ejecución y el trace de pasos,
 * y responde con { verdict: 'satisfied' | 'failed', reason: string }.
 */

import type { LLMProvider, Message } from '@/providers/types';
import type { Subtask } from './types';
import { streamUntilDone } from '@/lib/chain';
import { atspi } from '@/lib/tauri';

const SYSTEM_PROMPT = `Eres el Crítico de Weaver. Tu trabajo es juzgar si una subtarea cumplió su criterio de éxito,
basándote en el árbol de accesibilidad actual y el trace de pasos ejecutados.

Devuelve ÚNICAMENTE JSON:
{
  "verdict": "satisfied" | "failed",
  "reason": "explicación breve"
}`;

export interface CriticVerdict {
  verdict: 'satisfied' | 'failed';
  reason: string;
}

export async function critique(
  provider: LLMProvider,
  model: string,
  subtask: Subtask,
): Promise<CriticVerdict> {
  // Snapshot del estado actual (sub-árbol con foco).
  let snapshot = '';
  try {
    const tree = await atspi.getFocusedSubtree(4);
    snapshot = tree ? JSON.stringify(tree).slice(0, 4000) : '(vacío)';
  } catch (e) {
    snapshot = `(no disponible: ${e instanceof Error ? e.message : String(e)})`;
  }

  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Subtarea: ${subtask.description}
Criterio de éxito: ${subtask.successCriteria}
Pasos ejecutados:
${subtask.trace.map((t, i) => `${i + 1}. [${t.kind}] ${t.content}`).join('\n')}

Árbol AT-SPI actual (resumen):
${snapshot}`,
    },
  ];

  const text = await streamUntilDone(provider, model, messages, { maxChains: 2 });
  const json = extractJson(text);
  if (!json) return { verdict: 'failed', reason: 'Crítico no devolvió JSON' };
  try {
    const parsed = JSON.parse(json) as Partial<CriticVerdict>;
    return {
      verdict: parsed.verdict === 'satisfied' ? 'satisfied' : 'failed',
      reason: parsed.reason ?? '(sin razón)',
    };
  } catch {
    return { verdict: 'failed', reason: 'Crítico devolvió JSON inválido' };
  }
}

function extractJson(text: string): string | null {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
