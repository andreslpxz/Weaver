import { useEffect, useState } from 'react';
import { Search, Check, AlertCircle, X, ExternalLink, Trash2, KeyRound } from 'lucide-react';
import { PROVIDERS, getProvider } from '@/providers/registry';
import { useWeaver } from '@/store/weaver';
import { apiKeyStore, maskKey } from '@/providers/store';
import { keyring } from '@/lib/tauri';
import type { ProviderId } from '@/providers/types';
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

  useEffect(() => {
    refreshProvidersWithKey();
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

  const filtered = PROVIDERS.filter(
    (p) =>
      p.label.toLowerCase().includes(query.toLowerCase()) ||
      p.desc.toLowerCase().includes(query.toLowerCase()),
  );

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
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'models' ? 'Buscar modelo o proveedor…' : 'Buscar proveedor…'}
              className="codex-input w-full pl-9 pr-3 py-2 text-sm"
              autoFocus
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {tab === 'models' ? (
            <div className="space-y-4">
              {filtered.map((p) => {
                const isActive = p.id === providerId;
                const hasApiKey = p.noApiKey || hasKey[p.id];
                return (
                  <div key={p.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-text-primary">{p.label}</span>
                      <span className="text-xs text-text-muted">{p.desc}</span>
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
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {p.models.map((m) => (
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
                          title={`${m.contextWindow.toLocaleString()} tokens`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{m.label}</span>
                            {m.isReasoning && <Badge color="default">reasoning</Badge>}
                          </div>
                          <div className="text-[10px] text-text-muted">
                            {(m.contextWindow / 1000).toFixed(0)}k ctx
                            {m.supportsTools ? ' · tools' : ''}
                          </div>
                        </button>
                      ))}
                    </div>
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
