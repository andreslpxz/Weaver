import { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2, Pencil, Check, X, FileText, MessageSquare, Clock } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { useWeaver } from '@/store/weaver';
import { listNotebooks, onNotebooksChanged, createNotebook, deleteNotebook, renameNotebook } from '@/notebooks/store';
import type { Notebook } from '@/notebooks/types';

export function NotebooksView() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const setActiveNotebookId = useWeaver((s) => s.setActiveNotebookId);
  const setView = useWeaver((s) => s.setView);

  useEffect(() => {
    setNotebooks(listNotebooks());
    return onNotebooksChanged(() => setNotebooks(listNotebooks()));
  }, []);

  function openNotebook(id: string) {
    setActiveNotebookId(id);
    setView('notebook-detail');
  }

  function handleCreate() {
    const nb = createNotebook(newName || 'Cuaderno sin título');
    setNewName('');
    setCreating(false);
    openNotebook(nb.id);
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`¿Eliminar el notebook "${name}"? Esta acción no se puede deshacer.`)) return;
    deleteNotebook(id);
  }

  function commitRename(id: string) {
    if (renameValue.trim()) renameNotebook(id, renameValue.trim());
    setRenamingId(null);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-medium flex items-center gap-2">
            <BookOpen size={26} className="text-accent" /> Notebooks
          </h1>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} className="mr-1" /> Nuevo notebook
          </Button>
        </div>
        <p className="text-text-secondary text-sm mb-8">
          Cuadernos de investigación: carga fuentes (PDFs, Markdown, URLs) y chatea sobre
          ellas con respuestas ancladas en tus documentos. Usa el mismo modelo activo del
          chat principal de Weaver, con sus propias herramientas de búsqueda.
        </p>

        {creating && (
          <div className="codex-card p-4 mb-6 flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Nombre del notebook (ej. Investigación de mercado Q3)"
              className="codex-input flex-1 px-3 py-2 text-sm"
            />
            <Button variant="primary" onClick={handleCreate}>
              <Check size={12} /> Crear
            </Button>
            <Button onClick={() => setCreating(false)}>
              <X size={12} />
            </Button>
          </div>
        )}

        {notebooks.length === 0 ? (
          <div className="text-sm text-text-muted p-8 border border-dashed border-border rounded-codex text-center">
            Aún no tienes notebooks.
            <br />
            <span className="text-xs">Crea uno, agrega tus fuentes y empieza a preguntar.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {notebooks.map((nb) => (
              <div key={nb.id} className="codex-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => (renamingId === nb.id ? undefined : openNotebook(nb.id))}
                  >
                    {renamingId === nb.id ? (
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && commitRename(nb.id)}
                          className="codex-input px-2 py-1 text-sm flex-1"
                        />
                        <button onClick={() => commitRename(nb.id)} className="codex-icon-btn w-6 h-6">
                          <Check size={11} />
                        </button>
                        <button onClick={() => setRenamingId(null)} className="codex-icon-btn w-6 h-6">
                          <X size={11} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm font-medium truncate">{nb.name}</span>
                    )}
                    <div className="text-xs text-text-muted mt-1 flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <FileText size={10} /> {nb.sources.length} fuente{nb.sources.length !== 1 ? 's' : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageSquare size={10} /> {nb.chat.length} mensaje{nb.chat.length !== 1 ? 's' : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> {new Date(nb.updatedAt).toLocaleString()}
                      </span>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setRenamingId(nb.id);
                        setRenameValue(nb.name);
                      }}
                      className="codex-icon-btn w-7 h-7"
                      title="Renombrar"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(nb.id, nb.name)}
                      className="codex-icon-btn w-7 h-7"
                      title="Eliminar"
                    >
                      <Trash2 size={12} className="text-danger" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
