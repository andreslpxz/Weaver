/**
 * Reflexión post-episodio.
 *
 * Tras completar (o fallar) una tarea, el agente reflexiona:
 *   - ¿Qué funcionó?
 *   - ¿Qué no funcionó?
 *   - ¿Hay una skill reutilizable para extraer?
 *
 * Si la tarea fue exitosa y la reflexión sugiere una skill, se materializa
 * como un archivo SKILL.md en ~/.weaver/skills/learned/<name>.md vía
 * skillsRegistry.saveLearnedSkill().
 */

import type { LLMProvider, Message } from '@/providers/types';
import type { Episode } from './types';
import { streamUntilDone } from '@/lib/chain';
import { skillsRegistry } from '@/skills/registry';

const SYSTEM_PROMPT = `Eres el módulo de Reflexión de Weaver. Tras cada episodio, extraes lecciones reutilizables.

Devuelve ÚNICAMENTE JSON:
{
  "lessons": ["lección 1", "lección 2"],
  "skill": {
    "name": "kebab-case-name o null si no aplica",
    "description": "1 frase describiendo cuándo usarla",
    "triggers": ["frase que el usuario diría", ...],
    "body": "markdown con el procedimiento paso a paso"
  }
}`;

export interface ReflectionResult {
  lessons: string[];
  skill?: {
    name: string;
    description: string;
    triggers: string[];
    body: string;
  };
  /** True si la skill fue persistida a disco. */
  skillSaved?: boolean;
}

export async function reflect(
  provider: LLMProvider,
  model: string,
  episode: Episode,
): Promise<ReflectionResult> {
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Episodio:
Objetivo: ${episode.objective}
Outcome: ${episode.outcome}
Subtareas:
${episode.plan.subtasks.map((s, i) => `${i + 1}. ${s.description} → ${s.status} (intentos: ${s.attempts})`).join('\n')}

Pasos destacados:
${episode.plan.subtasks
  .flatMap((s) => s.trace.map((t) => `[${s.id.slice(0, 4)}][${t.kind}] ${t.content}`))
  .slice(0, 30)
  .join('\n')}`,
    },
  ];

  const text = await streamUntilDone(provider, model, messages, { maxChains: 3 });
  const json = extractJson(text);
  if (!json) return { lessons: ['No se pudo reflexionar'] };
  try {
    const parsed = JSON.parse(json) as Partial<ReflectionResult>;
    const result: ReflectionResult = {
      lessons: parsed.lessons ?? [],
      skill: parsed.skill?.name ? parsed.skill : undefined,
    };

    // Si el agente identificó una skill reutilizable Y el episodio fue
    // exitoso, persistirla a disco vía skillsRegistry.saveLearnedSkill().
    if (result.skill && result.skill.name && (episode.outcome === 'success' || episode.outcome === 'partial')) {
      try {
        await skillsRegistry.saveLearnedSkill({
          name: result.skill.name,
          description: result.skill.description,
          triggers: result.skill.triggers,
          toolsRequired: [], // La reflexión no especifica tools; se infiere del body
          body: result.skill.body,
          source: 'learned',
        });
        result.skillSaved = true;
      } catch (e) {
        console.warn('reflect: no se pudo guardar la skill aprendida:', e);
        result.skillSaved = false;
      }
    }

    return result;
  } catch {
    return { lessons: ['Reflexión inválida'] };
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
