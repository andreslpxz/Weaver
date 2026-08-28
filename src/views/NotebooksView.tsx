import { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2, Pencil, Check, X, FileText, MessageSquare, Clock, Upload, Download, Share2, ListChecks, Sparkles } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { useWeaver } from '@/store/weaver';
import {
  listNotebooks,
  onNotebooksChanged,
  createNotebook,
  deleteNotebook,
  renameNotebook,
  importNotebook,
} from '@/notebooks/store';
import type { Notebook } from '@/notebooks/types';
import { buildTransfer, parseTransfer, pickJsonFiles, downloadJson, shareJson } from '@/lib/transfer';

// Plantillas rápidas de notebooks (acciones del empty state).
const NOTEBOOK_TEMPLATES: Array<{ name: string; description: string }> = [
  { name: 'Investigación', description: 'Fuentes web, papers y preguntas de investigación con respuestas ancladas.' },
  { name: 'Apuntes de clase', description: 'PDFs y apuntes por tema; pregunta dudas y genera resúmenes.' },
  { name: 'Lecturas guardadas', description: 'Artículos y URLs para leer después; chatea con ellos para recapitular.' },
];

export function NotebooksView() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const setActiveNotebookId = useWeaver((s) => s.setActiveNotebookId);
  const setView = useWeaver((s) => s.setView);

  useEffect(() => {
    setNotebooks(listNotebooks());
    return onNotebooksChanged(() => setNotebooks(listNotebooks()));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function openNotebook(id: string) {
    if (selectMode) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
      return;
    }
    setActiveNotebookId(id);
    setView('notebook-detail');
  }

  function handleCreate() {
    const nb = createNotebook(newName || 'Cuaderno sin título');
    setNewName('');
    setCreating(false);
    openNotebook(nb.id);
  }

  function handleCreateFromTemplate(tpl: (typeof NOTEBOOK_TEMPLATES)[number]) {
    const nb = importNotebook({ name: tpl.name, description: tpl.description, sources: [] });
    setActiveNotebookId(nb.id);
    setView('notebook-detail');
  }

  function handleDelete(id: string, name: string) {
    if (!confirm(`¿Eliminar el notebook "${name}"? Esta acción no se puede deshacer.`)) return;
    deleteNotebook(id);
  }

  function commitRename(id: string) {
    if (renameValue.trim()) renameNotebook(id, renameValue.trim());
    setRenamingId(null);
  }

  // --- Importar / Exportar / Compartir ---
  async function handleImport() {
    try {
      const contents = await pickJsonFiles();
      if (contents.length === 0) return;
      let count = 0;
      for (const raw of contents) {
        const items = parseTransfer('notebook', raw);
        for (const item of items) {
          importNotebook(item as Partial<Notebook>);
          count++;
        }
      }
      setToast(`✓ ${count} notebook${count !== 1 ? 's' : ''} importado${count !== 1 ? 's' : ''}`);
    } catch (e) {
      alert(`No se pudo importar: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function exportNotebooks(list: Notebook[]) {
    if (list.length === 0) return;
    const payload = buildTransfer('notebook', list.map((n) => ({ ...n })));
    const base = list.length === 1 ? list[0].name : `weaver-notebooks-${list.length}`;
    downloadJson(base, payload);
    setToast('✓ Exportado como JSON');
  }

  async function shareNotebooks(list: Notebook[]) {
    if (list.length === 0) return;
    const payload = buildTransfer('notebook', list.map((n) => ({ ...n })));
    const base = list.length === 1 ? list[0].name : `weaver-notebooks-${list.length}`;
    const result = await shareJson(base, payload);
    setToast(result === 'copied' ? '✓ JSON copiado al portapapeles' : result === 'shared' ? '✓ Compartido' : '✓ Descargado para compartir');
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  function deleteSelected() {
    const n = selected.size;
    if (n === 0) return;
    if (!confirm(`¿Eliminar ${n} notebook${n !== 1 ? 's' : ''} seleccionado${n !== 1 ? 's' : ''}?`)) return;
    for (const id of selected) deleteNotebook(id);
    exitSelectMode();
  }

  const selectedNotebooks = notebooks.filter((nb) => selected.has(nb.id));

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-medium flex items-center gap-2">
            <BookOpen size={26} className="text-accent" /> Notebooks
          </h1>
          <div className="flex items-center gap-1.5">
            <Button onClick={handleImport} title="Importar desde archivo JSON">
              <Upload size={13} className="mr-1" /> Importar
            </Button>
            <Button
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={selectMode ? '!text-accent' : ''}
              title="Seleccionar varios a la vez"
            >
              <ListChecks size={13} className="mr-1" /> {selectMode ? 'Cancelar' : 'Seleccionar'}
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} className="mr-1" /> Nuevo
            </Button>
          </div>
        </div>
        <p className="text-text-secondary text-sm mb-6">
          Cuadernos de investigación: carga fuentes (PDFs, Markdown, URLs) y chatea sobre
          ellas con respuestas ancladas en tus documentos. Usa el mismo modelo activo del
          chat principal de Weaver, con sus propias herramientas de búsqueda.
        </p>

        {/* Barra de acciones multi-selección */}
        {selectMode && (
          <div className="codex-card p-2.5 mb-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-secondary text-xs mr-1">
              {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}
            </span>
            <Button onClick={() => exportNotebooks(selectedNotebooks)} disabled={selected.size === 0}>
              <Download size={12} className="mr-1" /> Exportar
            </Button>
            <Button onClick={() => void shareNotebooks(selectedNotebooks)} disabled={selected.size === 0}>
              <Share2 size={12} className="mr-1" /> Compartir
            </Button>
            <Button onClick={deleteSelected} disabled={selected.size === 0} className="!text-danger">
              <Trash2 size={12} className="mr-1" /> Eliminar
            </Button>
            {notebooks.length > 0 && (
              <Button
                onClick={() => setSelected(new Set(notebooks.map((n) => n.id)))}
                disabled={selected.size === notebooks.length}
                className="ml-auto"
              >
                Todos
              </Button>
            )}
          </div>
        )}

        {toast && (
          <div className="mb-4 px-3 py-2 rounded-codex border border-accent/30 bg-accent/10 text-accent text-xs">
            {toast}
          </div>
        )}

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
          /* Empty state anclado arriba + plantillas rápidas */
          <div>
            <div className="text-sm text-text-muted px-5 py-4 border border-dashed border-border rounded-codex">
              Aún no tienes notebooks. Crea uno, agrega fuentes y empieza a preguntar — o parte de una plantilla:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
              {NOTEBOOK_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.name}
                  onClick={() => handleCreateFromTemplate(tpl)}
                  className="codex-card p-3 text-left hover:border-accent/50 transition-colors group"
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                    <Sparkles size={12} className="text-accent" />
                    {tpl.name}
                  </div>
                  <div className="text-[11px] text-text-muted mt-1 line-clamp-2">{tpl.description}</div>
                  <div className="text-[10px] text-accent mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    Crear →
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {notebooks.map((nb) => (
              <div
                key={nb.id}
                className={
                  'codex-card p-3 transition-colors' +
                  (selected.has(nb.id) ? ' !border-accent/60 bg-accent/5' : '')
                }
              >
                <div className="flex items-start justify-between gap-3">
                  {selectMode && (
                    <button
                      onClick={() => toggleSelect(nb.id)}
                      className={
                        'flex h-4 w-4 mt-1 shrink-0 items-center justify-center rounded border transition-colors ' +
                        (selected.has(nb.id) ? 'border-accent bg-accent text-app-bg' : 'border-border-accent')
                      }
                      title="Seleccionar"
                    >
                      {selected.has(nb.id) && <Check size={10} />}
                    </button>
                  )}
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
                      onClick={() => void shareNotebooks([nb])}
                      className="codex-icon-btn w-7 h-7"
                      title="Compartir (Web Share o copiar JSON)"
                    >
                      <Share2 size={12} />
                    </button>
                    <button
                      onClick={() => exportNotebooks([nb])}
                      className="codex-icon-btn w-7 h-7"
                      title="Exportar a JSON"
                    >
                      <Download size={12} />
                    </button>
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
