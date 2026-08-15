/**
 * CwdPicker — modal para elegir la carpeta de trabajo del Modo IDE.
 * Pide al usuario una ruta absoluta. Tauri no expone un picker de carpeta
 * desde JS (requeriría plugin-dialog), pero en una próxima iteración
 * podemos agregar el plugin. Por ahora el usuario escribe la ruta.
 */

import { useState } from 'react';
import { FolderOpen, X, Loader2, Folder } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useWeaver } from '@/store/weaver';
import { sqlite, runtime } from '@/lib/tauri';

export function CwdPicker({ onClose }: { onClose: () => void }) {
  const { ideCwd, setIdeCwd } = useWeaver();
  const [path, setPath] = useState(ideCwd ?? '');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [items, setItems] = useState<Array<{ name: string; is_dir: boolean; size: number }>>([]);

  async function pickNative() {
    if (!runtime.isTauri) {
      setError('El picker nativo requiere Tauri. Escribe la ruta manualmente.');
      return;
    }
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: ideCwd ?? undefined,
        title: 'Elegir carpeta de trabajo del IDE',
      });
      if (typeof selected === 'string' && selected) {
        setPath(selected);
        setIdeCwd(selected);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function pick() {
    const trimmed = path.trim();
    if (!trimmed) {
      setError('Escribe una ruta absoluta.');
      return;
    }
    if (!runtime.isTauri) {
      setIdeCwd(trimmed);
      onClose();
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const list = await sqlite.fileList(trimmed);
      setItems(list.slice(0, 8));
      if (list.length === 0) {
        setError('La carpeta existe pero está vacía, o la ruta no es válida.');
      } else {
        setIdeCwd(trimmed);
        setTimeout(() => onClose(), 400);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-app-bg border border-border-accent rounded-codex shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-accent" />
            <h3 className="text-sm font-semibold">Carpeta de trabajo del IDE</h3>
          </div>
          <button onClick={onClose} className="codex-icon-btn w-6 h-6">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-text-secondary">
            Elige la carpeta raíz del proyecto en la que el agente trabajará.
            Esta carpeta se mostrará en el explorador y será el contexto por defecto
            para los comandos shell del agente.
          </p>

          {/* Picker nativo */}
          {runtime.isTauri && (
            <button
              onClick={pickNative}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 border border-border rounded-codex bg-app-elevated hover:bg-accent/10 hover:border-accent transition-colors text-xs"
            >
              <Folder size={14} className="text-accent" />
              Abrir selector de carpeta nativo…
            </button>
          )}

          {/* Manual entry */}
          <div className="text-[10px] text-text-muted text-center">— o escribe la ruta —</div>
          <div className="flex gap-2">
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && pick()}
              placeholder="/ruta/absoluta/al/proyecto"
              className="codex-input flex-1 px-3 py-2 text-xs font-mono"
            />
            <button
              onClick={pick}
              disabled={checking}
              className="codex-btn-primary px-3 py-2 text-xs rounded-codex flex items-center gap-1.5"
            >
              {checking ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
              {ideCwd ? 'Cambiar' : 'Elegir'}
            </button>
          </div>

          {error && (
            <div className="text-[11px] text-danger p-2 bg-danger/10 rounded-codex border border-danger/30">
              {error}
            </div>
          )}

          {items.length > 0 && (
            <div className="text-[10px] text-text-muted">
              <div className="mb-1">Vista previa ({items.length} entradas):</div>
              <div className="font-mono bg-app-elevated rounded-codex p-2 max-h-32 overflow-y-auto">
                {items.map((it) => (
                  <div key={it.name} className="truncate">
                    {it.is_dir ? '📁 ' : '📄 '}
                    {it.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="text-[10px] text-text-muted border-t border-border pt-2">
            <div className="mb-1">💡 Tip: atajos comunes</div>
            <div className="font-mono">
              <div>Windows: <code className="text-text-secondary">C:\Users\tu\proyecto</code></div>
              <div>macOS / Linux: <code className="text-text-secondary">/Users/tu/proyecto</code></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
