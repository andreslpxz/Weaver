/**
 * AgentPanel — panel lateral derecho del Modo IDE que aloja el agente.
 *
 * Reutiliza MessageList + Composer del modo Normal. Como ambos componentes
 * leen/escriben directamente el store de Weaver, no hay que duplicar lógica
 * del agente: el mismo conversation loop funciona en ambos modos.
 *
 * La diferencia con el modo Normal es puramente visual:
 *  - Ancho fijo (w-96)
 *  - Sin bordes ni topbar redundante (la topbar del IDE ya está arriba)
 *  - El composer se reduce visualmente para encajar en 384px
 */

import { useEffect } from 'react';
import { MessageList } from '@/components/chat/MessageList';
import { Composer } from '@/components/composer/Composer';

export function AgentPanel() {
  // Forzar que el layout interno del MessageList/Composer no tenga
  // paddings laterales grandes para encajar en 384px.
  useEffect(() => {
    document.documentElement.classList.add('ide-mode');
    return () => {
      document.documentElement.classList.remove('ide-mode');
    };
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-app-bg">
      {/* Mensajes del chat */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <MessageList />
      </div>

      {/* Composer compacto */}
      <div className="border-t border-border shrink-0">
        <Composer />
      </div>
    </div>
  );
}
