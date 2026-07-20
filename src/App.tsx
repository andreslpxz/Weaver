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
import { useWeaver } from '@/store/weaver';
import { initTheme } from '@/lib/themes';
import { startScheduler } from '@/lib/scheduler';

export default function App() {
  const { view, loadConversations, themeId, loadMeAll } = useWeaver();

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
