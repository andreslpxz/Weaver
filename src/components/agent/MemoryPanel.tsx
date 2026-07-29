/**
 * MemoryPanel — "Esto es lo que Weaver sabe de ti / de tus tareas".
 *
 * El usuario puede:
 *   - Ver todos los facts (memoria semántica) en una tabla editable.
 *   - Editar el valor de cualquier fact en caliente.
 *   - Borrar facts individuales o todos a la vez.
 *   - Ver los episodios (memoria episódica) con su outcome y lecciones.
 *   - Expandir un episodio para ver su plan completo y trace.
 *
 * Esto da control real sobre qué recuerda el agente — clave para la
 * memoria importada de otras IAs, donde se acumula info sensible.
 */

import { useEffect, useState } from 'react';
import {
  Brain, Trash2, Pencil, Check, X, Eye, ChevronDown, ChevronRight, Database, Plus,
} from 'lucide-react';
import { Button, Badge, cn } from '@/components/common/Button';
import { memory } from '@/agent/memory';
import type { Episode, Fact } from '@/agent/types';

type Tab = 'facts' | 'episodes';

export function MemoryPanel() {
  const [tab, setTab] = useState<Tab>('facts');
  const [facts, setFacts] = useState<Fact[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    const [f, e] = await Promise.all([memory.listFacts(), memory.listEpisodes()]);
    setFacts(f.sort((a, b) => b.updatedAt - a.updatedAt));
    setEpisodes(e.sort((a, b) => b.startedAt - a.startedAt));
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <Brain size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">Memoria</h1>
          <span className="text-xs text-text-muted">
            {facts.length} facts · {episodes.length} episodios
          </span>
        </div>
        <div className="flex items-center gap-1">
          <TabBtn active={tab === 'facts'} onClick={() => setTab('facts')}>Facts</TabBtn>
          <TabBtn active={tab === 'episodes'} onClick={() => setTab('episodes')}>Episodios</TabBtn>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {loading ? (
            <div className="text-center text-text-muted text-sm py-12">Cargando…</div>
          ) : tab === 'facts' ? (
            <FactsList facts={facts} onChange={refresh} />
          ) : (
            <EpisodesList episodes={episodes} />
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Facts
// ============================================================================

function FactsList({ facts, onChange }: { facts: Fact[]; onChange: () => void }) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showNew, setShowNew] = useState(false);

  async function saveEdit(key: string) {
    await memory.setFact(key, editValue, 'user');
    setEditingKey(null);
    onChange();
  }

  async function deleteFact(key: string) {
    if (!confirm(`¿Borrar el fact "${key}"?`)) return;
    await memory.deleteFact(key);
    onChange();
  }

  async function clearAll() {
    if (!confirm('¿Borrar TODA la memoria (facts + episodios)? Esta acción no se puede deshacer.')) return;
    await memory.clearAll();
    localStorage.removeItem('weaver:episodes');
    localStorage.removeItem('weaver:facts');
    onChange();
  }

  async function addNew() {
    if (!newKey.trim() || !newValue.trim()) return;
    await memory.setFact(newKey.trim(), newValue.trim(), 'user');
    setNewKey('');
    setNewValue('');
    setShowNew(false);
    onChange();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Memoria semántica</h2>
          <p className="text-xs text-text-muted">
            Hechos que el agente ha aprendido sobre ti y tus tareas. Edita o borra lo que no quieras que recuerde.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowNew(!showNew)}>
            <Plus size={12} /> Nuevo
          </Button>
          <Button variant="danger" onClick={clearAll}>
            <Trash2 size={12} /> Borrar todo
          </Button>
        </div>
      </div>

      {/* Form nuevo fact */}
      {showNew && (
        <div className="codex-card p-3 space-y-2">
          <div className="text-xs font-medium text-text-secondary">Nuevo fact</div>
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Clave (ej: user.name, user.timezone, project.weaver.stack)"
            className="codex-input w-full px-3 py-2 text-sm"
          />
          <textarea
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Valor"
            className="codex-input w-full px-3 py-2 text-sm min-h-[60px] resize-y"
          />
          <div className="flex gap-2 justify-end">
            <Button onClick={() => setShowNew(false)}><X size={12} /> Cancelar</Button>
            <Button variant="primary" onClick={addNew}><Check size={12} /> Guardar</Button>
          </div>
        </div>
      )}

      {/* Lista */}
      {facts.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">
          <Database size={32} className="mx-auto mb-2 opacity-40" />
          No hay facts. El agente irá aprendiendo cosas sobre ti y aparecerán aquí.
        </div>
      ) : (
        <div className="space-y-1.5">
          {facts.map((f) => (
            <div
              key={f.key}
              className="codex-card p-3 hover:border-border-accent transition-colors"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-xs text-accent">{f.key}</code>
                    <Badge color={f.source === 'user' ? 'accent' : f.source === 'agent' ? 'success' : 'default'}>
                      {f.source}
                    </Badge>
                    <span className="text-[10px] text-text-muted">
                      {new Date(f.updatedAt).toLocaleString('es-MX')}
                    </span>
                  </div>
                  {editingKey === f.key ? (
                    <div className="space-y-2">
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="codex-input w-full px-2 py-1.5 text-xs min-h-[60px] resize-y"
                      />
                      <div className="flex gap-2">
                        <Button variant="primary" onClick={() => saveEdit(f.key)}>
                          <Check size={10} /> Guardar
                        </Button>
                        <Button onClick={() => setEditingKey(null)}>
                          <X size={10} /> Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-text-secondary whitespace-pre-wrap">{f.value}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => { setEditingKey(f.key); setEditValue(f.value); }}
                    className="codex-icon-btn"
                    title="Editar"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => deleteFact(f.key)}
                    className="codex-icon-btn text-danger hover:text-danger"
                    title="Borrar"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Episodes
// ============================================================================

function EpisodesList({ episodes }: { episodes: Episode[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">Memoria episódica</h2>
        <p className="text-xs text-text-muted">
          Historial de tareas que el agente ha completado. Cada episodio contiene el plan, los pasos y las lecciones aprendidas.
        </p>
      </div>

      {episodes.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">
          <Database size={32} className="mx-auto mb-2 opacity-40" />
          No hay episodios todavía. Aparecerán aquí cuando completes tareas con el agente.
        </div>
      ) : (
        <div className="space-y-2">
          {episodes.map((e) => {
            const isOpen = expanded.has(e.id);
            return (
              <div key={e.id} className="codex-card p-3">
                <button
                  onClick={() => toggle(e.id)}
                  className="w-full flex items-start gap-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown size={14} className="mt-0.5 shrink-0 text-text-muted" />
                  ) : (
                    <ChevronRight size={14} className="mt-0.5 shrink-0 text-text-muted" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">{e.objective}</span>
                      <OutcomeBadge outcome={e.outcome} />
                    </div>
                    <div className="text-[10px] text-text-muted flex items-center gap-2">
                      <span>{new Date(e.startedAt).toLocaleString('es-MX')}</span>
                      <span>·</span>
                      <span>{e.plan.subtasks.length} subtareas</span>
                      {e.skillGenerated && (
                        <>
                          <span>·</span>
                          <Badge color="accent">skill: {e.skillGenerated}</Badge>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <div className="mt-3 pl-6 space-y-3 text-xs">
                    {/* Subtareas */}
                    <div>
                      <div className="text-text-secondary font-medium mb-1">Subtareas</div>
                      <ul className="space-y-1">
                        {e.plan.subtasks.map((st, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className={
                              st.status === 'succeeded' ? 'text-success' :
                              st.status === 'failed' ? 'text-danger' :
                              st.status === 'skipped' ? 'text-text-muted' :
                              'text-warning'
                            }>
                              {st.status === 'succeeded' ? '✓' :
                               st.status === 'failed' ? '✗' :
                               st.status === 'skipped' ? '⊘' :
                               '•'}
                            </span>
                            <div className="flex-1">
                              <div className="text-text-primary">{st.description}</div>
                              <div className="text-[10px] text-text-muted">
                                Criterio: {st.successCriteria}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Lecciones */}
                    {e.lessons.length > 0 && (
                      <div>
                        <div className="text-text-secondary font-medium mb-1">Lecciones</div>
                        <ul className="space-y-0.5 text-text-secondary">
                          {e.lessons.map((l, i) => (
                            <li key={i}>• {l}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Trace (últimas 5 entradas) */}
                    {e.plan.subtasks.some((st) => st.trace.length > 0) && (
                      <div>
                        <div className="text-text-secondary font-medium mb-1">Trace (resumen)</div>
                        <div className="font-mono text-[10px] text-text-muted bg-app-bg p-2 rounded max-h-32 overflow-y-auto">
                          {e.plan.subtasks
                            .flatMap((st) => st.trace)
                            .slice(-8)
                            .map((t, i) => (
                              <div key={i}>
                                <span className="text-accent">[{t.kind}]</span>{' '}
                                {t.content.slice(0, 100)}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-xs rounded-codex transition-colors',
        active
          ? 'bg-accent/15 text-accent border border-accent/30'
          : 'text-text-secondary hover:bg-app-elevated border border-transparent',
      )}
    >
      {children}
    </button>
  );
}

function OutcomeBadge({ outcome }: { outcome: Episode['outcome'] }) {
  const colors: Record<Episode['outcome'], 'success' | 'danger' | 'warning' | 'default'> = {
    success: 'success',
    failure: 'danger',
    partial: 'warning',
    aborted: 'default',
  };
  return <Badge color={colors[outcome]}>{outcome}</Badge>;
}
