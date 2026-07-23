/**
 * CodeEditor — editor Monaco con tabs, IntelliSense y highlight de cambios.
 *
 * Funcionalidad:
 *  - Monaco editor (syntax highlight real, IntelliSense, multi-cursor, minimap)
 *  - Tabs con dirty indicator y close
 *  - Carga perezosa vía fileRead (Tauri)
 *  - Guardado con Ctrl+S (Monaco dispara el evento, lo interceptamos)
 *  - Decorations verde/rojo semi-transparente para líneas cambiadas por el agente
 *  - Cada tab puede tener un conjunto de "line marks" (added/removed/modified)
 *    que se renderizan en el gutter y en el fondo de la línea.
 *
 * Cómo se llenan los line marks: cuando el agente modifica un archivo, emite
 * un evento `weaver:agent-file-change` con `lines: { type, line }[]`. Si el
 * archivo está abierto en un tab, aplicamos las decoraciones.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import { X, Save, Loader2, AlertCircle } from 'lucide-react';
import { sqlite, runtime } from '@/lib/tauri';
import { cn } from '@/components/common/Button';

// ============================================================================
// Types
// ============================================================================

export type LineMarkType = 'added' | 'removed' | 'modified';

export interface LineMark {
  type: LineMarkType;
  line: number; // 1-indexed
}

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
  /** Marcas de líneas cambiadas por el agente. */
  lineMarks?: LineMark[];
}

interface CodeEditorProps {
  tabs: EditorTab[];
  activeTab: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onUpdateContent: (path: string, content: string, dirty: boolean) => void;
}

// ============================================================================
// Utilidades
// ============================================================================

function detectLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
    rb: 'ruby', php: 'php', c: 'c', cpp: 'cpp', h: 'c',
    cs: 'csharp', swift: 'swift', json: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'ini', md: 'markdown', markdown: 'markdown',
    html: 'html', css: 'css', scss: 'scss', sh: 'shell', bash: 'shell',
    sql: 'sql', xml: 'xml', txt: 'plaintext', log: 'plaintext',
  };
  return map[ext] ?? 'plaintext';
}

// ============================================================================
// Componente principal
// ============================================================================

