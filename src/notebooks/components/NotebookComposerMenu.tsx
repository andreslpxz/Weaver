/**
 * Popup "+" del chat de Notebooks.
 *
 * Permite:
 *  - Adjuntar archivos como fuente (PDF, MD, TXT, DOCX) — se agregan al
 *    notebook inmediatamente (pestaña Fuentes) y quedan disponibles como
 *    contexto para todo el chat, no solo el turno actual.
 *  - Agregar una URL como fuente.
 *  - Elegir una herramienta de búsqueda para el turno actual: búsqueda
 *    rápida o investigación profunda (mutuamente excluyentes, como pediste).
 */

import { useRef, useState } from 'react';
import { Plus, FileText, Link2, Zap, Telescope, X, Loader2, Check } from 'lucide-react';
import { cn } from '@/components/common/Button';
import type { NotebookToolMode } from '../types';

export function NotebookComposerMenu({
  activeTool,
  onSelectTool,
  onAddFiles,
  onAddUrl,
}: {
  activeTool: NotebookToolMode | null;
  onSelectTool: (tool: NotebookToolMode | null) => void;
  onAddFiles: (files: FileList) => void;
  onAddUrl: (url: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [addingUrl, setAddingUrl] = useState(false);
  const [showUrlField, setShowUrlField] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleAddUrl() {
    const url = urlInput.trim();
    if (!url) return;
    setAddingUrl(true);
    try {
      await onAddUrl(url);
      setUrlInput('');
      setShowUrlField(false);
      setOpen(false);
    } finally {
      setAddingUrl(false);
    }
  }

  return (
    <div className="relative">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.md,.markdown,.txt,.docx"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onAddFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-app-elevated text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
        title="Agregar fuentes o elegir herramienta"
      >
        <Plus size={18} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-50 mb-2 w-72 rounded-xl border border-border bg-app-panel shadow-xl p-2">
            <div className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-wide text-text-tertiary">
              Agregar fuente
            </div>
            <button
              onClick={() => {
                fileInputRef.current?.click();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-app-elevated"
            >
              <FileText size={16} className="text-text-tertiary" />
              Subir archivo (PDF, MD, TXT, DOCX)
            </button>

            {!showUrlField ? (
              <button
                onClick={() => setShowUrlField(true)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-app-elevated"
              >
                <Link2 size={16} className="text-text-tertiary" />
                Agregar URL
              </button>
            ) : (
              <div className="flex items-center gap-1 px-2 py-1.5">
                <input
                  autoFocus
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddUrl()}
                  placeholder="https://..."
                  className="flex-1 rounded-md bg-app-elevated border border-border px-2 py-1 text-sm outline-none focus:border-accent/50"
                />
                <button
                  onClick={handleAddUrl}
                  disabled={addingUrl || !urlInput.trim()}
                  className="shrink-0 rounded-md p-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
                >
                  {addingUrl ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                </button>
                <button
                  onClick={() => setShowUrlField(false)}
                  className="shrink-0 rounded-md p-1.5 text-text-tertiary hover:bg-app-elevated"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            <div className="mt-2 border-t border-border pt-2 px-2 pb-1 text-[11px] uppercase tracking-wide text-text-tertiary">
              Herramienta de búsqueda
            </div>
            <ToolOption
              icon={<Zap size={16} />}
              label="Búsqueda rápida"
              description="Una consulta web, respuesta inmediata"
              active={activeTool === 'quick_search'}
              onClick={() => {
                onSelectTool(activeTool === 'quick_search' ? null : 'quick_search');
                setOpen(false);
              }}
            />
            <ToolOption
              icon={<Telescope size={16} />}
              label="Investigación profunda"
              description="Varias búsquedas + lectura completa de fuentes, más lenta"
              active={activeTool === 'deep_research'}
              onClick={() => {
                onSelectTool(activeTool === 'deep_research' ? null : 'deep_research');
                setOpen(false);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ToolOption({
  icon,
  label,
  description,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-app-elevated',
        active && 'bg-accent/10',
      )}
    >
      <span className={cn('mt-0.5 text-text-tertiary', active && 'text-accent')}>{icon}</span>
      <span className="flex-1">
        <span className={cn('block text-sm', active && 'text-accent font-medium')}>{label}</span>
        <span className="block text-xs text-text-tertiary">{description}</span>
      </span>
      {active && <Check size={14} className="mt-0.5 text-accent shrink-0" />}
    </button>
  );
}
