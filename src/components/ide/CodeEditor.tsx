/**
 * CodeEditor — editor de texto con tabs estilo IDE.
 *
 * Funcionalidad:
 *  - Tabs arriba (con dirty indicator y botón cerrar)
 *  - Textarea con números de línea sincronizados
 *  - Carga perezosa del contenido (fileRead de Tauri)
 *  - Guardado (Ctrl+S) con fileWrite
 *  - Cambios sin guardar marcados con un dot
 *  - Fuente monoespaciada
 *
 * NOTA: No es un editor con syntax highlighting (eso requeriría Monaco
 * o CodeMirror). Para v1 usamos un textarea estilizado — suficiente para
 * editar archivos y ver diffs.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, Loader2, AlertCircle } from 'lucide-react';
import { sqlite, runtime } from '@/lib/tauri';
import { cn } from '@/components/common/Button';

export interface EditorTab {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
  loading: boolean;
  /** Último contenido guardado en disco (para detectar dirty). */
  savedContent?: string;
  /** Error al cargar/guardar. */
  error?: string | null;
}

interface CodeEditorProps {
  tabs: EditorTab[];
  activeTab: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onUpdateContent: (path: string, content: string, dirty: boolean) => void;
}

function detectLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript (React)', js: 'JavaScript', jsx: 'JavaScript (React)',
    py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', kt: 'Kotlin',
    rb: 'Ruby', php: 'PHP', c: 'C', cpp: 'C++', h: 'C header',
    cs: 'C#', swift: 'Swift', json: 'JSON', yaml: 'YAML', yml: 'YAML',
    toml: 'TOML', md: 'Markdown', markdown: 'Markdown',
    html: 'HTML', css: 'CSS', scss: 'SCSS', sh: 'Shell', bash: 'Bash',
    sql: 'SQL', xml: 'XML', txt: 'Texto', log: 'Log',
  };
  return map[ext] ?? ext.toUpperCase() ?? 'Texto';
}

export function CodeEditor({ tabs, activeTab, onSelectTab, onCloseTab, onUpdateContent }: CodeEditorProps) {
  const active = tabs.find((t) => t.path === activeTab) ?? null;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Carga perezosa del contenido del archivo cuando se activa un tab.
  useEffect(() => {
    if (!active || !active.loading || !runtime.isTauri) return;
    let cancelled = false;
    (async () => {
      try {
        const content = await sqlite.fileRead(active.path);
        if (cancelled) return;
        onUpdateContent(active.path, content, false);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        // Marcamos error en el tab content (a través de onUpdateContent con content vacío + error via estado local).
        onUpdateContent(active.path, '', false);
        setSaveError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.path, active?.loading, onUpdateContent]);

  // Reset del error al cambiar de tab.
  useEffect(() => {
    setSaveError(null);
  }, [activeTab]);

  // Sync line numbers scroll with textarea.
  function onScroll() {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }

  // Guardar (Ctrl+S o botón).
  async function save() {
    if (!active || saving) return;
    if (!runtime.isTauri) {
      setSaveError('Requiere Tauri para escribir archivos.');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await sqlite.fileWrite(active.path, active.content, true);
      onUpdateContent(active.path, active.content, false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // Atajo Ctrl+S.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, saving]);

  const lineCount = useMemo(() => {
    if (!active) return 0;
    return active.content.split('\n').length;
  }, [active?.content]);

  const lineNumbers = useMemo(() => {
    if (!active) return '';
    const n = Math.max(lineCount, 1);
    return Array.from({ length: n }, (_, i) => i + 1).join('\n');
  }, [active, lineCount]);

  if (!active) {
    return <div className="flex-1" />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tabs */}
      <div className="flex items-stretch border-b border-border bg-app-sidebar overflow-x-auto shrink-0">
        {tabs.map((t) => {
          const isActive = t.path === activeTab;
          return (
            <div
              key={t.path}
              onClick={() => onSelectTab(t.path)}
              className={cn(
                'group flex items-center gap-1.5 px-3 py-1.5 border-r border-border cursor-pointer text-[11px] transition-colors whitespace-nowrap',
                isActive
                  ? 'bg-app-bg text-text-primary'
                  : 'bg-app-sidebar text-text-secondary hover:bg-app-elevated/50',
              )}
            >
              <span className="truncate max-w-[140px]">{t.name}</span>
              {t.dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(t.path);
                }}
                className="opacity-0 group-hover:opacity-100 hover:bg-app-elevated rounded p-0.5 transition-opacity"
              >
                <X size={10} />
              </button>
            </div>
          );
        })}
        <div className="flex-1" />
      </div>

      {/* Toolbar del editor */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border text-[10px] text-text-muted bg-app-bg shrink-0">
        <span className="truncate">{active.path}</span>
        <span className="text-text-muted">·</span>
        <span>{detectLang(active.name)}</span>
        <span className="text-text-muted">·</span>
        <span>{lineCount} líneas</span>
        <div className="flex-1" />
        {active.dirty && (
          <span className="text-warning">● Sin guardar</span>
        )}
        <button
          onClick={save}
          disabled={saving || !active.dirty}
          className={cn(
            'px-2 py-0.5 rounded text-[10px] flex items-center gap-1 transition-colors',
            active.dirty
              ? 'bg-accent/10 text-accent hover:bg-accent/20'
              : 'text-text-muted cursor-default',
          )}
          title="Guardar (Ctrl+S)"
        >
          {saving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
          Guardar
        </button>
      </div>

      {/* Editor body */}
      <div className="flex-1 flex min-h-0 font-mono text-[12px] leading-[1.5]">
        {active.loading ? (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            <Loader2 size={16} className="animate-spin mr-2" />
            Cargando…
          </div>
        ) : saveError ? (
          <div className="flex-1 flex flex-col items-center justify-center text-danger p-4">
            <AlertCircle size={20} className="mb-2" />
            <div className="text-xs font-medium mb-1">No se pudo cargar el archivo</div>
            <div className="text-[10px] text-text-muted font-mono text-center">{saveError}</div>
          </div>
        ) : (
          <>
            {/* Line numbers */}
            <div
              ref={lineNumbersRef}
              className="overflow-hidden text-right text-text-muted select-none bg-app-sidebar/50 px-2 py-2 shrink-0"
              style={{ minWidth: 40 }}
            >
              <pre className="whitespace-pre">{lineNumbers}</pre>
            </div>
            {/* Textarea */}
            <textarea
              ref={textareaRef}
              value={active.content}
              onScroll={onScroll}
              onChange={(e) => {
                const newContent = e.target.value;
                const dirty = newContent !== (active.savedContent ?? newContent);
                onUpdateContent(active.path, newContent, true);
                // Si no hay savedContent, lo seteamos la primera vez para que Ctrl+S detecte dirty correctamente.
                if (active.savedContent === undefined) {
                  // marcar como dirty porque hemos editado sin haber guardado nunca
                }
              }}
              spellCheck={false}
              className="flex-1 bg-app-bg text-text-primary px-3 py-2 resize-none outline-none font-mono text-[12px] leading-[1.5] whitespace-pre overflow-auto"
              style={{ tabSize: 2 }}
              placeholder="Archivo vacío. Escribe algo y guarda con Ctrl+S."
            />
          </>
        )}
      </div>
    </div>
  );
}
