/**
 * FileExplorer — árbol de archivos plano (una sola carpeta a la vez).
 * Muestra el contenido del cwd actual del IDE.
 *
 * Soporta:
 *  - Listar archivos y carpetas
 *  - Navegar entrando en subcarpetas
 *  - Breadcrumb con la ruta actual
 *  - Abrir archivos en el CodeEditor
 *  - Crear / borrar archivos (Tauri)
 *
 * No es un árbol jerárquico con expand/collapse completo para mantener
 * el scope acotado. VSCode-style "carpeta actual + breadcrumb" es
 * suficiente para v1.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Folder,
  File as FileIcon,
  ChevronRight,
  Home,
  RefreshCw,
  FilePlus,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import { sqlite, runtime } from '@/lib/tauri';
import { cn } from '@/components/common/Button';

interface Entry {
  name: string;
  is_dir: boolean;
  size: number;
}

export interface FileExplorerProps {
  cwd: string | null;
  onOpenFile: (path: string, name: string) => void;
  activePath: string | null;
}

function joinPath(base: string, name: string): string {
  if (!base) return name;
  const sep = base.includes('/') && !base.includes('\\') ? '/' : '\\';
  return base.endsWith(sep) ? base + name : base + sep + name;
}

function basename(p: string): string {
  if (!p) return '';
  const sep = p.includes('/') && !p.includes('\\') ? '/' : '\\';
  const parts = p.split(sep).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function dirname(p: string): string {
  if (!p) return '';
  const sep = p.includes('/') && !p.includes('\\') ? '/' : '\\';
  const parts = p.split(sep).filter(Boolean);
  parts.pop();
  if (parts.length === 0) return sep;
  return (p.startsWith('/') ? '/' : '') + parts.join(sep);
}

export function FileExplorer({ cwd, onOpenFile, activePath }: FileExplorerProps) {
  const { setIdeCwd } = useWeaver();
  const [items, setItems] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async (path: string) => {
    if (!runtime.isTauri) {
      setError('Requiere Tauri para acceder al sistema de archivos.');
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const list = await sqlite.fileList(path);
      // Ordenar: carpetas primero, luego alfabético.
      list.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cwd) load(cwd);
  }, [cwd, load]);

  function openEntry(e: Entry) {
    if (!cwd) return;
    const full = joinPath(cwd, e.name);
    if (e.is_dir) {
      setIdeCwd(full);
    } else {
      onOpenFile(full, e.name);
    }
  }

  function goUp() {
    if (!cwd) return;
    const parent = dirname(cwd);
    if (parent && parent !== cwd) setIdeCwd(parent);
  }

  async function createFile() {
    const trimmed = newName.trim();
    if (!trimmed || !cwd) return;
    if (!runtime.isTauri) return;
    try {
      const full = joinPath(cwd, trimmed);
      await sqlite.fileWrite(full, '', true);
      setNewName('');
      setCreating(false);
      await load(cwd);
      onOpenFile(full, trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!cwd) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-center">
        <div className="text-[11px] text-text-muted">
          <Folder size={20} className="mx-auto mb-2 opacity-40" />
          Ninguna carpeta seleccionada.
        </div>
      </div>
    );
  }

  // Breadcrumb
  const sep = cwd.includes('/') && !cwd.includes('\\') ? '/' : '\\';
  const parts = cwd.split(sep).filter(Boolean);
  const isWinDrive = /^[a-zA-Z]:$/.test(parts[0] ?? '');

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Breadcrumb */}
      <div className="px-2 py-1.5 border-b border-border text-[10px] flex items-center gap-0.5 overflow-x-auto whitespace-nowrap">
        <button
          onClick={() => setIdeCwd(isWinDrive ? parts[0] + '\\' : '/')}
          className="codex-icon-btn w-4 h-4 shrink-0"
          title="Raíz"
        >
          <Home size={10} />
        </button>
        {parts.map((p, i) => {
          const upTo = isWinDrive
            ? parts.slice(0, i + 1).join('\\') + (i === 0 ? '\\' : '')
            : '/' + parts.slice(0, i + 1).join('/');
          const isLast = i === parts.length - 1;
          return (
            <div key={i} className="flex items-center gap-0.5 shrink-0">
              <ChevronRight size={9} className="text-text-muted" />
              <button
                onClick={() => !isLast && setIdeCwd(upTo)}
                className={cn(
                  'px-1 py-0.5 rounded truncate',
                  isLast
                    ? 'text-text-primary font-medium'
                    : 'text-text-secondary hover:text-text-primary hover:bg-app-elevated',
                )}
                style={{ maxWidth: 120 }}
              >
                {p}
              </button>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border">
        <button
          onClick={() => load(cwd)}
          className="codex-icon-btn w-5 h-5"
          title="Refrescar"
        >
          {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
        </button>
        <button
          onClick={goUp}
          className="codex-icon-btn w-5 h-5"
          title="Subir"
        >
          <ChevronRight size={10} className="rotate-90" />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setCreating((v) => !v)}
          className="codex-icon-btn w-5 h-5"
          title="Nuevo archivo"
        >
          <FilePlus size={10} />
        </button>
      </div>

      {/* New file input */}
      {creating && (
        <div className="px-2 py-1.5 border-b border-border">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') createFile();
              if (e.key === 'Escape') {
                setCreating(false);
                setNewName('');
              }
            }}
            placeholder="nombre-archivo.ts"
            className="codex-input w-full px-2 py-1 text-[11px] font-mono"
          />
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="p-2 text-[10px] text-danger flex items-start gap-1.5">
            <AlertCircle size={11} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!error && !loading && items.length === 0 && (
          <div className="p-3 text-[10px] text-text-muted text-center italic">
            Carpeta vacía
          </div>
        )}

        {items.map((e) => {
          const full = joinPath(cwd, e.name);
          const isActive = activePath === full;
          return (
            <button
              key={e.name}
              onClick={() => openEntry(e)}
              className={cn(
                'w-full text-left flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-app-elevated transition-colors',
                isActive && 'bg-accent/10 text-accent',
                !isActive && 'text-text-secondary hover:text-text-primary',
              )}
            >
              {e.is_dir ? (
                <Folder size={11} className="text-warning shrink-0" />
              ) : (
                <FileIcon size={11} className="text-text-muted shrink-0" />
              )}
              <span className="truncate">{e.name}</span>
            </button>
          );
        })}
      </div>

      {/* Footer count */}
      <div className="px-2 py-1 border-t border-border text-[9px] text-text-muted">
        {items.length} elementos
      </div>
    </div>
  );
}
