/**
 * AppPicker — selector de aplicaciones/ventanas abiertas.
 *
 * Lista las ventanas top-level visibles vía AT-SPI (Linux) o
 * EnumWindows (Windows) o NSWorkspace (macOS).
 *
 * Al seleccionar una, se "adjunta" al composer como contexto:
 * el agente recibirá el árbol de accesibilidad de esa ventana
 * como información adicional.
 */

import { useEffect, useState } from 'react';
import { Search, X, Monitor, RefreshCw, Check, Loader2 } from 'lucide-react';
import { atspi, automation, runtime } from '@/lib/tauri';
import type { ApplicationInfo, WindowInfo } from '@/lib/tauri-types';
import { cn } from '@/components/common/Button';

export interface PickedApp {
  /** Nombre de la aplicación o título de la ventana. */
  name: string;
  /** bus_name (AT-SPI) o id (Win32) para referenciar la ventana. */
  busName: string;
  /** Object path o handle. */
  path: string;
  /** Tipo de adjunto. */
  kind: 'window' | 'application';
}

export function AppPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (app: PickedApp) => void;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [windows, setWindows] = useState<PickedApp[]>([]);
  const [picked, setPicked] = useState<PickedApp | null>(null);

  useEffect(() => {
    loadApps();
  }, []);

  async function loadApps() {
    setLoading(true);
    try {
      if (runtime.isTauri) {
        // Intentar listar ventanas primero (más rápido).
        const wins = await automation.listWindows();
        if (wins.length > 0) {
          const apps: PickedApp[] = wins
            .filter((w) => w.title && !w.title.startsWith('weaver'))
            .map((w) => ({
              name: w.title,
              busName: w.id,
              path: w.id,
              kind: 'window' as const,
            }))
            .slice(0, 50); // Limitar a 50 resultados.
          setWindows(apps);
        } else {
          // Fallback: listar aplicaciones vía AT-SPI.
          const apps = await atspi.listApplications();
          const picked: PickedApp[] = apps
            .filter((a) => a.name && a.name !== 'weaver')
            .map((a) => ({
              name: a.name,
              busName: a.bus_name,
              path: a.root_path,
              kind: 'application' as const,
            }))
            .slice(0, 50);
          setWindows(picked);
        }
      } else {
        // Navegador: sin apps disponibles.
        setWindows([]);
      }
    } catch (e) {
      console.warn('[AppPicker] loadApps failed:', e);
    } finally {
      setLoading(false);
    }
  }

  const filtered = windows.filter((w) =>
    w.name.toLowerCase().includes(query.toLowerCase()),
  );

  function handlePick(app: PickedApp) {
    setPicked(app);
    onPick(app);
    setTimeout(onClose, 300);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 animate-fade-in"
        onClick={onClose}
      />

      {/* Popup */}
      <div className="fixed left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-50 w-[min(640px,90vw)] h-[min(480px,70vh)] bg-app-elevated border border-border-accent rounded-codex shadow-2xl flex flex-col animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-accent" />
            <span className="font-medium text-sm">Adjuntar app</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={loadApps}
              disabled={loading}
              className="codex-icon-btn w-7 h-7"
              title="Refrescar"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
            <button onClick={onClose} className="codex-icon-btn w-7 h-7">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ventana o aplicación…"
              className="codex-input w-full pl-9 pr-3 py-2 text-sm"
              autoFocus
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {!runtime.isTauri ? (
            <div className="text-center py-12 text-sm text-text-muted">
              <Monitor size={32} className="mx-auto mb-3 opacity-50" />
              <p>Adjuntar app requiere modo Tauri.</p>
              <p className="text-xs mt-1">Ejecuta con <code className="text-accent">npm run tauri dev</code></p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-text-muted">
              <Loader2 size={20} className="animate-spin mr-2" />
              Cargando ventanas…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-text-muted">
              <Monitor size={32} className="mx-auto mb-3 opacity-50" />
              <p>No se encontraron ventanas.</p>
              <button
                onClick={loadApps}
                className="mt-3 text-accent hover:underline text-xs"
              >
                Reintentar
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((app, i) => (
                <button
                  key={`${app.busName}-${i}`}
                  onClick={() => handlePick(app)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-codex text-sm transition-colors text-left',
                    picked?.busName === app.busName
                      ? 'bg-accent/15 text-accent border border-accent/30'
                      : 'hover:bg-app-input border border-transparent',
                  )}
                >
                  <Monitor size={14} className="flex-shrink-0 text-text-muted" />
                  <span className="flex-1 truncate">{app.name}</span>
                  {app.kind === 'application' && (
                    <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-app-elevated">
                      app
                    </span>
                  )}
                  {picked?.busName === app.busName && (
                    <Check size={12} className="text-accent" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-2 text-[10px] text-text-muted text-center">
          {runtime.isTauri
            ? `${filtered.length} ${filtered.length === 1 ? 'ventana' : 'ventanas'} disponibles`
            : 'Modo navegador — sin acceso a ventanas'}
        </div>
      </div>
    </>
  );
}
