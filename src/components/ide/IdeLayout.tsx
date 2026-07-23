/**
 * IdeLayout — Layout estilo IDE (VSCode / OpenCode / Antigravity).
 *
 * Estructura:
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │ TopBar: proyecto + provider/modelo + toggle Normal/IDE       │
 *  ├──────┬──────────────┬──────────────────────┬─────────────────┤
 *  │ Act  │ FileExplorer │ CodeEditor (tabs)    │ AgentPanel      │
 *  │ Bar  │              │                      │                 │
 *  │      │              ├──────────────────────┤                 │
 *  │      │              │ DiffViewer (cambios) │                 │
 *  ├──────┴──────────────┴──────────────────────┴─────────────────┤
 *  │ StatusBar: cwd | archivo activo | líneas | provider · model   │
 *  └─────────────────────────────────────────────────────────────┘
 *
 * El ActivityBar (izq, estrecho) preserva los accesos del modo Normal:
 * MCP, Schedules, Me, Configuración.
 *
 * El AgentPanel reutiliza MessageList + Composer del modo chat para no
 * duplicar la lógica del agente.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  PanelLeftClose,
  PanelRightClose,
  Code2,
  MessageSquare,
  GitBranch,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import { runtime } from '@/lib/tauri';
import { ActivityBar } from './ActivityBar';
import { FileExplorer } from './FileExplorer';
import { CodeEditor, type EditorTab } from './CodeEditor';
import { AgentPanel } from './AgentPanel';
import { DiffViewer, type FileChange } from './DiffViewer';
import { StatusBar } from './StatusBar';
import { CwdPicker } from './CwdPicker';

export interface IdeLayoutProps {
  /** Cambia al modo Normal (desde el botón del topbar). */
  onExitToNormal: () => void;
}

