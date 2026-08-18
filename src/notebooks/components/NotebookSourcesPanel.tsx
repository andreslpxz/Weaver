/**
 * Pestaña Fuentes: lista todo lo cargado al notebook (PDFs, MD, texto,
 * DOCX, URLs) con su estado de procesamiento, tamaño, y permite eliminarlas
 * o agregar nuevas directamente desde aquí (no solo desde el composer del
 * chat).
 */

import { useRef } from 'react';
import { FileText, Link2, Trash2, AlertCircle, Loader2, Plus, FileType } from 'lucide-react';
import type { Notebook, NotebookSource } from '../types';
import { fileToSource, formatSourceSize, urlToSource } from '../sources';
import { NotebookSourceSearch } from './NotebookSourceSearch';
import * as store from '../store';

function sourceIcon(kind: NotebookSource['kind']) {
  if (kind === 'url') return <Link2 size={16} />;
  if (kind === 'docx') return <FileType size={16} />;
  return <FileText size={16} />;
}

export function NotebookSourcesPanel({ notebook }: { notebook: Notebook }) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList) {
    for (const file of Array.from(files)) {
      const source = await fileToSource(file);
      store.addSource(notebook.id, source);
    }
  }

  async function handleAddUrlPrompt() {
    const url = window.prompt('URL de la fuente:');
    if (!url) return;
    const source = await urlToSource(url.trim());
    store.addSource(notebook.id, source);
  }

  return (
    <div className="flex h-full flex-col p-4">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.md,.markdown,.txt,.docx"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-text-secondary hover:border-accent/50 hover:text-accent transition-colors"
        >
          <Plus size={16} /> Subir archivo
        </button>
        <button
          onClick={handleAddUrlPrompt}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm text-text-secondary hover:border-accent/50 hover:text-accent transition-colors"
        >
          <Link2 size={16} /> Agregar URL
        </button>
      </div>

      <NotebookSourceSearch notebookId={notebook.id} />

      {notebook.sources.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-text-tertiary">
          <FileText size={32} className="mb-3 opacity-50" />
          <p className="text-sm font-medium text-text-secondary">Las fuentes que agregues aparecerán aquí</p>
          <p className="mt-1 text-xs">PDFs, Markdown, texto, DOCX o URLs. Luego podrás preguntar sobre ellas en el chat.</p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto">
          {notebook.sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-app-elevated px-3 py-2.5"
            >
              <span className="shrink-0 text-text-tertiary">{sourceIcon(s.kind)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-text-primary">{s.name}</div>
                <div className="flex items-center gap-2 text-xs text-text-tertiary">
                  {s.status === 'processing' && (
                    <span className="flex items-center gap-1">
                      <Loader2 size={11} className="animate-spin" /> Procesando…
                    </span>
                  )}
                  {s.status === 'ready' && (
                    <span>
                      {formatSourceSize(s.size)}
                      {s.truncated ? ' · truncado' : ''}
                    </span>
                  )}
                  {s.status === 'error' && (
                    <span className="flex items-center gap-1 text-danger">
                      <AlertCircle size={11} /> {s.error ?? 'Error al procesar'}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => store.removeSource(notebook.id, s.id)}
                className="shrink-0 rounded-lg p-1.5 text-text-tertiary hover:bg-danger/10 hover:text-danger"
                title="Eliminar fuente"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
