/**
 * ActivityBar — barra estrecha de iconos al estilo VSCode.
 *
 * Combina:
 *  - Accesos del modo Normal: MCP, Schedules, Me, Configuración
 *  - Toggle de paneles del IDE: explorador, terminal/cambios, agente
 *  - Botón para volver al modo Normal
 *
 * Los toggles de paneles aquí son CRÍTICOS: cuando un panel se oculta
 * desde su propio botón interior, el ActivityBar es el único lugar
 * desde donde se puede volver a mostrar (sin reiniciar la app).
 */

import {
  Puzzle,
  Clock,
  CalendarDays,
  Settings as SettingsIcon,
  MessageSquare,
  PanelLeft,
  PanelRight,
  PanelBottom,
} from 'lucide-react';
import { useWeaver, type ViewId } from '@/store/weaver';
import { cn } from '@/components/common/Button';

interface ActivityItem {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
}

const ITEMS: ActivityItem[] = [
  { id: 'complementos', label: 'MCP / Skills', icon: <Puzzle size={16} /> },
  { id: 'automatizaciones', label: 'Schedules', icon: <Clock size={16} /> },
  { id: 'me', label: 'Me', icon: <CalendarDays size={16} /> },
  { id: 'configuracion', label: 'Configuración', icon: <SettingsIcon size={16} /> },
];

interface ActivityBarProps {
  leftOpen: boolean;
  rightOpen: boolean;
  bottomOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleBottom: () => void;
}

export function ActivityBar({
  leftOpen,
  rightOpen,
  bottomOpen,
  onToggleLeft,
  onToggleRight,
  onToggleBottom,
}: ActivityBarProps) {
  const { view, setView, setAppMode } = useWeaver();

  return (
    <div className="w-12 border-r border-border flex flex-col items-center py-2 bg-app-sidebar shrink-0">
      {ITEMS.map((it) => {
        const active = view === it.id;
        return (
          <button
            key={it.id}
            onClick={() => setView(it.id)}
            title={it.label}
            className={cn(
              'w-9 h-9 rounded-codex flex items-center justify-center mb-1 relative transition-colors',
              active
                ? 'text-text-primary bg-app-elevated'
                : 'text-text-muted hover:text-text-primary hover:bg-app-elevated/50',
            )}
          >
            {it.icon}
            {active && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-r" />
            )}
          </button>
        );
      })}

      {/* Separador */}
      <div className="w-6 h-px bg-border my-1" />

      {/* Toggles de paneles IDE */}
      <button
        onClick={onToggleLeft}
        title={leftOpen ? 'Ocultar explorador' : 'Mostrar explorador'}
        className={cn(
          'w-9 h-9 rounded-codex flex items-center justify-center mb-1 transition-colors',
          leftOpen
            ? 'text-text-primary bg-app-elevated'
            : 'text-text-muted hover:text-text-primary hover:bg-app-elevated/50',
        )}
      >
        <PanelLeft size={16} />
        {leftOpen && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-r" />
        )}
      </button>

      <button
        onClick={onToggleBottom}
        title={bottomOpen ? 'Ocultar panel inferior' : 'Mostrar panel inferior'}
        className={cn(
          'w-9 h-9 rounded-codex flex items-center justify-center mb-1 transition-colors',
          bottomOpen
            ? 'text-text-primary bg-app-elevated'
            : 'text-text-muted hover:text-text-primary hover:bg-app-elevated/50',
        )}
      >
        <PanelBottom size={16} />
        {bottomOpen && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-r" />
        )}
      </button>

      <button
        onClick={onToggleRight}
        title={rightOpen ? 'Ocultar agente' : 'Mostrar agente'}
        className={cn(
          'w-9 h-9 rounded-codex flex items-center justify-center mb-1 transition-colors',
          rightOpen
            ? 'text-text-primary bg-app-elevated'
            : 'text-text-muted hover:text-text-primary hover:bg-app-elevated/50',
        )}
      >
        <PanelRight size={16} />
        {rightOpen && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-accent rounded-r" />
        )}
      </button>

      <div className="flex-1" />

      <button
        onClick={() => setAppMode('normal')}
        title="Volver a modo Normal"
        className="w-9 h-9 rounded-codex flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-app-elevated/50 transition-colors"
      >
        <MessageSquare size={16} />
      </button>
    </div>
  );
}
