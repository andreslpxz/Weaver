/**
 * MetricsView — Panel de uso y costos.
 *
 * Muestra:
 *   - Totales (llamadas, costo USD, tokens, % éxito) con filtros de rango.
 *   - Desglose por proveedor: llamadas, tokens, costo, % éxito.
 *   - Bucket diario (últimos 30 días): líneas de costo y llamadas.
 *   - Success rate por fuente (chat / subagent:X / planner).
 *
 * Es la base de datos para el futuro "WeaverBench" y le da al usuario
 * visibilidad real sobre cuánto cuesta cada tarea.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Coins, TrendingUp, CheckCircle2, Activity, Trash2,
} from 'lucide-react';
import { Button, Badge, cn } from '@/components/common/Button';
import { metrics, type ProviderSummary, type DailyBucket } from '@/lib/metrics';

type Range = '7d' | '30d' | '90d' | 'all';

export function MetricsView() {
  const [range, setRange] = useState<Range>('30d');
  const [tick, setTick] = useState(0); // fuerza re-render tras clear

  const filter = useMemo(() => {
    if (range === 'all') return {};
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    return { from: Date.now() - days * 24 * 60 * 60 * 1000 };
  }, [range]);

  const totals = useMemo(() => metrics.totals(filter), [filter, tick]);
  const byProvider = useMemo(() => metrics.summary(filter), [filter, tick]);
  const daily = useMemo(() => metrics.dailyBuckets(filter), [filter, tick]);
  const bySource = useMemo(() => metrics.successRateBySource(filter), [filter, tick]);

  function clearAll() {
    if (!confirm('¿Borrar TODOS los registros de uso? No se puede deshacer.')) return;
    metrics.clear();
    setTick((t) => t + 1);
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <BarChart3 size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Métricas</h1>
          <span className="text-xs text-text-muted">Uso y costos por proveedor</span>
        </div>
        <div className="flex items-center gap-1">
          {(['7d', '30d', '90d', 'all'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                'px-2.5 py-1 text-[11px] rounded-codex transition-colors',
                range === r
                  ? 'bg-accent/15 text-accent border border-accent/30'
                  : 'text-text-secondary hover:bg-app-elevated border border-transparent',
              )}
            >
              {r === 'all' ? 'Todo' : r}
            </button>
          ))}
          <Button variant="danger" onClick={clearAll} className="ml-2">
            <Trash2 size={12} />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-6">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard
              icon={<Activity size={14} />}
              label="Llamadas"
              value={totals.totalCalls.toString()}
            />
            <KpiCard
              icon={<Coins size={14} />}
              label="Costo total"
              value={`$${totals.totalCostUsd.toFixed(4)}`}
            />
            <KpiCard
              icon={<TrendingUp size={14} />}
              label="Tokens"
              value={formatTokens(totals.totalInputTokens + totals.totalOutputTokens)}
              sub={`${formatTokens(totals.totalInputTokens)} in / ${formatTokens(totals.totalOutputTokens)} out`}
            />
            <KpiCard
              icon={<CheckCircle2 size={14} />}
              label="% Éxito"
              value={`${(totals.avgSuccessRate * 100).toFixed(1)}%`}
              sub={`${totals.totalCalls > 0 ? Math.round(totals.avgSuccessRate * totals.totalCalls) : 0}/${totals.totalCalls}`}
            />
          </div>

          {/* Por proveedor */}
          <Section title="Por proveedor" desc="Desglose agregado por proveedor IA.">
            {byProvider.length === 0 ? (
              <EmptyState text="Sin datos para este rango." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted border-b border-border">
                      <th className="text-left py-2 px-2">Proveedor</th>
                      <th className="text-right py-2 px-2">Llamadas</th>
                      <th className="text-right py-2 px-2">Tokens (in/out)</th>
                      <th className="text-right py-2 px-2">Costo USD</th>
                      <th className="text-right py-2 px-2">% Éxito</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byProvider.map((p) => (
                      <ProviderRow key={p.providerId} p={p} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* Bucket diario */}
          <Section title="Uso diario" desc="Costo y llamadas por día.">
            {daily.length === 0 ? (
              <EmptyState text="Sin datos para este rango." />
            ) : (
              <DailyChart buckets={daily} />
            )}
          </Section>

          {/* Success rate por fuente */}
          <Section title="% Éxito por fuente" desc="Tasa de éxito por origen (chat, subagentes, planner, etc.).">
            {bySource.length === 0 ? (
              <EmptyState text="Sin datos para este rango." />
            ) : (
              <div className="space-y-1.5">
                {bySource
                  .sort((a, b) => b.total - a.total)
                  .map((s) => (
                    <div key={s.source} className="flex items-center gap-3 text-xs">
                      <code className="text-accent w-48 truncate">{s.source}</code>
                      <div className="flex-1 h-4 bg-app-bg rounded overflow-hidden border border-border">
                        <div
                          className={cn(
                            'h-full transition-all',
                            s.rate >= 0.8 ? 'bg-success' :
                            s.rate >= 0.5 ? 'bg-warning' : 'bg-danger',
                          )}
                          style={{ width: `${s.rate * 100}%` }}
                        />
                      </div>
                      <span className="text-text-secondary w-20 text-right">
                        {s.success}/{s.total}
                      </span>
                      <span className="text-text-muted w-12 text-right">
                        {(s.rate * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </Section>

          {/* Nota */}
          <div className="text-[10px] text-text-muted border border-border rounded-codex p-3 bg-app-bg/50">
            Los precios son estimaciones basadas en tarifas públicas (julio 2025) y pueden no reflejar
            costos exactos (descuentos por volumen, caching, rate tiers). Los registros se guardan
            localmente en <code>localStorage</code> (últimos 1000). En modo Tauri también se intentan
            persistir en <code>~/.weaver/weaver.db</code> (tabla <code>weaver_usage</code>).
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-componentes
// ============================================================================

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="codex-card p-3">
      <div className="flex items-center gap-1.5 text-text-muted text-[10px] mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-medium">{value}</div>
      {sub && <div className="text-[10px] text-text-muted">{sub}</div>}
    </div>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {desc && <span className="text-xs text-text-muted">{desc}</span>}
      </div>
      {children}
    </div>
  );
}

function ProviderRow({ p }: { p: ProviderSummary }) {
  const rateColor = p.successRate >= 0.8 ? 'success' : p.successRate >= 0.5 ? 'warning' : 'danger';
  return (
    <tr className="border-b border-border/50 hover:bg-app-bg/40">
      <td className="py-2 px-2">
        <span className="font-medium">{p.providerId}</span>
      </td>
      <td className="text-right py-2 px-2">{p.totalCalls}</td>
      <td className="text-right py-2 px-2 text-text-muted">
        {formatTokens(p.totalInputTokens)} / {formatTokens(p.totalOutputTokens)}
      </td>
      <td className="text-right py-2 px-2 font-mono">${p.totalCostUsd.toFixed(4)}</td>
      <td className="text-right py-2 px-2">
        <Badge color={rateColor}>{(p.successRate * 100).toFixed(0)}%</Badge>
      </td>
    </tr>
  );
}

function DailyChart({ buckets }: { buckets: DailyBucket[] }) {
  const maxCost = Math.max(...buckets.map((b) => b.totalCostUsd), 0.01);
  const maxCalls = Math.max(...buckets.map((b) => b.totalCalls), 1);
  return (
    <div className="space-y-1">
      {buckets.slice(-30).map((b) => (
        <div key={b.day} className="flex items-center gap-2 text-[10px]">
          <span className="text-text-muted w-20">{b.day}</span>
          <div className="flex-1 h-4 bg-app-bg rounded overflow-hidden border border-border relative">
            <div
              className="h-full bg-accent/60 transition-all"
              style={{ width: `${(b.totalCostUsd / maxCost) * 100}%` }}
              title={`$${b.totalCostUsd.toFixed(4)}`}
            />
          </div>
          <span className="text-text-secondary w-16 text-right font-mono">${b.totalCostUsd.toFixed(4)}</span>
          <span className="text-text-muted w-12 text-right">{b.totalCalls} calls</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="text-center py-8 text-text-muted text-sm">{text}</div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}
