/**
 * DiffViewer — lista los archivos modificados por el agente.
 *
 * Cada entrada muestra:
 *  - Tipo de cambio (created / modified / deleted)
 *  - Ruta del archivo
 *  - Hora del cambio
 *
 * Click en una entrada abre el archivo en el editor.
 *
 * NOTA: Por v1, esto es una lista simple. No mostramos diff línea-a-línea
 * (eso requeriría una lib de diff). El usuario hace clic en el archivo
 * y ve el contenido actual en el editor.
 *
 * Cómo se llena: el loop del agente, cuando ejecuta tools que tocan
 * archivos (file_write, shell_exec con sed/echo >), debe emitir un
 * CustomEvent 'weaver:agent-file-change' con detalle FileChange.
 * IdeLayout escucha esos eventos y los propaga aquí.
 */

import { FilePlus, FileEdit, FileX, ChevronRight } from 'lucide-react';
import { cn } from '@/components/common/Button';

export interface FileChange {
  path: string;
  /** Nombre base para mostrar. */
  name: string;
  type: 'created' | 'modified' | 'deleted';
  ts: number;
  /** Descripción corta del cambio (opcional). */
  summary?: string;
}

interface DiffViewerProps {
  changes: FileChange[];
  onOpenFile: (path: string, name: string) => void;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'ahora';
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  return `hace ${Math.floor(diff / 3_600_000)} h`;
}

const ICONS = {
  created: <FilePlus size={11} className="text-success" />,
  modified: <FileEdit size={11} className="text-warning" />,
  deleted: <FileX size={11} className="text-danger" />,
};

const LABELS = {
  created: 'Creado',
  modified: 'Modificado',
  deleted: 'Eliminado',
};

export function DiffViewer({ changes, onOpenFile }: DiffViewerProps) {
  if (changes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-[11px] italic">
        Cuando el agente modifique archivos, verás aquí los cambios.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {changes.map((c, i) => (
        <button
          key={`${c.path}-${i}`}
          onClick={() => c.type !== 'deleted' && onOpenFile(c.path, c.name)}
          className={cn(
            'w-full text-left flex items-center gap-2 px-3 py-1.5 border-b border-border/50',
            'hover:bg-app-elevated transition-colors text-[11px]',
            c.type === 'deleted' && 'opacity-50 cursor-default',
          )}
        >
          {ICONS[c.type]}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-text-primary truncate">{c.name}</span>
              <span className="text-[9px] uppercase tracking-wide text-text-muted">
                {LABELS[c.type]}
              </span>
            </div>
            <div className="text-[9px] text-text-muted truncate font-mono">{c.path}</div>
            {c.summary && (
              <div className="text-[10px] text-text-secondary mt-0.5">{c.summary}</div>
            )}
          </div>
          <span className="text-[9px] text-text-muted shrink-0">{timeAgo(c.ts)}</span>
          {c.type !== 'deleted' && (
            <ChevronRight size={10} className="text-text-muted shrink-0" />
          )}
        </button>
      ))}
    </div>
  );
}
