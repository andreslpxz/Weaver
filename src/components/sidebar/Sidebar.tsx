import {
  Plus,
  Search,
  Puzzle,
  Cog,
  Sparkles,
  MessageSquare,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useWeaver, type ViewId } from '@/store/weaver';
import { cn } from '@/components/common/Button';

interface SidebarItem {
  id: ViewId | 'new-chat' | 'search';
  label: string;
  icon: React.ReactNode;
  badge?: number;
}

const SECTIONS: { title: string; items: SidebarItem[] }[] = [
  {
    title: '',
    items: [
      { id: 'new-chat', label: 'Nuevo chat', icon: <Plus size={14} /> },
      { id: 'search', label: 'Buscar', icon: <Search size={14} /> },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { id: 'complementos', label: 'Complementos', icon: <Puzzle size={14} /> },
      { id: 'automatizaciones', label: 'Automatizaciones', icon: <Sparkles size={14} /> },
    ],
  },
];

export function Sidebar() {
  const {
    sidebarCollapsed,
    toggleSidebar,
    view,
    setView,
    newConversation,
    conversations,
    activeConversationId,
    selectConversation,
    deleteConversation,
  } = useWeaver();

  if (sidebarCollapsed) {
    return (
      <aside className="w-12 bg-app-sidebar border-r border-border flex flex-col items-center py-3 gap-2">
        <button onClick={toggleSidebar} className="codex-icon-btn" title="Expandir sidebar">
          <ChevronRight size={16} />
        </button>
        <button onClick={() => newConversation()} className="codex-icon-btn" title="Nuevo chat">
          <Plus size={16} />
        </button>
        <button onClick={() => setView('complementos')} className="codex-icon-btn" title="Complementos">
          <Puzzle size={16} />
        </button>
        <button onClick={() => setView('configuracion')} className="codex-icon-btn mt-auto" title="Configuración">
          <Cog size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-60 bg-app-sidebar border-r border-border flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-12 border-b border-border">
        <div className="flex items-center gap-2">
          <WeaverLogo />
          <span className="font-semibold text-sm">Weaver</span>
        </div>
        <button onClick={toggleSidebar} className="codex-icon-btn" title="Colapsar">
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        {SECTIONS.map((section, idx) => (
          <div key={idx}>
            {section.title && (
              <div className="sidebar-section-title">{section.title}</div>
            )}
            {section.items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'new-chat') newConversation();
                  else if (item.id === 'search') setView('chat');
                  else setView(item.id as ViewId);
                }}
                className={cn('sidebar-item w-full text-left', view === item.id && 'active')}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span className="text-xs text-text-muted">{item.badge}</span>
                )}
              </button>
            ))}
          </div>
        ))}

        {/* Proyectos / conversaciones recientes */}
        <div className="sidebar-section-title">Proyectos</div>
        {conversations.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-text-muted">Sin conversaciones</div>
        )}
        {conversations.map((c) => (
          <div
            key={c.id}
            className={cn(
              'group flex items-center gap-2 px-2 py-1.5 rounded-codex text-sm cursor-pointer',
              'text-text-secondary hover:text-text-primary hover:bg-app-elevated transition-colors',
              c.id === activeConversationId && 'bg-app-elevated text-text-primary',
            )}
            onClick={() => selectConversation(c.id)}
          >
            <MessageSquare size={14} className="shrink-0" />
            <span className="flex-1 truncate">{c.title || 'Nuevo chat'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteConversation(c.id);
              }}
              className="opacity-0 group-hover:opacity-100 codex-icon-btn w-6 h-6"
              title="Eliminar"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setView('configuracion')}
          className={cn('sidebar-item w-full text-left', view === 'configuracion' && 'active')}
        >
          <Cog size={14} />
          <span className="flex-1">Configuración</span>
        </button>
      </div>
    </aside>
  );
}

function WeaverLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 20L20 4M4 4L20 20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-accent"
      />
      <circle cx="12" cy="12" r="3" className="fill-accent" />
    </svg>
  );
}
