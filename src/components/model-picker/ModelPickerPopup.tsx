import { useEffect, useState, useMemo } from 'react';
import { Search, Check, AlertCircle, X, ExternalLink, Trash2, KeyRound, RefreshCw, Eye, DollarSign, Wrench, Zap, Gift } from 'lucide-react';
import { PROVIDERS, getProvider } from '@/providers/registry';
import { useWeaver } from '@/store/weaver';
import { apiKeyStore, maskKey } from '@/providers/store';
import { keyring } from '@/lib/tauri';
import type { ModelInfo, ProviderId } from '@/providers/types';
import { fetchProviderModels } from '@/providers/provider-models';
import { formatContextWindow, formatPricing, getOpenRouterCacheTimestamp } from '@/providers/openrouter-models';
import { cn, Badge } from '@/components/common/Button';

export function ModelPickerPopup({ onClose }: { onClose: () => void }) {
  const {
    providerId,
    modelId,
    setProvider,
    setModel,
    providersWithKey,
    refreshProvidersWithKey,
  } = useWeaver();

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'models' | 'api-keys'>('models');
  const [editingKey, setEditingKey] = useState<ProviderId | null>(null);
  const [keyInput, setInput] = useState('');
  const [keyStatus, setKeyStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  // Modelos remotos por proveedor (fetch en tiempo real).
  const [remoteModels, setRemoteModels] = useState<Record<string, ModelInfo[]>>({});
  const [refreshing, setRefreshing] = useState<ProviderId | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  // Filtro "Solo free": muestra sólo modelos gratuitos a través de todos los
  // proveedores. Útil porque OpenRouter tiene 300+ modelos y los free son
  // difíciles de encontrar sin este filtro.
  const [freeOnly, setFreeOnly] = useState(false);
  // Límite de modelos por proveedor cuando no hay búsqueda activa.
  // OpenRouter solo tiene ~50 free y 250+ paid — si los mostramos todos,
  // el popup se hace infinito. Con scroll, mostramos más.
  const [providerLimits, setProviderLimits] = useState<Record<string, number>>({});
  const DEFAULT_MODEL_LIMIT = 12;

  useEffect(() => {
    refreshProvidersWithKey();
    // Cargar timestamp del cache de OpenRouter al abrir.
    setLastUpdate(getOpenRouterCacheTimestamp());
  }, [refreshProvidersWithKey]);

  // Cargar estado de API keys
  useEffect(() => {
    Promise.all(
      PROVIDERS.map(async (p) => {
        const r = await keyring.getApiKey(p.id).catch(() => null);
        return [p.id, r?.has_key ?? false] as const;
      }),
    ).then((entries) => setHasKey(Object.fromEntries(entries)));
  }, [tab]);

  // Auto-cargar modelos remotos para proveedores públicos al abrir
  // (OpenRouter = 343 modelos públicos, Ollama = modelos locales instalados).
  useEffect(() => {
    if (tab !== 'models') return;
    // OpenRouter: público, sin auth.
    if (!remoteModels['openrouter']) {
      refreshProviderModels('openrouter');
    }
    // Ollama: local, sin auth (http://localhost:11434/api/tags).
    if (!remoteModels['ollama']) {
      refreshProviderModels('ollama');
    }
    // Cerebras: tiene endpoint público sin auth.
    if (!remoteModels['cerebras']) {
      refreshProviderModels('cerebras');
    }
  }, [tab]);

  async function refreshProviderModels(pid: ProviderId) {
    setRefreshing(pid);
    try {
      const models = await fetchProviderModels(pid);
      setRemoteModels((prev) => ({ ...prev, [pid]: models }));
      setLastUpdate(new Date());
    } catch (e) {
      console.warn(`[model-picker] refresh falló para ${pid}:`, e);
    } finally {
      setRefreshing(null);
    }
  }

  /** Obtiene los modelos a mostrar para un proveedor: remotos si hay, si no los curados. */
  function getModelsForProvider(pid: ProviderId): ModelInfo[] {
    return remoteModels[pid] ?? getProvider(pid)?.models ?? [];
  }

  /**
   * Filtra los modelos de un proveedor según:
   *   - query de búsqueda (matchea en id o label)
   *   - filtro "Solo free" (sólo modelos con isFree=true)
   *   - límite de visualización (DEFAULT_MODEL_LIMIT, ampliable con "Ver más")
   *
   * ANTES: la búsqueda sólo filtraba por nombre/desc del proveedor. Si el
   * usuario buscaba "free" o "llama", no matcheaba nada porque ningún
   * proveedor se llama así. Ahora la búsqueda filtra dentro de cada
   * proveedor los modelos cuyos id/label coinciden.
   */
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    // Primero filtrar proveedores por nombre/desc (comportamiento original).
    let providers = PROVIDERS;
    if (q) {
      // Si la query matchea el proveedor, mostrarlo con TODOS sus modelos.
      // Si no matchea el proveedor pero sí algún modelo, también mostrarlo
      // (sólo con los modelos que matchean).
      providers = PROVIDERS.filter((p) => {
        const matchesProvider =
          p.label.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q);
        if (matchesProvider) return true;
        // Verificar si algún modelo del proveedor matchea.
        const models = getModelsForProvider(p.id);
        return models.some(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.label.toLowerCase().includes(q) ||
            (m.isFree && ('free'.includes(q) || 'gratis'.includes(q))),
        );
      });
    }
    return providers;
  }, [query, remoteModels]);

  /** Devuelve los modelos filtrados + limitados para un proveedor dado. */
  function getDisplayedModels(pid: ProviderId): { models: ModelInfo[]; total: number; hidden: number } {
    let models = getModelsForProvider(pid);
    const q = query.toLowerCase().trim();

    // Filtro "Solo free": sólo modelos gratuitos.
    if (freeOnly) {
      models = models.filter((m) => m.isFree);
    }

    // Si la query no matchea el proveedor, filtrar modelos que matcheen la query.
    if (q) {
      const provider = getProvider(pid);
      const matchesProvider =
        provider &&
        (provider.label.toLowerCase().includes(q) ||
          provider.desc.toLowerCase().includes(q));
      if (!matchesProvider) {
        models = models.filter(
          (m) =>
            m.id.toLowerCase().includes(q) ||
            m.label.toLowerCase().includes(q) ||
            (m.isFree && ('free'.includes(q) || 'gratis'.includes(q))),
        );
      }
    }

    const total = models.length;
    const limit = providerLimits[pid] ?? (q || freeOnly ? total : DEFAULT_MODEL_LIMIT);
    const visible = models.slice(0, limit);
    return { models: visible, total, hidden: total - visible.length };
  }

  const activeProvider = getProvider(providerId)!;

  async function saveKey() {
    if (!editingKey) return;
    try {
      await apiKeyStore.set(editingKey, keyInput);
      const test = await apiKeyStore.test(editingKey, keyInput);
      setKeyStatus(test);
      if (test.ok) {
        setHasKey((h) => ({ ...h, [editingKey]: true }));
        refreshProvidersWithKey();
      }
    } catch (e) {
      setKeyStatus({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }

  async function deleteKey(pid: ProviderId) {
    await apiKeyStore.delete(pid);
    setHasKey((h) => ({ ...h, [pid]: false }));
    refreshProvidersWithKey();
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 animate-fade-in"
        onClick={onClose}
      />

      {/* Popup */}
      <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 w-[min(720px,90vw)] h-[min(520px,80vh)] bg-app-elevated border border-border-accent rounded-codex shadow-2xl flex flex-col animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setTab('models')}
              className={cn(
                'px-3 py-1.5 text-sm rounded-codex transition-colors',
                tab === 'models'
                  ? 'bg-app-input text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              Modelos
            </button>
            <button
              onClick={() => setTab('api-keys')}
              className={cn(
                'px-3 py-1.5 text-sm rounded-codex transition-colors',
                tab === 'api-keys'
                  ? 'bg-app-input text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              API Keys
              <span className="ml-1 text-xs text-text-muted">
                ({Object.values(hasKey).filter(Boolean).length}/{PROVIDERS.length})
              </span>
            </button>
          </div>
          <button onClick={onClose} className="codex-icon-btn">
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border space-y-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'models' ? 'Buscar modelo, proveedor o "free"…' : 'Buscar proveedor…'}
              className="codex-input w-full pl-9 pr-3 py-2 text-sm"
              autoFocus
            />
          </div>
          {tab === 'models' && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setFreeOnly((v) => !v)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-codex text-[11px] transition-colors border',
                  freeOnly
                    ? 'bg-success/15 text-success border-success/40'
                    : 'bg-app-input text-text-secondary border-border hover:border-border-accent',
                )}
                title="Mostrar sólo modelos gratuitos (OpenRouter :free y modelos locales)"
              >
                <Gift size={11} />
                Solo free
              </button>
              {freeOnly && (
                <span className="text-[10px] text-text-muted">
                  Mostrando sólo modelos gratuitos
                </span>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'models' ? (
            <div className="space-y-4">
              {/* Banner de actualización con botón refresh */}
              <div className="flex items-center justify-between px-2 py-1.5 text-[10px] text-text-muted">
                <span>
                  {lastUpdate
                    ? `Actualizado: ${lastUpdate.toLocaleTimeString()}`
                    : 'Sin datos remotos aún'}
                </span>
                <button
                  onClick={() => refreshProviderModels('openrouter')}
                  disabled={refreshing === 'openrouter'}
                  className="inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-50"
                  title="Refrescar catálogo de modelos desde OpenRouter"
                >
                  <RefreshCw size={10} className={refreshing === 'openrouter' ? 'animate-spin' : ''} />
                  Actualizar modelos
                </button>
              </div>

              {filtered.length === 0 && (
                <div className="text-center py-8 text-text-muted text-sm">
                  No se encontraron modelos para "{query}"
                  {freeOnly && ' con filtro "Solo free" activo'}
                </div>
              )}

              {filtered.map((p) => {
                const isActive = p.id === providerId;
                const hasApiKey = p.noApiKey || hasKey[p.id];
                const { models: visibleModels, total, hidden } = getDisplayedModels(p.id);
                const isRemote = !!remoteModels[p.id];
                if (total === 0) return null; // no mostrar proveedor sin modelos tras filtro
                return (
                  <div key={p.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-text-primary">{p.label}</span>
                      <span className="text-xs text-text-muted">{p.desc}</span>
                      <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded-codex bg-app-input">
                        {total}
                      </span>
                      {p.noApiKey && <Badge color="accent">local</Badge>}
                      {hasApiKey && !p.noApiKey && (
                        <Badge color="success">
                          <Check size={10} /> key
                        </Badge>
                      )}
                      {!hasApiKey && !p.noApiKey && (
                        <Badge color="warning">
                          <AlertCircle size={10} /> sin key
                        </Badge>
                      )}
                      {isRemote && (
                        <button
                          onClick={() => refreshProviderModels(p.id)}
                          disabled={refreshing === p.id}
                          className="ml-auto codex-icon-btn w-5 h-5"
                          title="Refrescar modelos de este proveedor"
                        >
                          <RefreshCw size={9} className={refreshing === p.id ? 'animate-spin' : ''} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {visibleModels.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setProvider(p.id);
                            setModel(m.id);
                            if (!p.noApiKey && !hasKey[p.id]) {
                              setTab('api-keys');
                              setEditingKey(p.id);
                            } else {
                              onClose();
                            }
                          }}
                          className={cn(
                            'text-left px-2 py-1.5 rounded-codex text-xs transition-colors',
                            'hover:bg-app-input',
                            isActive && m.id === modelId
                              ? 'bg-accent/15 text-accent border border-accent/30'
                              : 'text-text-secondary border border-transparent',
                          )}
                          title={`${m.contextWindow.toLocaleString()} tokens${m.pricing?.prompt ? ` · $${m.pricing.prompt}/tok` : ''}`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium truncate">{m.label}</span>
                            {m.isFree ? (
                              <Badge color="success">
                                <Gift size={9} /> FREE
                              </Badge>
                            ) : m.isReasoning ? (
                              <Badge color="default">reasoning</Badge>
                            ) : null}
                          </div>
                          {/* Badges de metadata */}
                          <div className="flex flex-wrap items-center gap-1 mt-0.5">
                            <span className="text-[9px] text-text-muted flex items-center gap-0.5">
                              <Zap size={8} /> {formatContextWindow(m.contextWindow)}
                            </span>
                            {m.supportsTools && (
                              <span className="text-[9px] text-accent flex items-center gap-0.5" title="Soporta function calling / tools">
                                <Wrench size={8} /> tools
                              </span>
                            )}
                            {m.supportsVision && (
                              <span className="text-[9px] text-warning flex items-center gap-0.5" title="Soporta imágenes / visión">
                                <Eye size={8} /> vision
                              </span>
                            )}
                            {!m.isFree && m.pricing?.prompt !== undefined && (
                              <span className="text-[9px] text-text-muted flex items-center gap-0.5" title="Precio por millón de tokens">
                                <DollarSign size={8} /> {formatPricing(m.pricing.prompt)}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                    {hidden > 0 && (
                      <button
                        onClick={() =>
                          setProviderLimits((prev) => ({
                            ...prev,
                            [p.id]: (prev[p.id] ?? DEFAULT_MODEL_LIMIT) + 24,
                          }))
                        }
                        className="mt-1.5 w-full text-center text-[11px] text-accent hover:underline py-1"
                      >
                        Ver {hidden} modelo{hidden === 1 ? '' : 's'} más de {p.label}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {editingKey ? (
                <div className="border border-border-accent rounded-codex p-3 bg-app-input">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <KeyRound size={14} className="text-accent" />
                      <span className="font-medium">{getProvider(editingKey)?.label}</span>
                    </div>
                    <button
                      onClick={() => {
                        setEditingKey(null);
                        setKeyStatus(null);
                        setInput('');
                      }}
                      className="codex-icon-btn"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Pega tu API key aquí…"
                    className="codex-input w-full px-2 py-1.5 text-sm"
                    autoFocus
                  />
                  <div className="flex items-center justify-between mt-2">
                    <a
                      href={getProvider(editingKey)?.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent hover:underline inline-flex items-center gap-1"
                    >
                      Obtener API key <ExternalLink size={10} />
                    </a>
                    <div className="flex items-center gap-2">
                      {keyStatus && (
                        <span
                          className={cn(
                            'text-xs',
                            keyStatus.ok ? 'text-success' : 'text-danger',
                          )}
                        >
                          {keyStatus.message}
                        </span>
                      )}
                      <button
                        onClick={saveKey}
                        disabled={!keyInput || keyInput.length < 8}
                        className="codex-btn codex-btn-primary disabled:opacity-40"
                      >
                        <Check size={12} /> Guardar
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                filtered.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2 rounded-codex hover:bg-app-input transition-colors"
                  >
                    <div>
                      <div className="text-sm text-text-primary">{p.label}</div>
                      <div className="text-xs text-text-muted">{p.desc}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {hasKey[p.id] && !p.noApiKey && (
                        <span className="text-xs text-text-muted font-mono">
                          {maskKey('xxxxxxxxxxxxxxxxxxxxxxxxxx')}
                        </span>
                      )}
                      {p.noApiKey ? (
                        <Badge color="accent">local</Badge>
                      ) : hasKey[p.id] ? (
                        <>
                          <button
                            onClick={() => setEditingKey(p.id)}
                            className="codex-btn text-xs"
                          >
                            Cambiar
                          </button>
                          <button
                            onClick={() => deleteKey(p.id)}
                            className="codex-icon-btn w-6 h-6"
                            title="Borrar key"
                          >
                            <Trash2 size={12} />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setEditingKey(p.id)}
                          className="codex-btn codex-btn-primary text-xs"
                        >
                          Configurar
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">
            Activo: <span className="text-text-primary font-medium">{activeProvider.label}</span>{' '}
            / {activeProvider.models.find((m) => m.id === modelId)?.label ?? modelId}
          </span>
          <button onClick={onClose} className="codex-btn codex-btn-primary">
            Listo
          </button>
        </div>
      </div>
    </>
  );
}
