/**
 * StatusBar — barra inferior estilo VSCode con info contextual.
 *
 * Muestra: carpeta actual · archivo activo · líneas · estado dirty ·
 * proveedor · modelo · atajos de paneles.
 */

import {
  Folder,
  File as FileIcon,
  CircleDot,
  PanelLeft,
  PanelRight,
  PanelBottom,
} from 'lucide-react';
import { useWeaver } from '@/store/weaver';

interface StatusBarProps {
  cwd: string | null;
  activeFile: string | null;
  activePath: string | null;
  lineCount: number;
  isDirty: boolean;
  tabsCount: number;
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleBottom: () => void;
}

export function StatusBar({
  cwd,
  activeFile,
  activePath,
  lineCount,
  isDirty,
  tabsCount,
  leftOpen,
  rightOpen,
  bottomOpen,
  onToggleLeft,
  onToggleRight,
  onToggleBottom,
}: StatusBarProps) {
  const { providerId, modelId, setModelPickerOpen } = useWeaver();

  return (
    <footer className="h-6 border-t border-border bg-accent/90 text-app-bg flex items-center justify-between px-2 text-[10px] shrink-0 font-medium">
      {/* Left cluster */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onToggleLeft}
          className="flex items-center gap-1 hover:bg-app-bg/20 px-1.5 py-0.5 rounded"
          title={leftOpen ? 'Ocultar explorador' : 'Mostrar explorador'}
        >
          <PanelLeft size={11} />
        </button>
        <button
          onClick={onToggleBottom}
          className="flex items-center gap-1 hover:bg-app-bg/20 px-1.5 py-0.5 rounded"
          title={bottomOpen ? 'Ocultar cambios' : 'Mostrar cambios'}
        >
          <PanelBottom size={11} />
        </button>

        <div className="w-px h-3 bg-app-bg/30 mx-0.5" />

        <span className="flex items-center gap-1 truncate" title={cwd ?? 'Sin carpeta'}>
          <Folder size={10} />
          <span className="truncate max-w-[160px]">{cwd ?? 'Sin carpeta'}</span>
        </span>

        {activeFile && (
          <>
            <span className="text-app-bg/40">·</span>
            <span className="flex items-center gap-1 truncate" title={activePath ?? ''}>
              {isDirty ? <CircleDot size={9} className="text-warning" /> : <FileIcon size={9} />}
              <span className="truncate max-w-[180px]">{activeFile}</span>
              <span className="text-app-bg/60">{lineCount}L</span>
            </span>
          </>
        )}

        {tabsCount > 0 && (
          <>
            <span className="text-app-bg/40">·</span>
            <span>{tabsCount} tab{tabsCount > 1 ? 's' : ''}</span>
          </>
        )}
      </div>

      {/* Right cluster */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setModelPickerOpen(true)}
          className="hover:bg-app-bg/20 px-1.5 py-0.5 rounded"
          title="Cambiar modelo"
        >
          {providerId} · {modelId}
        </button>
        <button
          onClick={onToggleRight}
          className="flex items-center gap-1 hover:bg-app-bg/20 px-1.5 py-0.5 rounded"
          title={rightOpen ? 'Ocultar agente' : 'Mostrar agente'}
        >
          <PanelRight size={11} />
        </button>
      </div>
    </footer>
  );
}
