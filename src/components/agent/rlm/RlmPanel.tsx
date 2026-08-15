/**
 * RLM-UI — RlmPanel.
 *
 * Vista principal del modo RLM. Muestra:
 *   - Toggle on/off del modo RLM
 *   - Estado de los límites (maxDepth, maxTotalChildren, etc.)
 *   - Árbol de recursión (subagentes spawneados)
 *   - ContextStore (fragmentos guardados)
 *   - Último /refine (acciones propuestas/aplicadas)
 *
 * Se accede desde el sidebar (icono Brain/Network).
 */

import { useEffect, useState } from 'react';
import { Network, Power, RefreshCw, RotateCcw, Activity } from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import { RecursionTreeView } from './RecursionTreeView';
import { ContextStorePanel } from './ContextStorePanel';
import type { SpawnInfo, SpawnResult, ContextFragment, RefineResult } from '@/agent/rlm';

interface RlmState {
  enabled: boolean;
  spawns: SpawnInfo[];
  results: Record<string, SpawnResult>;
  fragments: ContextFragment[];
  totalFragmentSize: number;
  lastRefine?: RefineResult;
  limits: {
    maxDepth: number;
    maxTotalChildren: number;
    maxConcurrentChildren: number;
    maxTotalTimeMs: number;
  };
}

const DEFAULT_LIMITS = {
  maxDepth: 3,
  maxTotalChildren: 50,
  maxConcurrentChildren: 5,
  maxTotalTimeMs: 600_000,
};