export function CodeEditor({ tabs, activeTab, onSelectTab, onCloseTab, onUpdateContent }: CodeEditorProps) {
  const active = tabs.find((t) => t.path === activeTab) ?? null;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<string[]>([]);
  const monacoRef = useRef<typeof monaco | null>(null);

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

  // Aplicar decorations de line marks cuando cambian.
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !active) return;
    const monaco = monacoRef.current;
    const marks = active.lineMarks ?? [];

    const decorations: monaco.editor.IModelDeltaDecoration[] = marks.map((m) => {
      const colorClass =
        m.type === 'added'
          ? 'line-mark-added'
          : m.type === 'removed'
            ? 'line-mark-removed'
            : 'line-mark-modified';
      const glyphClass =
        m.type === 'added'
          ? 'glyph-mark-added'
          : m.type === 'removed'
            ? 'glyph-mark-removed'
            : 'glyph-mark-modified';

      const lineColor =
        m.type === 'added' ? '#22c55e80' : m.type === 'removed' ? '#ef444480' : '#eab30880';

      return {
        range: new monaco.Range(m.line, 1, m.line, 1),
        options: {
          isWholeLine: true,
          className: colorClass,
          glyphMarginClassName: glyphClass,
          glyphMarginHoverMessage: { value: `Agente: ${m.type}` },
          minimap: { color: lineColor, position: monaco.editor.MinimapPosition.Inline },
          overviewRuler: {
            color: lineColor,
            position: monaco.editor.OverviewRulerLane.Full,
          },
        },
      };
    });

    decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, decorations);
  }, [active?.lineMarks, active?.path, active?.content]);

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

  // Monaco onMount: guardar refs y configurar atajos.
  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Ctrl+S
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void save();
    });

    // Definir theme de Weaver mapeando nuestras variables CSS.
    defineWeaverTheme(monaco);
  };

  const handleBeforeMount: BeforeMount = (monaco) => {
    monacoRef.current = monaco;
    defineWeaverTheme(monaco);
  };

  // Content del editor — Monaco es controlado vía path + defaultValue
  // pero para que cambie al switchear tabs usamos `value` + `onChange`.
  const editorValue = active?.content ?? '';

  const lineCount = useMemo(() => {
    if (!active) return 0;
    return active.content.split('\n').length;
  }, [active?.content]);

  if (!active) {
    return <div className="flex-1" />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tabs */}
      <div className="flex items-stretch border-b border-border bg-app-sidebar overflow-x-auto shrink-0">
        {tabs.map((t) => {
          const isActive = t.path === activeTab;
          const hasMarks = (t.lineMarks?.length ?? 0) > 0;
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
              {hasMarks && (
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: '#eab308' }}
                  title={`${t.lineMarks?.length} líneas modificadas por el agente`}
                />
              )}
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
        {(active.lineMarks?.length ?? 0) > 0 && (
          <>
            <span className="text-text-muted">·</span>
            <span className="text-warning">{active.lineMarks?.length} cambios del agente</span>
          </>
        )}
        <div className="flex-1" />
        {active.dirty && <span className="text-warning">● Sin guardar</span>}
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

      {/* Editor body — Monaco */}
      <div className="flex-1 min-h-0 relative">
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
          <Editor
            height="100%"
            language={detectLang(active.name)}
            value={editorValue}
            theme="weaver"
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            onChange={(value) => {
              if (value === undefined) return;
              const dirty = value !== (active.savedContent ?? value);
              onUpdateContent(active.path, value, dirty || active.savedContent === undefined);
            }}
            options={{
              fontSize: 12,
              fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
              lineNumbers: 'on',
              lineNumbersMinChars: 3,
              glyphMargin: true,
              minimap: { enabled: true, scale: 1, renderCharacters: false },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              tabSize: 2,
              wordWrap: 'off',
              automaticLayout: true,
              bracketPairColorization: { enabled: true },
              guides: {
                bracketPairs: true,
                indentation: true,
              },
              suggestOnTriggerCharacters: true,
              quickSuggestions: { other: true, comments: false, strings: true },
              inlineSuggest: { enabled: true },
              padding: { top: 8, bottom: 8 },
              renderLineHighlight: 'all',
              renderWhitespace: 'selection',
              roundedSelection: true,
              stickyScroll: { enabled: true },
            }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Tema de Monaco que usa nuestras CSS vars
// ============================================================================

let themeDefined = false;

function defineWeaverTheme(monaco: typeof import('monaco-editor')) {
  if (themeDefined) return;
  themeDefined = true;

  // Leer las variables CSS del documento (definidas por themes.ts).
  const css = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const bg = css('--bg-app') || '#0e0f0c';
  const bgSidebar = css('--bg-sidebar') || '#171915';
  const bgElevated = css('--bg-elevated') || '#1e211d';
  const bgInput = css('--bg-input') || '#232722';
  const border = css('--border') || '#2c302b';
  const textPrimary = css('--text-primary') || '#f4f4f0';
  const textSecondary = css('--text-secondary') || '#9ca3a0';
  const textMuted = css('--text-muted') || '#6b736e';
  const accent = css('--accent') || '#8FB89B';
  const warning = css('--warning') || '#e8b86a';
  const danger = css('--danger') || '#e07a5f';
  const success = css('--success') || '#7bae7f';

  monaco.editor.defineTheme('weaver', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: textMuted, fontStyle: 'italic' },
      { token: 'keyword', foreground: accent },
      { token: 'string', foreground: success },
      { token: 'number', foreground: warning },
      { token: 'type', foreground: accent },
      { token: 'function', foreground: textPrimary },
      { token: 'variable', foreground: textPrimary },
      { token: 'identifier', foreground: textSecondary },
    ],
    colors: {
      'editor.background': bg,
      'editor.foreground': textPrimary,
      'editorLineNumber.foreground': textMuted,
      'editorLineNumber.activeForeground': textPrimary,
      'editorCursor.foreground': accent,
      'editor.selectionBackground': accent + '40',
      'editor.inactiveSelectionBackground': accent + '20',
      'editor.selectionHighlightBackground': accent + '20',
      'editor.lineHighlightBackground': bgElevated,
      'editor.lineHighlightBorder': 'transparent',
      'editorIndentGuide.background': border,
      'editorIndentGuide.activeBackground': textMuted,
      'editorGutter.background': bgSidebar,
      'editorGutter.modifiedBackground': warning,
      'editorGutter.addedBackground': success,
      'editorGutter.deletedBackground': danger,
      'editorOverviewRuler.border': border,
      'editorWidget.background': bgElevated,
      'editorWidget.border': border,
      'editorSuggestWidget.background': bgElevated,
      'editorSuggestWidget.border': border,
      'editorSuggestWidget.foreground': textSecondary,
      'editorSuggestWidget.selectedBackground': accent + '20',
      'editorHoverWidget.background': bgElevated,
      'editorHoverWidget.border': border,
      'minimap.background': bgSidebar,
      'scrollbarSlider.background': border,
      'scrollbarSlider.hoverBackground': textMuted,
      'scrollbarSlider.activeBackground': textMuted,
    },
  });

  // Inyectar CSS para las decoraciones de líneas cambiadas.
  if (!document.getElementById('weaver-line-marks')) {
    const style = document.createElement('style');
    style.id = 'weaver-line-marks';
    style.textContent = `
      .line-mark-added {
        background: ${success}22 !important;
        border-left: 2px solid ${success};
      }
      .line-mark-removed {
        background: ${danger}22 !important;
        border-left: 2px solid ${danger};
      }
      .line-mark-modified {
        background: ${warning}22 !important;
        border-left: 2px solid ${warning};
      }
      .glyph-mark-added {
        background: ${success};
        border-radius: 2px;
        width: 4px !important;
        margin-left: 4px;
      }
      .glyph-mark-removed {
        background: ${danger};
        border-radius: 2px;
        width: 4px !important;
        margin-left: 4px;
      }
      .glyph-mark-modified {
        background: ${warning};
        border-radius: 2px;
        width: 4px !important;
        margin-left: 4px;
      }
    `;
    document.head.appendChild(style);
  }
}
