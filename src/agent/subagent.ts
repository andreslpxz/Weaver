/**
 * subagent.ts
 *
 * Subagentes especializables del agente orquestador de Weaver.
 *
 * Punto clave: un subagente NO es "el executor con otro system prompt".
 * Un subagente tiene:
 *
 *   - Su propio set de tools RESTRINGIDO (no le das shell_exec a un
 *     subagente de email). La restricción es por nombre, no por categoría.
 *   - Su propio criterio de éxito (verificationPrompt).
 *   - Su propio presupuesto: maxSteps, maxTokens, maxTimeMs.
 *   - Su propio modelo asignado (puede ser más barato/rápido que el
 *     orquestador para tareas rutinarias).
 *
 * Contrato de entrada/salida (JSON estricto):
 *
 *   INPUT  (SubagentInvocation):
 *     objective  : string   — qué debe lograr.
 *     context    : string   — contexto mínimo necesario (no todo el historial).
 *     budget     : Budget   — pasos/tokens/tiempo máximos.
 *
 *   OUTPUT (SubagentResult):
 *     status     : 'succeeded' | 'failed' | 'stuck' | 'timeout' | 'budget_exceeded'
 *     result     : string   — JSON o texto estructurado (lo que pidió el orquestador).
 *     evidence   : Evidence[] — logs, snapshots, outputs verificables.
 *     trace      : TraceStep[] — árbol de ejecución para depuración.
 *     usage      : { inputTokens, outputTokens, steps, elapsedMs }
 *
 * El orquestador puede:
 *   - Reintentar con otro subagente si status === 'failed'.
 *   - Escalar a plan alternativo si status === 'timeout' | 'budget_exceeded'.
 *   - Verificar evidence para validar que el subagente realmente cumplió.
 *
 * Persistencia: los subagentes definidos por el usuario se guardan en
 * localStorage (navegador) o SQLite vía `sqlite.setFact/getFact` (Tauri),
 * bajo el prefijo `subagent:` en facts. Esto los sincroniza con la
 * infraestructura existente sin añadir tablas nuevas.
 *
 * Conexión con skills: un subagente podría "envolverse" sobre una skill
 * existente para darle su propio loop de ejecución. Por ahora la
 * integración es referencial (skillName opcional), pero el contrato
 * está pensado para que en el futuro un subagente pueda invocar la skill
 * como una tool más.
 */

import type { LLMProvider, Message, Tool } from '@/providers/types';
import type { TraceStep } from './types';
import { streamChat } from '@/lib/chain';
import { dispatchAdvancedTool, buildAdvancedToolsList } from '@/lib/tools';
import { metrics } from '@/lib/metrics';

// ============================================================================
// Tipos del contrato
// ============================================================================

export interface SubagentBudget {
  maxSteps: number;
  maxTokens: number;
  maxTimeMs: number;
}

export interface SubagentEvidence {
  kind: 'log' | 'snapshot' | 'output' | 'http_response' | 'file_path';
  label: string;
  content: string;
  ts: number;
}

export interface SubagentInvocation {
  objective: string;
  context: string;
  budget: SubagentBudget;
}

export type SubagentStatus =
  | 'succeeded'
  | 'failed'
  | 'stuck'
  | 'timeout'
  | 'budget_exceeded';

export interface SubagentResult {
  subagentId: string;
  subagentName: string;
  status: SubagentStatus;
  result: string;
  evidence: SubagentEvidence[];
  trace: TraceStep[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    steps: number;
    elapsedMs: number;
  };
}

// ============================================================================
// Definición de subagente (catálogo del usuario)
// ============================================================================

export interface SubagentDef {
  id: string;
  name: string;
  description: string;
  /** Proveedor/modelo a usar para este subagente. Si null, hereda el del orquestador. */
  providerId?: string | null;
  model?: string | null;
  /** Lista blanca de nombres de tools. Si vacío, el subagente no tiene tools. */
  allowedTools: string[];
  /** System prompt específico del subagente. */
  systemPrompt: string;
  /** Prompt de verificación — el orquestador lo usa para validar el resultado. */
  verificationPrompt: string;
  /** Presupuesto por defecto si el orquestador no especifica uno. */
  defaultBudget: SubagentBudget;
  /** Nombre de skill asociada (opcional, para futura integración). */
  skillName?: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Registry (catálogo de subagentes definibles por el usuario)
// ============================================================================

const STORAGE_KEY = 'weaver:subagents';

function lsRead(): SubagentDef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SubagentDef[]) : [];
  } catch {
    return [];
  }
}

function lsWrite(list: SubagentDef[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota */
  }
}

