/**
 * Buscador de fuentes (pestaña Fuentes del Notebook).
 *
 * Réplica del flujo de NotebookLM: el usuario escribe un tema, elige
 * "Fast Research" (rápida) o "Deep Research" (profunda), ve los resultados
 * como una lista con favicon + título + snippet, selecciona los que quiere
 * (o "Seleccionar todo") y los importa como fuentes reales del notebook con
 * el botón "Importar". El fetch completo del contenido solo ocurre al
 * importar, no al buscar (ver sources.ts urlToSource).
 */

import { useState } from 'react';
import { Search, ChevronDown, Check, Loader2, Link2, Sparkles } from 'lucide-react';
import { searchSources, type SourceSearchResultItem } from '../search';
import { urlToSource, faviconUrl } from '../sources';
import * as store from '../store';
import { cn } from '@/components/common/Button';

/** Solo los 2 modos de búsqueda aplican aquí; "agent" es exclusivo del chat. */
type SourceSearchMode = 'quick_search' | 'deep_research';

const MODE_LABEL: Record<SourceSearchMode, string> = {
  quick_search: 'Fast Research',
  deep_research: 'Deep Research',
};

export function NotebookSourceSearch({ notebookId }: { notebookId: string }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SourceSearchMode>('quick_search');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<SourceSearchResultItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const allSelected = results.length > 0 && selected.size === results.length;

  async function handleSearch() {
    const q = query.trim();
    if (!q || status === 'searching') return;
    setStatus('searching');
    setResults([]);
    setSelected(new Set());
    setErrorMsg(null);

    const run = await searchSources(mode, q);
    if (!run.ok) {
      setStatus('error');
      setErrorMsg(run.error ?? 'No se encontraron resultados.');
      return;
    }
    setResults(run.results);
    setSelected(new Set(run.results.map((r) => r.url)));
    setStatus('done');
  }

  function toggleSelected(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(results.map((r) => r.url)));
  }

  async function handleImport() {
    const toImport = results.filter((r) => selected.has(r.url));
    if (toImport.length === 0) return;
    setImporting(true);
    try {
      // Importa en paralelo: cada una hace su propio web_fetch completo.
      await Promise.all(
        toImport.map(async (r) => {
          const source = await urlToSource(r.url, r.title);
          store.addSource(notebookId, source);
        }),
      );
      // Limpia resultados ya importados de la lista de búsqueda.
      setResults((prev) => prev.filter((r) => !selected.has(r.url)));
      setSelected(new Set());
      if (results.length === toImport.length) setStatus('idle');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-border bg-app-elevated p-3">
      {/* Input + selectores */}
      <div className="flex items-center gap-2 rounded-xl bg-app-panel px-3 py-2">
        <Search size={16} className="shrink-0 text-text-tertiary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Busca un tema para encontrar fuentes…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
        />
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="relative">
          <button
            onClick={() => setModeMenuOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-app-panel px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            {mode === 'deep_research' ? <Sparkles size={13} /> : <Search size={13} />}
            {MODE_LABEL[mode]}
            <ChevronDown size={12} />
          </button>
          {modeMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setModeMenuOpen(false)} />
              <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-app-panel shadow-xl p-1.5">
                <ModeOption
                  icon={<Search size={14} />}
                  label="Fast Research"
                  description="Una búsqueda, resultados inmediatos"
                  active={mode === 'quick_search'}
                  onClick={() => {
                    setMode('quick_search');
                    setModeMenuOpen(false);
                  }}
                />
                <ModeOption
                  icon={<Sparkles size={14} />}
                  label="Deep Research"
                  description="Varias búsquedas relacionadas, más resultados"
                  active={mode === 'deep_research'}
                  onClick={() => {
                    setMode('deep_research');
                    setModeMenuOpen(false);
                  }}
                />
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleSearch}
          disabled={!query.trim() || status === 'searching'}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white disabled:opacity-30"
        >
          {status === 'searching' ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
        </button>
      </div>

      {/* Estado de búsqueda */}
      {status === 'searching' && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-2.5 text-sm text-accent">
          <Loader2 size={14} className="animate-spin" />
          Investigando sitios web…
        </div>
      )}

      {status === 'error' && (
        <div className="mt-3 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-danger">{errorMsg}</div>
      )}

      {/* Resultados */}
      {status === 'done' && results.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between px-1 pb-2">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary"
            >
              <Checkbox checked={allSelected} />
              Seleccionar todo
            </button>
            <span className="text-xs text-text-tertiary">{results.length} resultados</span>
          </div>

          <div className="space-y-1.5">
            {results.map((r) => (
              <button
                key={r.url}
                onClick={() => toggleSelected(r.url)}
                className="flex w-full items-start gap-2.5 rounded-xl bg-app-panel px-3 py-2.5 text-left hover:bg-app-panel/70"
              >
                <Checkbox checked={selected.has(r.url)} className="mt-0.5" />
                <FaviconImg url={r.url} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text-primary">{r.title || r.url}</span>
                  <span className="block truncate text-xs text-text-tertiary">{r.snippet || r.url}</span>
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            Importar {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      )}

      {status === 'done' && results.length === 0 && (
        <div className="mt-3 px-1 text-xs text-text-tertiary">
          Todos los resultados ya fueron importados.
        </div>
      )}
    </div>
  );
}

function Checkbox({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
        checked ? 'border-accent bg-accent text-white' : 'border-border bg-transparent',
        className,
      )}
    >
      {checked && <Check size={11} />}
    </span>
  );
}

function FaviconImg({ url }: { url: string }) {
  const src = faviconUrl(url);
  if (!src) return <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-app-elevated" />;
  return (
    <img
      src={src}
      alt=""
      className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-app-elevated object-contain"
      onError={(e) => {
        (e.target as HTMLImageElement).style.visibility = 'hidden';
      }}
    />
  );
}

function ModeOption({
  icon,
  label,
  description,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-app-elevated',
        active && 'bg-accent/10',
      )}
    >
      <span className={cn('mt-0.5 text-text-tertiary', active && 'text-accent')}>{icon}</span>
      <span className="flex-1">
        <span className={cn('block text-sm', active && 'text-accent font-medium')}>{label}</span>
        <span className="block text-xs text-text-tertiary">{description}</span>
      </span>
      {active && <Check size={14} className="mt-0.5 shrink-0 text-accent" />}
    </button>
  );
}
