/**
 * RLM-UI — RecursionTreeView.
 *
 * Muestra el árbol de subagentes spawneados durante una ejecución RLM.
 * Cada nodo muestra:
 *   - Nombre del subagente
 *   - Status (succeeded/failed/timeout/...)
 *   - Profundidad
 *   - Tokens usados
 *   - Tiempo transcurrido
 *
 * Los hijos se indentan según su depth.
 */

import { memo } from 'react';
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Ban,
  Loader2,
} from 'lucide-react';
import type { SpawnInfo, SpawnResult } from '@/agent/rlm';

interface RecursionTreeViewProps {
  spawns: SpawnInfo[];
  results: Record<string, SpawnResult>;
}

const STATUS_META: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
  succeeded: { icon: CheckCircle2, color: '#22c55e', label: 'Success' },
  failed: { icon: XCircle, color: '#ef4444', label: 'Failed' },
  stuck: { icon: AlertTriangle, color: '#f59e0b', label: 'Stuck' },
  timeout: { icon: Clock, color: '#f59e0b', label: 'Timeout' },
  budget_exceeded: { icon: Clock, color: '#f59e0b', label: 'Budget' },
  depth_exceeded: { icon: Ban, color: '#94a3b8', label: 'Depth' },
  total_limit_exceeded: { icon: Ban, color: '#94a3b8', label: 'Limit' },
  cancelled: { icon: Ban, color: '#94a3b8', label: 'Cancelled' },
  pending: { icon: Loader2, color: '#3b82f6', label: 'Running' },
};

export const RecursionTreeView = memo(function RecursionTreeView({
  spawns,
  results,
}: RecursionTreeViewProps) {
  if (spawns.length === 0) {
    return (
      <div className="text-xs text-text-muted p-3 border border-dashed border-border rounded-codex text-center">
        Sin subagentes spawneados. El modo RLM delegará automáticamente cuando el agente lo decida.
      </div>
    );
  }

  // Calcular totales.
  const totalTokens = Object.values(results).reduce(
    (sum, r) => sum + (r.usage?.inputTokens ?? 0) + (r.usage?.outputTokens ?? 0),
    0,
  );
  const totalMs = Object.values(results).reduce(
    (sum, r) => sum + (r.usage?.elapsedMs ?? 0),
    0,
  );
  const succeeded = Object.values(results).filter((r) => r.status === 'succeeded').length;
  const failed = Object.values(results).filter((r) =>
    ['failed', 'stuck', 'timeout', 'budget_exceeded', 'depth_exceeded', 'total_limit_exceeded', 'cancelled'].includes(r.status),
  ).length;

  return (
    <div className="space-y-2">
      {/* Resumen */}
      <div className="flex items-center gap-3 text-xs text-text-secondary px-1">
        <span className="text-success">{succeeded} OK</span>
        {failed > 0 && <span className="text-danger">{failed} fail</span>}
        <span className="text-text-muted">·</span>
        <span>{spawns.length} hijos</span>
        <span className="text-text-muted">·</span>
        <span>{(totalTokens / 1000).toFixed(1)}k tokens</span>
        <span className="text-text-muted">·</span>
        <span>{(totalMs / 1000).toFixed(1)}s</span>
      </div>

      {/* Lista de spawns indentada por depth */}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {spawns.map((spawn, idx) => {
          const result = results[spawn.childId];
          const status = (result?.status ?? 'pending') as string;
          const meta = STATUS_META[status] ?? STATUS_META.pending;
          const Icon = meta.icon;
          const indent = spawn.depth * 20;
          return (
            <div
              key={spawn.childId}
              className="flex items-start gap-2 text-xs py-1 px-2 rounded-codex hover:bg-app-input/30"
              style={{ paddingLeft: `${8 + indent}px` }}
            >
              <ChevronRight size={12} className="text-text-muted shrink-0 mt-0.5" />
              <Icon
                size={12}
                className={`shrink-0 mt-0.5 ${status === 'pending' ? 'animate-spin' : ''}`}
                style={{ color: meta.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary truncate">{spawn.subagentName}</span>
                  <span className="text-text-muted">#{idx + 1}</span>
                  <span className="text-text-muted">·</span>
                  <span className="text-text-muted">depth {spawn.depth}</span>
                </div>
                <div className="text-text-muted truncate" title={spawn.objective}>
                  {spawn.objective}
                </div>
                {result?.usage && (
                  <div className="text-[10px] text-text-muted mt-0.5 flex items-center gap-2">
                    <span>{result.usage.steps} steps</span>
                    <span>·</span>
                    <span>{((result.usage.inputTokens + result.usage.outputTokens) / 1000).toFixed(1)}k tok</span>
                    <span>·</span>
                    <span>{(result.usage.elapsedMs / 1000).toFixed(1)}s</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