export function IdeLayout({ onExitToNormal }: IdeLayoutProps) {
  const { ideCwd, providerId, modelId, setModelPickerOpen } = useWeaver();
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(true);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [showCwdPicker, setShowCwdPicker] = useState(!ideCwd);

  // Si el usuario cambia el cwd después de tenerlo vacío, ocultamos el picker.
  useEffect(() => {
    if (ideCwd) setShowCwdPicker(false);
  }, [ideCwd]);

  const openFile = useCallback((path: string, name: string) => {
    setTabs((prev) => {
      if (prev.some((t) => t.path === path)) return prev;
      return [...prev, { path, name, content: '', dirty: false, loading: true }];
    });
    setActiveTab(path);
  }, []);

  const updateTabContent = useCallback((path: string, content: string, dirty: boolean) => {
    setTabs((prev) => prev.map((t) => (t.path === path ? { ...t, content, dirty } : t)));
  }, []);

  function closeTab(path: string) {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      const next = prev.filter((t) => t.path !== path);
      if (activeTab === path) {
        const newActive = next[idx]?.path ?? next[idx - 1]?.path ?? next[0]?.path ?? null;
        setActiveTab(newActive);
      }
      return next;
    });
  }

  // Cuando el agente termina de ejecutar tools de escritura, podemos
  // detectar qué archivos tocó y mostrarlos en el DiffViewer. Por ahora,
  // DiffViewer escucha eventos `weaver:agent-file-change` emitidos desde
  // el loop del agente (o desde el shell_exec en Tauri).
  useEffect(() => {
    function onAgentChange(e: Event) {
      const detail = (e as CustomEvent<FileChange>).detail;
      if (!detail) return;
      setChanges((prev) => {
        // Reemplazar si ya existe para ese path.
        const filtered = prev.filter((c) => c.path !== detail.path);
        return [detail, ...filtered].slice(0, 50);
      });
    }
    window.addEventListener('weaver:agent-file-change', onAgentChange);
    return () => window.removeEventListener('weaver:agent-file-change', onAgentChange);
  }, []);

  const activeTabObj = tabs.find((t) => t.path === activeTab) ?? null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-app-bg text-text-primary flex-col">
      {/* ===== Top Bar ===== */}
      <header className="h-9 border-b border-border flex items-center justify-between px-3 shrink-0 bg-app-sidebar">
        <div className="flex items-center gap-2 min-w-0">
          <Code2 size={14} className="text-accent shrink-0" />
          <span className="text-xs font-medium text-text-primary truncate">
            Weaver <span className="text-text-muted">· IDE</span>
          </span>
          {ideCwd && (
            <span className="text-[10px] text-text-muted font-mono truncate ml-2 hidden sm:inline">
              {ideCwd}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setModelPickerOpen(true)}
            className="text-[11px] text-text-secondary hover:text-text-primary px-2 py-0.5 rounded-codex hover:bg-app-elevated transition-colors truncate max-w-[200px]"
            title="Cambiar modelo"
          >
            {providerId} · {modelId}
          </button>
          <button
            onClick={() => setShowCwdPicker(true)}
            className="text-[10px] text-text-muted hover:text-text-primary px-2 py-0.5 rounded-codex hover:bg-app-elevated transition-colors"
            title="Cambiar carpeta de trabajo"
          >
            <GitBranch size={11} className="inline mr-1" />
            Carpeta
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            onClick={onExitToNormal}
            className="text-[11px] text-text-secondary hover:text-text-primary px-2 py-0.5 rounded-codex hover:bg-app-elevated transition-colors flex items-center gap-1"
            title="Volver al modo Normal"
          >
            <MessageSquare size={11} />
            Normal
          </button>
        </div>
      </header>

      {/* ===== Body ===== */}
      <div className="flex-1 flex min-h-0">
        {/* Activity Bar (iconos fijos) */}
        <ActivityBar />

        {/* File Explorer (panel izquierdo, colapsable) */}
        {leftOpen && (
          <div className="w-56 border-r border-border flex flex-col min-h-0 bg-app-sidebar">
            <div className="h-7 flex items-center justify-between px-2 border-b border-border">
              <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                Explorador
              </span>
              <button
                onClick={() => setLeftOpen(false)}
                className="codex-icon-btn w-5 h-5"
                title="Ocultar panel"
              >
                <PanelLeftClose size={12} />
              </button>
            </div>
            <FileExplorer cwd={ideCwd} onOpenFile={openFile} activePath={activeTab} />
          </div>
        )}

        {/* Center: editor + diff (colapsable) */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Editor area */}
          <div className="flex-1 min-h-0 flex flex-col">
            {tabs.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
                <div className="text-center">
                  <Code2 size={32} className="mx-auto mb-2 opacity-40" />
                  <div>Abre un archivo desde el explorador</div>
                  {!ideCwd && (
                    <button
                      onClick={() => setShowCwdPicker(true)}
                      className="mt-3 codex-btn-primary px-3 py-1.5 text-xs rounded-codex"
                    >
                      Elegir carpeta de trabajo
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <CodeEditor
                tabs={tabs}
                activeTab={activeTab}
                onSelectTab={setActiveTab}
                onCloseTab={closeTab}
                onUpdateContent={updateTabContent}
              />
            )}
          </div>

          {/* Diff viewer (bottom) */}
          {bottomOpen && (
            <div className="h-44 border-t border-border flex flex-col min-h-0">
              <div className="h-7 flex items-center justify-between px-2 border-b border-border bg-app-sidebar">
                <div className="flex items-center gap-2">
                  <GitBranch size={11} className="text-accent" />
                  <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                    Cambios del agente
                  </span>
                  {changes.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/20 text-accent">
                      {changes.length}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {changes.length > 0 && (
                    <button
                      onClick={() => setChanges([])}
                      className="text-[10px] text-text-muted hover:text-text-primary px-1.5 py-0.5 rounded"
                    >
                      Limpiar
                    </button>
                  )}
                  <button
                    onClick={() => setBottomOpen(false)}
                    className="codex-icon-btn w-5 h-5"
                    title="Ocultar panel"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              <DiffViewer changes={changes} onOpenFile={openFile} />
            </div>
          )}
        </div>

        {/* Agent Panel (derecha, colapsable) */}
        {rightOpen ? (
          <div className="w-96 border-l border-border flex flex-col min-h-0 bg-app-sidebar">
            <div className="h-7 flex items-center justify-between px-2 border-b border-border">
              <div className="flex items-center gap-1.5">
                <MessageSquare size={11} className="text-accent" />
                <span className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
                  Agente
                </span>
              </div>
              <button
                onClick={() => setRightOpen(false)}
                className="codex-icon-btn w-5 h-5"
                title="Ocultar panel"
              >
                <PanelRightClose size={12} />
              </button>
            </div>
            <AgentPanel />
          </div>
        ) : null}
      </div>

      {/* ===== Status Bar ===== */}
      <StatusBar
        cwd={ideCwd}
        activeFile={activeTabObj?.name ?? null}
        activePath={activeTabObj?.path ?? null}
        lineCount={activeTabObj ? activeTabObj.content.split('\n').length : 0}
        isDirty={activeTabObj?.dirty ?? false}
        tabsCount={tabs.length}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        bottomOpen={bottomOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onToggleBottom={() => setBottomOpen((v) => !v)}
      />

      {/* ===== Cwd Picker Modal ===== */}
      {showCwdPicker && (
        <CwdPicker onClose={() => setShowCwdPicker(false)} />
      )}

      {/* Aviso en modo navegador (sin Tauri) */}
      {!runtime.isTauri && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-warning/10 border border-warning/40 text-warning text-[10px] px-3 py-1 rounded-full pointer-events-none">
          Modo navegador: las operaciones de archivos requieren Tauri
        </div>
      )}
    </div>
  );
}
