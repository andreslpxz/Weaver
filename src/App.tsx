import { useEffect } from 'react';
import { Menu } from 'lucide-react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Composer } from '@/components/composer/Composer';
import { MessageList, setSuggestionSetter } from '@/components/chat/MessageList';
import {
  ComplementosView,
  HabilidadesView,
  AutomatizacionesView,
  ConfiguracionView,
} from '@/views/Views';
import { MeView } from '@/views/MeView';
import { IdeLayout } from '@/components/ide/IdeLayout';
import { useWeaver } from '@/store/weaver';
import { initTheme } from '@/lib/themes';
import { startScheduler } from '@/lib/scheduler';

export default function App() {
  const { view, loadConversations, themeId, loadMeAll, appMode, setAppMode } = useWeaver();

  // Inicializar tema al montar.
  useEffect(() => {
    initTheme();
  }, []);

  // Re-aplicar tema cuando cambie.
  useEffect(() => {
    initTheme();
  }, [themeId]);

  // Cargar conversaciones desde SQLite (Tauri) o localStorage al iniciar.
  useEffect(() => {
    loadConversations();
    loadMeAll();
  }, [loadConversations, loadMeAll]);

  // Arrancar el motor de Schedules (tareas programadas).
  useEffect(() => {
    startScheduler();
  }, []);

  // === Modo IDE ===
  // El modo IDE tiene su propio layout completo (file explorer, editor,
  // agent panel). Las views no-chat (MeView, ComplementosView, etc.)
  // se siguen renderizando como overlays dentro del IDE.
  if (appMode === 'ide' && view === 'chat') {
    return <IdeLayout onExitToNormal={() => setAppMode('normal')} />;
  }

  // En Modo IDE, si el usuario navega a una view (MCP, Me, etc.), la
  // mostramos dentro del layout del IDE para no perder el contexto.
  if (appMode === 'ide') {
    return (
      <IdeLayoutShell onExitToNormal={() => setAppMode('normal')}>
        {view === 'me' && <MeView />}
        {view === 'complementos' && <ComplementosView />}
        {view === 'habilidades' && <HabilidadesView />}
        {view === 'automatizaciones' && <AutomatizacionesView />}
        {view === 'configuracion' && <ConfiguracionView />}
      </IdeLayoutShell>
    );
  }

  // === Modo Normal ===
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-app-bg text-text-primary">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        {view === 'chat' && (
          <>
            <TopBar />
            <MessageList />
            <Composer />
          </>
        )}
        {view === 'me' && <MeView />}
        {view === 'complementos' && <ComplementosView />}
        {view === 'habilidades' && <HabilidadesView />}
        {view === 'automatizaciones' && <AutomatizacionesView />}
        {view === 'configuracion' && <ConfiguracionView />}
      </main>
    </div>
  );
}

/**
 * Shell que envuelve views (Me, Complementos, etc.) dentro del Modo IDE,
 * preservando el ActivityBar y la status bar pero reemplazando el editor
 * por la view seleccionada.
 */
function IdeLayoutShell({ children, onExitToNormal }: { children: React.ReactNode; onExitToNormal: () => void }) {
  const { setView, setModelPickerOpen, providerId, modelId, ideCwd } = useWeaver();
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-app-bg text-text-primary flex-col">
      <header className="h-9 border-b border-border flex items-center justify-between px-3 shrink-0 bg-app-sidebar">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-text-primary truncate">
            Weaver <span className="text-text-muted">· IDE</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setView('chat')}
            className="text-[11px] text-text-secondary hover:text-text-primary px-2 py-0.5 rounded-codex hover:bg-app-elevated transition-colors"
          >
            ← Volver al editor
          </button>
          <button
            onClick={() => setModelPickerOpen(true)}
            className="text-[11px] text-text-secondary hover:text-text-primary px-2 py-0.5 rounded-codex hover:bg-app-elevated transition-colors truncate max-w-[200px]"
          >
            {providerId} · {modelId}
          </button>
        </div>
      </header>
      <div className="flex-1 flex min-h-0">
        {/* Activity Bar */}
        <div className="w-12 border-r border-border flex flex-col items-center py-2 bg-app-sidebar shrink-0">
          {([
            { id: 'complementos', label: 'MCP / Skills', icon: '🧩' },
            { id: 'automatizaciones', label: 'Schedules', icon: '⏰' },
            { id: 'me', label: 'Me', icon: '📅' },
            { id: 'configuracion', label: 'Configuración', icon: '⚙️' },
            { id: 'chat', label: 'Editor + Agente', icon: '💻' },
          ] as const).map((it) => (
            <button
              key={it.id}
              onClick={() => setView(it.id)}
              title={it.label}
              className="w-9 h-9 rounded-codex flex items-center justify-center mb-1 text-text-muted hover:text-text-primary hover:bg-app-elevated/50 transition-colors text-base"
            >
              {it.icon}
            </button>
          ))}
        </div>
        <main className="flex-1 min-w-0 overflow-hidden">{children}</main>
      </div>
      <footer className="h-6 border-t border-border bg-accent/90 text-app-bg flex items-center justify-between px-2 text-[10px] shrink-0 font-medium">
        <span className="truncate">{ideCwd ?? 'Sin carpeta'}</span>
        <button
          onClick={onExitToNormal}
          className="hover:bg-app-bg/20 px-1.5 py-0.5 rounded"
        >
          Modo Normal →
        </button>
      </footer>
    </div>
  );
}

function TopBar() {
  const { providerId, modelId, setModelPickerOpen } = useWeaver();
  const providerLabel = providerId.charAt(0).toUpperCase() + providerId.slice(1);

  function openSidebar() {
    window.dispatchEvent(new CustomEvent('weaver:open-sidebar'));
  }

  return (
    <header className="h-11 border-b border-border flex items-center justify-between px-2 sm:px-4 shrink-0 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        {/* Botón hamburguesa solo visible en móvil */}
        <button
          onClick={openSidebar}
          className="codex-icon-btn md:hidden"
          title="Abrir menú"
          aria-label="Abrir menú"
        >
          <Menu size={16} />
        </button>
        <div className="text-sm text-text-secondary truncate">Weaver</div>
      </div>
      <button
        onClick={() => setModelPickerOpen(true)}
        className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 rounded-codex hover:bg-app-elevated transition-colors truncate"
      >
        {providerLabel} · {modelId}
      </button>
    </header>
  );
}

// Conectar suggestion setter con el composer vía un mini-bus.
// El composer lee del textarea local, así que necesitamos un puente.
let pendingSuggestion: string | null = null;
export function setComposerValue(text: string) {
  pendingSuggestion = text;
  window.dispatchEvent(new CustomEvent('weaver:set-composer', { detail: text }));
}

// En App, escuchar el evento y enviarlo al composer via el setter.
if (typeof window !== 'undefined') {
  setSuggestionSetter((text) => setComposerValue(text));
}
