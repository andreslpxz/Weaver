import { useEffect } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Composer } from '@/components/composer/Composer';
import { MessageList, setSuggestionSetter } from '@/components/chat/MessageList';
import {
  ComplementosView,
  HabilidadesView,
  AutomatizacionesView,
  ConfiguracionView,
} from '@/views/Views';
import { useWeaver } from '@/store/weaver';

export default function App() {
  const { view, newConversation } = useWeaver();

  // Inicializar conversación si no hay ninguna.
  useEffect(() => {
    if (useWeaver.getState().conversations.length === 0) {
      newConversation();
    }
  }, [newConversation]);

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
  return (
    <header className="h-11 border-b border-border flex items-center justify-between px-4 shrink-0">
      <div className="text-sm text-text-secondary">Weaver</div>
      <button
        onClick={() => setModelPickerOpen(true)}
        className="text-xs text-text-secondary hover:text-text-primary px-2 py-1 rounded-codex hover:bg-app-elevated transition-colors"
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
