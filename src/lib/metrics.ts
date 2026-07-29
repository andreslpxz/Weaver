/**
 * metrics.ts
 *
 * Registro de uso y costos por proveedor/modelo. Es la base de datos
 * para el futuro benchmark "WeaverBench" y para que el usuario pueda
 * auditar cuánto cuesta cada tarea.
 *
 * Modelo de datos:
 *
 *   UsageRecord {
 *     ts          : number   — epoch ms
 *     providerId  : string
 *     model       : string
 *     inputTokens : number
 *     outputTokens: number
 *     costUsd     : number   — estimado (ver PRICING)
 *     source      : string   — 'chat' | 'subagent:<name>' | 'planner' | ...
 *     success     : boolean  — true si la tarea/call se completó sin error
 *     taskKind?   : string   — 'chat' | 'subtask' | 'reflection' | ...
 *   }
 *
 * Persistencia:
 *   - Navegador: localStorage (weaver:usage_records, cap 1000).
 *   - Tauri: SQLite vía sqlite.shellExec sobre una tabla `weaver_usage`
 *     (creada bajo demanda). Si la tabla no existe, cae a localStorage.
 *
 * La API pública es:
 *   metrics.recordUsage(rec)        — añade un registro.
 *   metrics.list({from, to, ...})   — lista filtrada.
 *   metrics.summary()               — agregados por proveedor/mes/día.
 *   metrics.successRate()           — % de éxito por fuente.
 *   metrics.clear()                 — borra todo.
 */

import { runtime, sqlite } from './tauri';

// ============================================================================
// Precios aproximados por proveedor/modelo (USD por 1M tokens).
// Actualizado a valores públicos de julio 2025. Si un modelo no está,
// se asume cost = 0 (mejor que inventar).
// ============================================================================

interface PricePair {
  in: number;  // USD por 1M input tokens
  out: number; // USD por 1M output tokens
}

const PRICING: Record<string, PricePair> = {
  // OpenAI
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4-turbo': { in: 10, out: 30 },
  'gpt-3.5-turbo': { in: 0.5, out: 1.5 },
  'o1': { in: 15, out: 60 },
  'o1-mini': { in: 3, out: 12 },
  'o3-mini': { in: 3, out: 12 },
  // Anthropic
  'claude-3-5-sonnet': { in: 3, out: 15 },
  'claude-3-5-haiku': { in: 0.8, out: 4 },
  'claude-3-opus': { in: 15, out: 75 },
  'claude-3-sonnet': { in: 3, out: 15 },
  'claude-3-haiku': { in: 0.25, out: 1.25 },
  // Google
  'gemini-1.5-pro': { in: 1.25, out: 5 },
  'gemini-1.5-flash': { in: 0.075, out: 0.3 },
  'gemini-2.0-flash-exp': { in: 0.075, out: 0.3 },
  'gemini-2.5-flash': { in: 0.15, out: 0.6 },
  'gemini-2.5-pro': { in: 1.25, out: 5 },
  // Cohere
  'command-r-plus': { in: 2.5, out: 10 },
  'command-r': { in: 0.15, out: 0.6 },
  'command-a-03-2025': { in: 2.5, out: 10 },
  // xAI
  'grok-2': { in: 2, out: 10 },
  'grok-beta': { in: 5, out: 15 },
  // Mistral
  'mistral-large-latest': { in: 2, out: 6 },
  'mistral-small-latest': { in: 0.2, out: 0.6 },
  'open-mixtral-8x7b': { in: 0.7, out: 0.7 },
  // DeepSeek
  'deepseek-chat': { in: 0.14, out: 0.28 },
  'deepseek-reasoner': { in: 0.55, out: 2.19 },
  // Meta (vía OpenRouter)
  'llama-3.1-70b-instruct': { in: 0.59, out: 0.79 },
  'llama-3.1-8b-instruct': { in: 0.05, out: 0.08 },
  // Ollama / local → gratis
};

export function estimateCostUsd(
  providerId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  // Buscar por model exacto o por prefijo.
  const lookup = (m: string): PricePair | undefined => {
    if (PRICING[m]) return PRICING[m];
    const lower = m.toLowerCase();
    for (const key of Object.keys(PRICING)) {
      if (lower.startsWith(key) || lower.includes(key)) return PRICING[key];
    }
    return undefined;
  };
  const p = lookup(model);
  if (!p) return 0;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

// ============================================================================
// Tipos
// ============================================================================

export interface UsageRecord {
  ts: number;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  source: string;          // 'chat' | 'planner' | 'subagent:Web Researcher' | ...
  success: boolean;
  taskKind?: string;       // 'chat' | 'subtask' | 'reflection' | 'critic'
  elapsedMs?: number;
}

export interface UsageFilter {
  from?: number;
  to?: number;
  providerId?: string;
  source?: string;
  taskKind?: string;
}

export interface ProviderSummary {
  providerId: string;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  successCount: number;
  failureCount: number;
  successRate: number; // 0..1
}

export interface DailyBucket {
  day: string; // YYYY-MM-DD
  totalCalls: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// ============================================================================
// Persistencia
// ============================================================================

const LS_KEY = 'weaver:usage_records';
const LS_CAP = 1000;

function lsRead(): UsageRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as UsageRecord[]) : [];
  } catch {
    return [];
  }
}

function lsWrite(records: UsageRecord[]): void {
  try {
    // Mantener los últimos LS_CAP registros (más recientes al final).
    const trimmed = records.length > LS_CAP ? records.slice(-LS_CAP) : records;
    localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore quota */
  }
}

// ============================================================================
// API pública
// ============================================================================

