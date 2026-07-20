import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Puzzle,
  Cog,
  MessageSquare,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderPlus,
  MoreHorizontal,
  CalendarDays,
  X,
  Clock,
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
      { id: 'me', label: 'ME', icon: <CalendarDays size={14} /> },
      { id: 'complementos', label: 'Complementos', icon: <Puzzle size={14} /> },
      { id: 'automatizaciones', label: 'Schedules', icon: <Clock size={14} /> },
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
    projects,
    loadProjects,
    createProject,
    deleteProject,
    setConversationProject,
    loadMessages,
  } = useWeaver();

  const [showProjectInput, setShowProjectInput] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [convMenuFor, setConvMenuFor] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Atajo: Ctrl/Cmd+K abre la búsqueda.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        setView('chat');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setView]);

  // Resultados de búsqueda: filtra por título del chat y por contenido de mensajes.
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return conversations
      .filter((c) => {
        if (c.title.toLowerCase().includes(q)) return true;
        // Buscar en mensajes (puede ser que estén lazy-load; si messages es [] no hay coincidencia).
        return c.messages.some((m) => (m.content ?? '').toLowerCase().includes(q));
      })
      .slice(0, 30)
      .map((c) => ({
        conv: c,
        matchInTitle: c.title.toLowerCase().includes(q),
        snippet: (() => {
          // Extraer snippet del mensaje que coincide.
          for (const m of c.messages) {
            const content = (m.content ?? '').toLowerCase();
            const idx = content.indexOf(q);
            if (idx >= 0) {
              const start = Math.max(0, idx - 30);
              const end = Math.min((m.content ?? '').length, idx + q.length + 30);
              return '…' + (m.content ?? '').slice(start, end) + '…';
            }
          }
          return '';
        })(),
      }));
  }, [searchQuery, conversations]);

  // Agrupar conversaciones por proyecto
  const convsByProject = new Map<string | null, typeof conversations>();
  for (const c of conversations) {
    const key = c.projectId ?? null;
    if (!convsByProject.has(key)) convsByProject.set(key, []);
    convsByProject.get(key)!.push(c);
  }

  if (sidebarCollapsed) {
    return (
      <aside className="w-12 bg-app-sidebar border-r border-border flex flex-col items-center py-3 gap-2">
        <button onClick={toggleSidebar} className="codex-icon-btn" title="Expandir sidebar">
          <ChevronRight size={16} />
        </button>
        <button onClick={() => newConversation()} className="codex-icon-btn" title="Nuevo chat">
          <Plus size={16} />
        </button>
        <button
          onClick={() => {
            setSearchOpen(true);
            setView('chat');
          }}
          className="codex-icon-btn"
          title="Buscar"
        >
          <Search size={16} />
        </button>
        <button onClick={() => setView('me')} className="codex-icon-btn" title="ME">
          <CalendarDays size={16} />
        </button>
        <button onClick={() => setView('complementos')} className="codex-icon-btn" title="Complementos">
          <Puzzle size={16} />
        </button>
        <button onClick={() => setView('automatizaciones')} className="codex-icon-btn" title="Schedules">
          <Clock size={16} />
        </button>
        <button onClick={() => setView('configuracion')} className="codex-icon-btn mt-auto" title="Configuración">
          <Cog size={16} />
        </button>
      </aside>
    );
  }

  function toggleProject(id: string) {
    setOpenProjects((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function addProject() {
    if (!newProjectName.trim()) return;
    await createProject(newProjectName.trim());
    setNewProjectName('');
    setShowProjectInput(false);
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
            {section.title && <div className="sidebar-section-title">{section.title}</div>}
            {section.items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  if (item.id === 'new-chat') newConversation();
                  else if (item.id === 'search') {
                    setSearchOpen(true);
                    setView('chat');
                  } else setView(item.id as ViewId);
                }}
                className={cn('sidebar-item w-full text-left', view === item.id && 'active')}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.badge && <span className="text-xs text-text-muted">{item.badge}</span>}
              </button>
            ))}
          </div>
        ))}

        {/* Buscador de chats */}
        {searchOpen && (
          <div className="mt-2 mb-1 p-2 rounded-codex border border-border-accent bg-app-elevated">
            <div className="flex items-center gap-1 mb-1">
              <Search size={12} className="text-text-muted shrink-0" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchOpen(false);
                    setSearchQuery('');
                  }
                  if (e.key === 'Enter' && searchResults.length > 0) {
                    const first = searchResults[0];
                    if (first) {
                      selectConversation(first.conv.id);
                      setSearchOpen(false);
                      setSearchQuery('');
                    }
                  }
                }}
                placeholder="Buscar en chats…"
                className="codex-input flex-1 px-2 py-1 text-xs bg-transparent border-0 focus:outline-none"
              />
              <button
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery('');
                }}
                className="codex-icon-btn w-5 h-5 shrink-0"
                title="Cerrar búsqueda"
              >
                <X size={10} />
              </button>
            </div>
            {searchQuery.trim() && (
              <div className="max-h-80 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <div className="text-[11px] text-text-muted px-1 py-2 italic">
                    Sin resultados. Nota: chats antiguos pueden tener mensajes sin cargar.
                  </div>
                ) : (
                  searchResults.map(({ conv, matchInTitle, snippet }) => (
                    <button
                      key={conv.id}
                      onClick={() => {
                        selectConversation(conv.id);
                        // Forzar carga de mensajes si están lazy-load.
                        if (conv.messages.length === 0) loadMessages(conv.id);
                        setSearchOpen(false);
                        setSearchQuery('');
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-codex hover:bg-app-input transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <MessageSquare size={11} className="text-text-muted shrink-0" />
                        <span className="text-xs font-medium truncate flex-1">{conv.title || 'Nuevo chat'}</span>
                        {matchInTitle && (
                          <span className="text-[9px] bg-accent/15 text-accent px-1 rounded-full">título</span>
                        )}
                      </div>
                      {snippet && (
                        <div className="text-[10px] text-text-muted mt-0.5 truncate">{snippet}</div>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Proyectos */}
        <div className="sidebar-section-title flex items-center justify-between">
          <span>Proyectos</span>
          <button
            onClick={() => setShowProjectInput((v) => !v)}
            className="codex-icon-btn w-4 h-4"
            title="Nuevo proyecto"
          >
            <FolderPlus size={10} />
          </button>
        </div>

        {showProjectInput && (
          <div className="px-1 py-1 flex gap-1">
            <input
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addProject();
                if (e.key === 'Escape') {
                  setShowProjectInput(false);
                  setNewProjectName('');
                }
              }}
              placeholder="Nombre del proyecto"
              className="codex-input flex-1 px-2 py-1 text-xs"
            />
            <button onClick={addProject} className="codex-btn codex-btn-primary !p-1">
              <Plus size={10} />
            </button>
          </div>
        )}

        {/* Conversaciones sin proyecto */}
        {(convsByProject.get(null) ?? []).length > 0 && (
          <div className="mt-2">
            <div className="sidebar-section-title">Sin proyecto</div>
            {(convsByProject.get(null) ?? []).map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                active={c.id === activeConversationId}
                onClick={() => selectConversation(c.id)}
                onDelete={() => deleteConversation(c.id)}
                menuOpen={convMenuFor === c.id}
                onMenuToggle={() => setConvMenuFor(convMenuFor === c.id ? null : c.id)}
                onMoveToProject={async (pid) => {
                  await setConversationProject(c.id, pid);
                  setConvMenuFor(null);
                }}
              />
            ))}
          </div>
        )}

        {/* Proyectos con sus conversaciones */}
        {projects.map((p) => {
          const isOpen = openProjects.has(p.id);
          const convs = convsByProject.get(p.id) ?? [];
          return (
            <div key={p.id} className="mt-1">
              <div className="group flex items-center gap-1 px-1 py-1 rounded-codex hover:bg-app-elevated transition-colors">
                <button
                  onClick={() => toggleProject(p.id)}
                  className="codex-icon-btn w-4 h-4"
                  title={isOpen ? 'Colapsar' : 'Expandir'}
                >
                  {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </button>
                <Folder size={12} className="text-accent shrink-0" />
                <span className="flex-1 text-sm text-text-primary truncate">{p.name}</span>
                <span className="text-[10px] text-text-muted">{convs.length}</span>
                <button
                  onClick={() => {
                    if (confirm(`¿Eliminar proyecto "${p.name}"? Las conversaciones se moverán a "Sin proyecto".`)) {
                      deleteProject(p.id);
                    }
                  }}
                  className="codex-icon-btn w-4 h-4 opacity-0 group-hover:opacity-100"
                  title="Eliminar proyecto"
                >
                  <Trash2 size={10} />
                </button>
              </div>
              {isOpen && (
                <div className="ml-3 border-l border-border pl-1">
                  {convs.length === 0 ? (
                    <div className="px-2 py-1 text-[10px] text-text-muted italic">vacío</div>
                  ) : (
                    convs.map((c) => (
                      <ConversationRow
                        key={c.id}
                        conv={c}
                        active={c.id === activeConversationId}
                        onClick={() => selectConversation(c.id)}
                        onDelete={() => deleteConversation(c.id)}
                        menuOpen={convMenuFor === c.id}
                        onMenuToggle={() => setConvMenuFor(convMenuFor === c.id ? null : c.id)}
                        onMoveToProject={async (pid) => {
                          await setConversationProject(c.id, pid);
                          setConvMenuFor(null);
                        }}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {projects.length === 0 && (convsByProject.get(null) ?? []).length === 0 && (
          <div className="px-2 py-1.5 text-xs text-text-muted">Sin conversaciones</div>
        )}
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

function ConversationRow({
  conv,
  active,
  onClick,
  onDelete,
  menuOpen,
  onMenuToggle,
  onMoveToProject,
}: {
  conv: { id: string; title: string; projectId: string | null };
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMoveToProject: (pid: string | null) => void;
}) {
  const projects = useWeaver((s) => s.projects);
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 rounded-codex text-sm cursor-pointer',
        'text-text-secondary hover:text-text-primary hover:bg-app-elevated transition-colors',
        active && 'bg-app-elevated text-text-primary',
      )}
      onClick={onClick}
    >
      <MessageSquare size={14} className="shrink-0" />
      <span className="flex-1 truncate">{conv.title || 'Nuevo chat'}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMenuToggle();
        }}
        className="opacity-0 group-hover:opacity-100 codex-icon-btn w-5 h-5"
        title="Mover a proyecto"
      >
        <MoreHorizontal size={12} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 codex-icon-btn w-5 h-5"
        title="Eliminar"
      >
        <Trash2 size={10} />
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 mt-32 z-30 w-48 bg-app-elevated border border-border-accent rounded-codex shadow-2xl animate-slide-up overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] text-text-muted uppercase">Mover a</div>
          <button
            onClick={() => onMoveToProject(null)}
            className="w-full text-left px-2 py-1 text-xs hover:bg-app-input"
          >
            Sin proyecto
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onMoveToProject(p.id)}
              className="w-full text-left px-2 py-1 text-xs hover:bg-app-input flex items-center gap-1"
            >
              <Folder size={10} className="text-accent" />
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
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
