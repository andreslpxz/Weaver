/**
 * ActivityBar — barra estrecha de iconos al estilo VSCode.
 * Preserva los accesos del modo Normal: MCP, Schedules, Me, Configuración.
 * Permite volver al modo Normal rápidamente.
 */

import {
  Puzzle,
  Clock,
  CalendarDays,
  Settings as SettingsIcon,
  MessageSquare,
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

export function ActivityBar() {
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
