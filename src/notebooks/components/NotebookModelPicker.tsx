/**
 * Selector de modelo para Notebooks.
 *
 * Deliberadamente más simple que ModelPickerPopup (el del chat principal):
 * cada notebook guarda su propio providerId/modelId, independiente del
 * modelo activo en el resto de Weaver. Muestra los proveedores que ya
 * tienen API key configurada (reusa el mismo keyring/apiKeyStore), con la
 * lista curada de modelos de `PROVIDERS` (registry.ts).
 *
 * No duplica el fetch de modelos remotos de OpenRouter/Ollama del picker
 * principal; si se necesita más adelante, se puede ampliar reusando
 * `fetchProviderModels` de `@/providers/provider-models`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { PROVIDERS, getProvider } from '@/providers/registry';
import { apiKeyStore } from '@/providers/store';
import type { ProviderId } from '@/providers/types';
import { cn } from '@/components/common/Button';

export function NotebookModelPicker({
  providerId,
  modelId,
  onChange,
}: {
  providerId: ProviderId;
  modelId: string;
  onChange: (providerId: ProviderId, modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [providersWithKey, setProvidersWithKey] = useState<Set<ProviderId>>(new Set());

  useEffect(() => {
    // apiKeyStore.get() dispara la inicialización perezosa del keyring
    // (ensureInit interno) y puebla el cache `known`; listKnown() en frío
    // podría devolver vacío si nada más en la app lo inicializó antes.
    Promise.all(PROVIDERS.map((p) => apiKeyStore.get(p.id))).then(() => {
      setProvidersWithKey(new Set(apiKeyStore.listKnown()));
    });
  }, []);

  const availableProviders = useMemo(
    () => PROVIDERS.filter((p) => p.noApiKey || providersWithKey.has(p.id)),
    [providersWithKey],
  );

  const currentModelLabel = getProvider(providerId)?.models.find((m) => m.id === modelId)?.label ?? modelId;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-app-elevated px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
      >
        <span className="max-w-[160px] truncate">{currentModelLabel}</span>
        <ChevronDown size={14} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-2 w-72 max-h-96 overflow-y-auto rounded-xl border border-border bg-app-panel shadow-xl p-2">
            <div className="flex items-center justify-between px-2 py-1 mb-1">
              <span className="text-xs font-semibold text-text-secondary">Modelo del notebook</span>
              <button onClick={() => setOpen(false)} className="text-text-tertiary hover:text-text-primary">
                <X size={14} />
              </button>
            </div>
            {availableProviders.length === 0 && (
              <div className="px-2 py-3 text-xs text-text-tertiary">
                No hay proveedores con API key configurada. Añade una en Configuración.
              </div>
            )}
            {availableProviders.map((p) => (
              <div key={p.id} className="mb-1">
                <div className="px-2 py-1 text-[11px] uppercase tracking-wide text-text-tertiary">{p.label}</div>
                {p.models.map((m) => {
                  const active = p.id === providerId && m.id === modelId;
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        onChange(p.id, m.id);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-app-elevated',
                        active && 'bg-accent/10 text-accent',
                      )}
                    >
                      <span className="truncate">{m.label}</span>
                      {active && <Check size={14} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