export function RlmPanel() {
  const setView = useWeaver((s) => s.setView);
  const [state, setState] = useState<RlmState>({
    enabled: false,
    spawns: [],
    results: {},
    fragments: [],
    totalFragmentSize: 0,
    limits: DEFAULT_LIMITS,
  });

  // Escuchar eventos RLM globales.
  useEffect(() => {
    function handleRlmSpawn(e: Event) {
      const info = (e as CustomEvent<SpawnInfo>).detail;
      setState((s) => ({ ...s, spawns: [...s.spawns, info] }));
    }
    function handleRlmResult(e: Event) {
      const result = (e as CustomEvent<SpawnResult>).detail;
      setState((s) => ({
        ...s,
        results: { ...s.results, [result.childId]: result },
      }));
    }
    function handleRlmContextUpdate(e: Event) {
      const detail = (e as CustomEvent<{ fragments: ContextFragment[]; totalSize: number }>).detail;
      setState((s) => ({
        ...s,
        fragments: detail.fragments,
        totalFragmentSize: detail.totalSize,
      }));
    }
    function handleRlmToggle(e: Event) {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail;
      setState((s) => ({ ...s, enabled: detail.enabled }));
    }
    function handleRlmRefine(e: Event) {
      const detail = (e as CustomEvent<RefineResult>).detail;
      setState((s) => ({ ...s, lastRefine: detail }));
    }
    function handleRlmClear() {
      setState((s) => ({
        ...s,
        spawns: [],
        results: {},
        fragments: [],
        totalFragmentSize: 0,
      }));
    }

    window.addEventListener('weaver:rlm-spawn', handleRlmSpawn as EventListener);
    window.addEventListener('weaver:rlm-result', handleRlmResult as EventListener);
    window.addEventListener('weaver:rlm-context-updated', handleRlmContextUpdate as EventListener);
    window.addEventListener('weaver:rlm-toggle', handleRlmToggle as EventListener);
    window.addEventListener('weaver:rlm-refine', handleRlmRefine as EventListener);
    window.addEventListener('weaver:rlm-clear', handleRlmClear as EventListener);

    return () => {
      window.removeEventListener('weaver:rlm-spawn', handleRlmSpawn as EventListener);
      window.removeEventListener('weaver:rlm-result', handleRlmResult as EventListener);
      window.removeEventListener('weaver:rlm-context-updated', handleRlmContextUpdate as EventListener);
      window.removeEventListener('weaver:rlm-toggle', handleRlmToggle as EventListener);
      window.removeEventListener('weaver:rlm-refine', handleRlmRefine as EventListener);
      window.removeEventListener('weaver:rlm-clear', handleRlmClear as EventListener);
    };
  }, []);

  function toggleRlm() {
    const newEnabled = !state.enabled;
    window.dispatchEvent(new CustomEvent('weaver:rlm-toggle-requested', {
      detail: { enabled: newEnabled },
    }));
    setState((s) => ({ ...s, enabled: newEnabled }));
  }

  function clearAll() {
    window.dispatchEvent(new CustomEvent('weaver:rlm-clear'));
  }

  function revertRefine() {
    if (!state.lastRefine?.snapshot) return;
    window.dispatchEvent(new CustomEvent('weaver:rlm-refine-revert', {
      detail: { snapshot: state.lastRefine.snapshot },
    }));
    setState((s) => ({ ...s, lastRefine: undefined }));
  }

  function deleteFragment(key: string) {
    window.dispatchEvent(new CustomEvent('weaver:rlm-fragment-delete', {
      detail: { key },
    }));
    setState((s) => ({
      ...s,
      fragments: s.fragments.filter((f) => f.key !== key),
      totalFragmentSize: s.fragments.filter((f) => f.key !== key).reduce((sum, f) => sum + f.size, 0),
    }));
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-medium flex items-center gap-2">
            <Network size={22} className="text-accent" /> RLM Agent
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setView('chat')}
              className="codex-icon-btn w-7 h-7"
              title="Volver al chat"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>

        <p className="text-text-secondary text-sm">
          Recursive Language Model: el agente trata el contexto como variable, no como ventana que se satura.
          Delega subtareas a subagentes con ventanas limpias y auto-refina su scaffolding.
        </p>

        {/* Toggle + limits */}
        <div className="codex-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Power size={16} className={state.enabled ? 'text-success' : 'text-text-muted'} />
              <span className="text-sm font-medium">
                Modo RLM {state.enabled ? 'activado' : 'desactivado'}
              </span>
            </div>
            <button
              onClick={toggleRlm}
              className={`codex-icon-btn w-10 h-6 rounded-full relative transition-colors ${state.enabled ? 'bg-success/30' : 'bg-app-input'}`}
              title={state.enabled ? 'Desactivar RLM' : 'Activar RLM'}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-accent transition-transform ${state.enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
              />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="flex items-center justify-between p-2 bg-app-sidebar/50 rounded-codex">
              <span className="text-text-muted">Max depth</span>
              <span className="font-mono text-text-primary">{state.limits.maxDepth}</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-app-sidebar/50 rounded-codex">
              <span className="text-text-muted">Max children</span>
              <span className="font-mono text-text-primary">{state.limits.maxTotalChildren}</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-app-sidebar/50 rounded-codex">
              <span className="text-text-muted">Max concurrent</span>
              <span className="font-mono text-text-primary">{state.limits.maxConcurrentChildren}</span>
            </div>
            <div className="flex items-center justify-between p-2 bg-app-sidebar/50 rounded-codex">
              <span className="text-text-muted">Max time</span>
              <span className="font-mono text-text-primary">{(state.limits.maxTotalTimeMs / 1000 / 60).toFixed(0)} min</span>
            </div>
          </div>

          <div className="text-[10px] text-text-muted">
            Usa <code className="text-accent">/rlm on</code> y <code className="text-accent">/rlm off</code> en el composer para togglear.
          </div>
        </div>

        {/* Recursion tree */}
        <div className="codex-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-accent" />
            <h2 className="text-sm font-medium">Árbol de recursión</h2>
            {state.spawns.length > 0 && (
              <button onClick={clearAll} className="codex-icon-btn w-5 h-5 ml-auto" title="Limpiar">
                <RefreshCw size={10} />
              </button>
            )}
          </div>
          <RecursionTreeView spawns={state.spawns} results={state.results} />
        </div>

        {/* Context store */}
        <div className="codex-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Network size={14} className="text-accent" />
            <h2 className="text-sm font-medium">ContextStore</h2>
          </div>
          <ContextStorePanel
            fragments={state.fragments}
            totalSize={state.totalFragmentSize}
            onClear={() => {
              window.dispatchEvent(new CustomEvent('weaver:rlm-context-clear'));
              setState((s) => ({ ...s, fragments: [], totalFragmentSize: 0 }));
            }}
            onDelete={deleteFragment}
          />
        </div>

        {/* Last refine */}
        {state.lastRefine && (
          <div className="codex-card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <RefreshCw size={14} className="text-accent" />
                <h2 className="text-sm font-medium">Último /refine</h2>
              </div>
              {state.lastRefine.applied && state.lastRefine.snapshot && (
                <button
                  onClick={revertRefine}
                  className="codex-icon-btn w-6 h-6"
                  title="Revertir al snapshot anterior"
                >
                  <RotateCcw size={11} className="text-warning" />
                </button>
              )}
            </div>
            <p className="text-xs text-text-secondary mb-2">{state.lastRefine.summary}</p>
            <div className="space-y-2">
              {state.lastRefine.actions.map((action, i) => (
                <div key={i} className="text-xs border border-border rounded-codex p-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-accent text-[10px]">{action.type}</span>
                    <span className="text-text-muted">→</span>
                    <span className="font-medium">{action.target}</span>
                    {state.lastRefine?.applied && (
                      <span className="text-success text-[10px]">applied</span>
                    )}
                  </div>
                  <div className="text-text-secondary">{action.description}</div>
                  <div className="text-text-muted text-[10px] mt-1">Razón: {action.rationale}</div>
                  {action.expectedImprovement && (
                    <div className="text-accent text-[10px] mt-0.5">Esperado: {action.expectedImprovement}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Help */}
        <div className="codex-card p-4">
          <h2 className="text-sm font-medium mb-2">Comandos</h2>
          <div className="space-y-1 text-xs text-text-secondary">
            <div><code className="text-accent">/rlm on</code> / <code className="text-accent">/rlm off</code> — Activar/desactivar modo RLM</div>
            <div><code className="text-accent">/refine</code> — Proponer cambios al scaffolding</div>
            <div><code className="text-accent">/refine auto</code> — Aplicar cambios automáticamente</div>
            <div><code className="text-accent">/refine revert</code> — Revertir al snapshot anterior</div>
            <div><code className="text-accent">/ctx list</code> — Listar fragmentos del ContextStore</div>
            <div><code className="text-accent">/ctx clear</code> — Limpiar ContextStore</div>
            <div><code className="text-accent">/ctx get &lt;key&gt;</code> — Ver contenido de un fragmento</div>
            <div><code className="text-accent">/help</code> — Mostrar ayuda completa</div>
          </div>
        </div>
      </div>
    </div>
  );
}