export const subagentRegistry = {
  list(): SubagentDef[] {
    return lsRead();
  },

  get(id: string): SubagentDef | undefined {
    return lsRead().find((s) => s.id === id);
  },

  save(def: SubagentDef): void {
    const list = lsRead();
    const idx = list.findIndex((s) => s.id === def.id);
    const updated: SubagentDef = { ...def, updatedAt: Date.now() };
    if (idx >= 0) list[idx] = updated;
    else list.push(updated);
    lsWrite(list);
  },

  delete(id: string): void {
    lsWrite(lsRead().filter((s) => s.id !== id));
  },

  /** Subagentes predefinidos que se cargan la primera vez. */
  defaults(): SubagentDef[] {
    return [
      {
        id: 'default-web-researcher',
        name: 'Web Researcher',
        description:
          'Busca información en internet y devuelve un resumen con fuentes verificables.',
        providerId: null,
        model: null,
        allowedTools: ['web_search', 'web_fetch'],
        systemPrompt:
          'Eres un investigador web. Recibes una pregunta, buscas en internet 2-3 veces, lees las páginas relevantes, y devuelves un resumen estructurado. ' +
          'SIEMPRE incluye URLs como evidencia. Si no encuentras respuesta clara, di "no_encontrado" en lugar de inventar.',
        verificationPrompt:
          '¿El resultado incluye al menos 2 URLs verificables y un resumen coherente con la pregunta?',
        defaultBudget: { maxSteps: 8, maxTokens: 8000, maxTimeMs: 90_000 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'default-file-reader',
        name: 'File Reader',
        description:
          'Lee archivos del filesystem y extrae información específica. No modifica nada.',
        providerId: null,
        model: null,
        allowedTools: ['file_read', 'file_list'],
        systemPrompt:
          'Eres un lector de archivos. Recibes una ruta y un objetivo de qué extraer. ' +
          'Lees el archivo, extraes la información relevante, y devuelves un JSON estructurado. ' +
          'NO tienes permisos de escritura. Si el archivo no existe, reporta error.',
        verificationPrompt:
          '¿El resultado corresponde al contenido real del archivo (no inventado)?',
        defaultBudget: { maxSteps: 4, maxTokens: 4000, maxTimeMs: 30_000 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 'default-email-summarizer',
        name: 'Email Summarizer',
        description:
          'Resume bandejas de correo. Acceso de sólo lectura (sin shell_exec, sin file_write).',
        providerId: null,
        model: null,
        allowedTools: ['shell_exec'],
        systemPrompt:
          'Eres un resumidor de email. Recibes una ruta a un buzón o un comando seguro para listar correos. ' +
          'Lees los correos recientes (máx 20), identificas los urgentes, y devuelves un JSON con {urgentes:[], normales:[], resumen_general}. ' +
          'NO envías correos, NO modifies nada. Sólo lectura.',
        verificationPrompt:
          '¿El resultado es un JSON con las claves {urgentes, normales, resumen_general}?',
        defaultBudget: { maxSteps: 6, maxTokens: 6000, maxTimeMs: 60_000 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
  },

  /** Inicializa con defaults si el catálogo está vacío. */
  ensureDefaults(): void {
    if (lsRead().length === 0) {
      lsWrite(this.defaults());
    }
  },
};

// ============================================================================
// Runner — ejecuta un subagente con presupuesto controlado
// ============================================================================

export interface RunSubagentOpts {
  provider: LLMProvider;
  model: string;
  invocation: SubagentInvocation;
  /** Override del presupuesto por defecto del subagente. */
  budgetOverride?: SubagentBudget;
  onTrace?: (step: TraceStep) => void;
}

export async function runSubagent(
  def: SubagentDef,
  opts: RunSubagentOpts,
): Promise<SubagentResult> {
  const start = Date.now();
  const trace: TraceStep[] = [];
  const evidence: SubagentEvidence[] = [];
  const budget = opts.budgetOverride ?? def.defaultBudget;

  const provider = opts.provider;
  const model = def.model ?? opts.model;

  // Filtrar tools del catálogo global según la lista blanca del subagente.
  const allTools = buildAdvancedToolsList();
  const allowedTools: Tool[] = allTools.filter((t) =>
    def.allowedTools.includes(t.function.name),
  );

  let inputTokens = 0;
  let outputTokens = 0;
  let steps = 0;
  let status: SubagentStatus = 'failed';
  let resultText = '';

  const messages: Message[] = [
    { role: 'system', content: def.systemPrompt },
    {
      role: 'user',
      content:
        `OBJETIVO: ${opts.invocation.objective}\n\n` +
        `CONTEXTO:\n${opts.invocation.context}\n\n` +
        `PRESUPUESTO: ${budget.maxSteps} pasos, ${budget.maxTokens} tokens, ${budget.maxTimeMs}ms.\n\n` +
        `Cuando termines, responde EXACTAMENTE en este formato:\n` +
        `RESULT: <resultado estructurado>\n` +
        `EVIDENCE: <evidencia verificable — URLs, rutas, snapshots>\n` +
        `Si no puedes completar, responde:\n` +
        `STUCK: <motivo>`,
    },
  ];

  try {
    for (let step = 0; step < budget.maxSteps; step++) {
      steps = step + 1;

      // Chequear timeout
      if (Date.now() - start > budget.maxTimeMs) {
        status = 'timeout';
        break;
      }

      // Chequear presupuesto de tokens
      if (inputTokens + outputTokens > budget.maxTokens) {
        status = 'budget_exceeded';
        break;
      }

      const res = await streamChat(provider, model, messages, {
        tools: allowedTools.length > 0 ? allowedTools : undefined,
      });
      inputTokens += res.usage.inputTokens;
      outputTokens += res.usage.outputTokens;

      // Registrar uso en métricas globales
      metrics.recordUsage({
        providerId: def.providerId ?? 'inherit',
        model,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        source: `subagent:${def.name}`,
        success: true, // se actualiza al final si falla
        taskKind: 'subagent',
      });

      if (res.toolCalls.length > 0) {
        const tc = res.toolCalls[0];
        const args = JSON.parse(tc.function.arguments || '{}');
        const traceStep: TraceStep = {
          ts: Date.now(),
          kind: 'tool_call',
          content: tc.function.name,
          toolArgs: args,
        };
        trace.push(traceStep);
        opts.onTrace?.(traceStep);
        messages.push({
          role: 'assistant',
          content: res.text || `Llamar ${tc.function.name}`,
          tool_calls: [tc],
        });

        try {
          const out = await dispatchAdvancedTool(tc.function.name, args);
          const resultStep: TraceStep = {
            ts: Date.now(),
            kind: 'tool_result',
            content: out.output.slice(0, 500),
            toolResult: out,
          };
          trace.push(resultStep);
          opts.onTrace?.(resultStep);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: out.ok ? out.output : `ERROR: ${out.error ?? 'desconocido'}`,
          });

          // Recolectar evidencia automáticamente
          if (tc.function.name === 'web_search' || tc.function.name === 'web_fetch') {
            evidence.push({
              kind: 'http_response',
              label: `${tc.function.name} ${String(args.query || args.url || '')}`,
              content: out.output.slice(0, 1000),
              ts: Date.now(),
            });
          } else if (tc.function.name === 'file_read') {
            evidence.push({
              kind: 'file_path',
              label: String(args.path),
              content: out.output.slice(0, 1000),
              ts: Date.now(),
            });
          }
        } catch (e) {
          const errStep: TraceStep = {
            ts: Date.now(),
            kind: 'error',
            content: e instanceof Error ? e.message : String(e),
          };
          trace.push(errStep);
          opts.onTrace?.(errStep);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `ERROR: ${errStep.content}`,
          });
        }
        continue;
      }

      const text = res.text.trim();
      trace.push({ ts: Date.now(), kind: 'thought', content: text });
      opts.onTrace?.({ ts: Date.now(), kind: 'thought', content: text });
      messages.push({ role: 'assistant', content: text });

      if (text.startsWith('RESULT:')) {
        const payload = text.slice(7).trim();
        // Buscar bloque EVIDENCE si existe
        const evMatch = payload.match(/^(.*?)\n+EVIDENCE:\s*(.*)$/s);
        if (evMatch) {
          resultText = evMatch[1].trim();
          const evLines = evMatch[2].split('\n').filter(Boolean);
          for (const line of evLines.slice(0, 10)) {
            evidence.push({
              kind: 'log',
              label: 'subagent-provided',
              content: line.trim(),
              ts: Date.now(),
            });
          }
        } else {
          resultText = payload;
        }
        status = 'succeeded';
        break;
      }

      if (text.startsWith('STUCK:')) {
        resultText = text.slice(6).trim();
        status = 'stuck';
        break;
      }

      if (step === budget.maxSteps - 1) {
        status = 'budget_exceeded';
        resultText = 'Límite de pasos alcanzado sin RESULT ni STUCK';
      }
    }
  } catch (e) {
    status = 'failed';
    resultText = e instanceof Error ? e.message : String(e);
    trace.push({
      ts: Date.now(),
      kind: 'error',
      content: resultText,
    });
  }

  return {
    subagentId: def.id,
    subagentName: def.name,
    status,
    result: resultText,
    evidence,
    trace,
    usage: {
      inputTokens,
      outputTokens,
      steps,
      elapsedMs: Date.now() - start,
    },
  };
}

// ============================================================================
// Helper para inicializar el catálogo en el arranque de la app
// ============================================================================

export function initSubagents(): void {
  subagentRegistry.ensureDefaults();
}