export const metrics = {
  recordUsage(rec: Omit<UsageRecord, 'costUsd' | 'ts'> & Partial<Pick<UsageRecord, 'costUsd' | 'ts'>>): void {
    const ts = rec.ts ?? Date.now();
    const costUsd =
      rec.costUsd ??
      estimateCostUsd(rec.providerId, rec.model, rec.inputTokens, rec.outputTokens);
    const full: UsageRecord = {
      ts,
      providerId: rec.providerId,
      model: rec.model,
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
      costUsd,
      source: rec.source,
      success: rec.success,
      taskKind: rec.taskKind,
      elapsedMs: rec.elapsedMs,
    };
    const all = lsRead();
    all.push(full);
    lsWrite(all);

    // Si estamos en Tauri, intentar persistir también en SQLite (best-effort).
    if (runtime.isTauri) {
      void persistToSqlite(full).catch(() => {
        /* silently ignore — ya está en localStorage */
      });
    }
  },

  list(filter: UsageFilter = {}): UsageRecord[] {
    let all = lsRead();
    if (filter.from) all = all.filter((r) => r.ts >= filter.from!);
    if (filter.to) all = all.filter((r) => r.ts <= filter.to!);
    if (filter.providerId) all = all.filter((r) => r.providerId === filter.providerId);
    if (filter.source) all = all.filter((r) => r.source === filter.source);
    if (filter.taskKind) all = all.filter((r) => r.taskKind === filter.taskKind);
    return all;
  },

  summary(filter: UsageFilter = {}): ProviderSummary[] {
    const records = this.list(filter);
    const byProvider = new Map<string, ProviderSummary>();
    for (const r of records) {
      const key = r.providerId;
      const cur = byProvider.get(key) ?? {
        providerId: key,
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
      };
      cur.totalCalls += 1;
      cur.totalInputTokens += r.inputTokens;
      cur.totalOutputTokens += r.outputTokens;
      cur.totalCostUsd += r.costUsd;
      if (r.success) cur.successCount += 1;
      else cur.failureCount += 1;
      byProvider.set(key, cur);
    }
    for (const s of byProvider.values()) {
      s.successRate = s.totalCalls > 0 ? s.successCount / s.totalCalls : 0;
    }
    return Array.from(byProvider.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  },

  dailyBuckets(filter: UsageFilter = {}): DailyBucket[] {
    const records = this.list(filter);
    const byDay = new Map<string, DailyBucket>();
    for (const r of records) {
      const d = new Date(r.ts);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const cur = byDay.get(day) ?? {
        day,
        totalCalls: 0,
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      };
      cur.totalCalls += 1;
      cur.totalCostUsd += r.costUsd;
      cur.totalInputTokens += r.inputTokens;
      cur.totalOutputTokens += r.outputTokens;
      byDay.set(day, cur);
    }
    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  },

  successRateBySource(filter: UsageFilter = {}): { source: string; total: number; success: number; rate: number }[] {
    const records = this.list(filter);
    const bySource = new Map<string, { total: number; success: number }>();
    for (const r of records) {
      const cur = bySource.get(r.source) ?? { total: 0, success: 0 };
      cur.total += 1;
      if (r.success) cur.success += 1;
      bySource.set(r.source, cur);
    }
    return Array.from(bySource.entries()).map(([source, v]) => ({
      source,
      total: v.total,
      success: v.success,
      rate: v.total > 0 ? v.success / v.total : 0,
    }));
  },

  totals(filter: UsageFilter = {}): {
    totalCalls: number;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgSuccessRate: number;
  } {
    const records = this.list(filter);
    if (records.length === 0) {
      return {
        totalCalls: 0,
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        avgSuccessRate: 0,
      };
    }
    const totalCostUsd = records.reduce((s, r) => s + r.costUsd, 0);
    const totalInputTokens = records.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = records.reduce((s, r) => s + r.outputTokens, 0);
    const successCount = records.filter((r) => r.success).length;
    return {
      totalCalls: records.length,
      totalCostUsd,
      totalInputTokens,
      totalOutputTokens,
      avgSuccessRate: successCount / records.length,
    };
  },

  clear(): void {
    lsWrite([]);
  },
};

// ============================================================================
// Persistencia a SQLite (Tauri, best-effort)
// ============================================================================

async function persistToSqlite(rec: UsageRecord): Promise<void> {
  // Crear tabla si no existe.
  await sqlite.shellExec(
    `mkdir -p ~/.weaver && ` +
    `cat > /tmp/weaver_usage_init.sql <<'SQL'
CREATE TABLE IF NOT EXISTS weaver_usage (
  ts INTEGER NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  source TEXT NOT NULL,
  success INTEGER NOT NULL,
  task_kind TEXT,
  elapsed_ms INTEGER
);
SQL
sqlite3 ~/.weaver/weaver.db < /tmp/weaver_usage_init.sql 2>/dev/null || true
rm -f /tmp/weaver_usage_init.sql`,
    undefined,
    5000,
  );

  // Insertar registro.
  const safe = (s: string) => s.replace(/'/g, "''");
  const insert = `INSERT INTO weaver_usage VALUES (${rec.ts}, '${safe(rec.providerId)}', '${safe(rec.model)}', ${rec.inputTokens}, ${rec.outputTokens}, ${rec.costUsd}, '${safe(rec.source)}', ${rec.success ? 1 : 0}, ${rec.taskKind ? `'${safe(rec.taskKind)}'` : 'NULL'}, ${rec.elapsedMs ?? 'NULL'});`;
  await sqlite.shellExec(
    `echo '${insert.replace(/'/g, "'\\''")}' | sqlite3 ~/.weaver/weaver.db 2>/dev/null || true`,
    undefined,
    5000,
  );
}
