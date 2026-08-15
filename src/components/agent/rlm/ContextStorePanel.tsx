/**
 * RLM-UI — ContextStorePanel.
 *
 * Muestra los fragmentos guardados en el ContextStore del agente.
 * Cada fragmento muestra:
 *   - Key (legible)
 *   - Source (tool que lo produjo)
 *   - Size (chars)
 *   - Metadata
 *   - Botón para ver contenido completo (expansible)
 *
 * También muestra:
 *   - Tamaño total (para detectar Context Rot potencial)
 *   - Botón para limpiar todo
 */

import { memo, useState } from 'react';
import {
  Database,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  Globe,
  Search as SearchIcon,
  Bot,
} from 'lucide-react';
import type { ContextFragment } from '@/agent/rlm';

interface ContextStorePanelProps {
  fragments: ContextFragment[];
  totalSize: number;
  onClear?: () => void;
  onDelete?: (key: string) => void;
}

const SOURCE_ICONS: Record<string, typeof FileCode> = {
  file_view_lines: FileCode,
  file_view_structure: FileCode,
  file_view_symbols: FileCode,
  file_read: FileText,
  web_search: SearchIcon,
  web_fetch: Globe,
  spawn_child_agent: Bot,
  manual: FileText,
};

function getIcon(source: string): typeof FileCode {
  return SOURCE_ICONS[source] ?? Database;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} chars`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ContextStorePanel = memo(function ContextStorePanel({
  fragments,
  totalSize,
  onClear,
  onDelete,
}: ContextStorePanelProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {/* Header con stats */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-xs">
          <Database size={12} className="text-accent" />
          <span className="font-medium text-text-primary">{fragments.length} fragmentos</span>
          <span className="text-text-muted">·</span>
          <span className="text-text-muted">{formatSize(totalSize)}</span>
        </div>
        {onClear && fragments.length > 0 && (
          <button
            onClick={onClear}
            className="codex-icon-btn w-6 h-6"
            title="Limpiar todos los fragmentos"
          >
            <Trash2 size={11} className="text-danger" />
          </button>
        )}
      </div>

      {/* Warning si el contexto es muy grande (potencial Context Rot) */}
      {totalSize > 100_000 && (
        <div className="text-[10px] text-warning bg-warning/10 border border-warning/20 rounded-codex px-2 py-1 flex items-center gap-1">
          <span>⚠</span>
          <span>Contexto grande. Considera limpiar fragmentos obsoletos.</span>
        </div>
      )}

      {/* Lista de fragmentos */}
      {fragments.length === 0 ? (
        <div className="text-xs text-text-muted p-3 border border-dashed border-border rounded-codex text-center">
          ContextStore vacío. Cuando el agente use <code className="text-accent">file_view_*</code> o{' '}
          <code className="text-accent">ctx_set</code>, los fragmentos aparecerán aquí.
        </div>
      ) : (
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {fragments.map((fragment) => {
            const Icon = getIcon(fragment.source);
            const isExpanded = expandedKeys.has(fragment.key);
            return (
              <div
                key={fragment.id}
                className="border border-border rounded-codex overflow-hidden"
              >
                <button
                  onClick={() => toggle(fragment.key)}
                  className="w-full flex items-center gap-2 text-xs px-2 py-1.5 hover:bg-app-input/30 text-left"
                >
                  {isExpanded ? (
                    <ChevronDown size={11} className="text-text-muted shrink-0" />
                  ) : (
                    <ChevronRight size={11} className="text-text-muted shrink-0" />
                  )}
                  <Icon size={11} className="text-accent shrink-0" />
                  <span className="font-medium text-text-primary truncate flex-1">{fragment.key}</span>
                  <span className="text-text-muted shrink-0">{formatSize(fragment.size)}</span>
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(fragment.key);
                      }}
                      className="codex-icon-btn w-5 h-5 shrink-0"
                      title="Eliminar fragmento"
                    >
                      <Trash2 size={9} className="text-danger" />
                    </button>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-2 py-1.5 border-t border-border bg-app-sidebar/50">
                    <div className="text-[10px] text-text-muted mb-1 flex items-center gap-2">
                      <span>source: {fragment.source}</span>
                      {fragment.metadata && (
                        <>
                          <span>·</span>
                          <span>meta: {JSON.stringify(fragment.metadata)}</span>
                        </>
                      )}
                    </div>
                    <pre className="text-[10px] text-text-secondary font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                      {fragment.content.slice(0, 2000)}
                      {fragment.content.length > 2000 && '\n...[truncated]'}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
