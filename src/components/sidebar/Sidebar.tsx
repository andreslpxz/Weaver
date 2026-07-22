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
  Menu,
  Users,
  UserCircle,
  Lock,
} from 'lucide-react';
import { useWeaver, type ViewId, type Project, type ProjectMember } from '@/store/weaver';
import { cn } from '@/components/common/Button';
import { WeaverLogo } from '@/components/common/WeaverLogo';
import { useT } from '@/lib/i18n';
import { sqlite, runtime } from '@/lib/tauri';
import { ProjectSettingsModal } from '@/components/projects/ProjectSettingsModal';

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
      { id: 'new-chat', label: 'sidebar.newChat', icon: <Plus size={14} /> },
      { id: 'search', label: 'sidebar.search', icon: <Search size={14} /> },
    ],
  },
  {
    title: 'sidebar.workspace',
    items: [
      { id: 'me', label: 'sidebar.me', icon: <CalendarDays size={14} /> },
      { id: 'complementos', label: 'sidebar.complementos', icon: <Puzzle size={14} /> },
      { id: 'automatizaciones', label: 'sidebar.schedules', icon: <Clock size={14} /> },
    ],
  },
];

export function Sidebar() {
  const t = useT();
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
    members,
    loadMembers,
    activeMemberId,
    setActiveMember,
  } = useWeaver();

  const [showProjectInput, setShowProjectInput] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [convMenuFor, setConvMenuFor] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [settingsFor, setSettingsFor] = useState<Project | null>(null);
  /** Miembro pendiente de activar (esperando contraseña si la tiene). */
  const [pendingMember, setPendingMember] = useState<ProjectMember | null>(null);
  const [pwPrompt, setPwPrompt] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  /** Proyecto expandido para mostrar su switcher de miembros. */
  const [memberSwitcherFor, setMemberSwitcherFor] = useState<string | null>(null);

  // Detección de viewport móvil.
  const [isMobile, setIsMobile] = useState(false);
  // En móvil, el sidebar es un overlay abierto/cerrado.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // En móvil: cuando cambias de vista, cerrar el overlay.
  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [view, isMobile]);

  // Exponer un método global para abrir el sidebar desde la TopBar.
  // (App.tsx puede invocarlo vía evento.)
  useEffect(() => {
    const handler = () => setMobileOpen(true);
    window.addEventListener('weaver:open-sidebar', handler);
    return () => window.removeEventListener('weaver:open-sidebar', handler);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Cargar miembros del proyecto cuando se expande su switcher.
  useEffect(() => {
    if (memberSwitcherFor) loadMembers(memberSwitcherFor);
  }, [memberSwitcherFor, loadMembers]);

  // Cerrar switcher de miembros si el proyecto se borra.
  useEffect(() => {
    if (memberSwitcherFor && !projects.find((p) => p.id === memberSwitcherFor)) {
      setMemberSwitcherFor(null);
    }
  }, [projects, memberSwitcherFor]);

  /** Cambia al miembro indicado. Si tiene contraseña, pídele primero.
   *  Si no tiene, actívalo directamente. */
  async function switchToMember(m: ProjectMember) {
    if (m.passwordHash) {
      setPendingMember(m);
      setPwPrompt('');
      setPwError(null);
    } else {
      setActiveMember(m.id);
    }
  }

  /** Verifica la contraseña del miembro pendiente y lo activa si coincide. */
  async function confirmMemberPassword() {
    if (!pendingMember) return;
    try {
      const ok = runtime.isTauri
        ? await sqlite.verifyMemberPassword(pendingMember.id, pwPrompt)
        : true;
      if (ok) {
        setActiveMember(pendingMember.id);
        setPendingMember(null);
        setPwPrompt('');
        setPwError(null);
      } else {
        setPwError('Contraseña incorrecta.');
      }
    } catch (e) {
      setPwError(`Error: ${e}`);
    }
  }

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

  // En móvil: el sidebar colapsado no se renderiza nunca.
  // El sidebar expandido se renderiza como overlay (drawer) si mobileOpen.
  if (isMobile && !mobileOpen) return null;

  // Wrapper classes: en móvil es un drawer fijo; en desktop es estático.
  const wrapperClass = isMobile
    ? 'fixed left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-app-sidebar border-r border-border flex flex-col z-50 shadow-2xl'
    : 'w-60 bg-app-sidebar border-r border-border flex flex-col';

  // En móvil: backdrop detrás del sidebar.
  const backdrop = isMobile ? (
    <div
      className="fixed inset-0 bg-black/50 z-40 md:hidden"
      onClick={() => setMobileOpen(false)}
    />
  ) : null;

  if (sidebarCollapsed && !isMobile) {
    return (
      <aside className="w-12 bg-app-sidebar border-r border-border flex flex-col items-center py-3 gap-2">
        <button onClick={toggleSidebar} className="codex-icon-btn" title={t('sidebar.expand')}>
          <ChevronRight size={16} />
        </button>
        <button onClick={() => newConversation()} className="codex-icon-btn" title={t('sidebar.newChat')}>
          <Plus size={16} />
        </button>
        <button
          onClick={() => {
            setSearchOpen(true);
            setView('chat');
          }}
          className="codex-icon-btn"
          title={t('sidebar.search')}
        >
          <Search size={16} />
        </button>
        <button onClick={() => setView('me')} className="codex-icon-btn" title={t('sidebar.me')}>
          <CalendarDays size={16} />
        </button>
        <button onClick={() => setView('complementos')} className="codex-icon-btn" title={t('sidebar.complementos')}>
          <Puzzle size={16} />
        </button>
        <button onClick={() => setView('automatizaciones')} className="codex-icon-btn" title={t('sidebar.schedules')}>
          <Clock size={16} />
        </button>
        <button onClick={() => setView('configuracion')} className="codex-icon-btn mt-auto" title={t('sidebar.configuracion')}>
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
    <>
      {backdrop}
      <aside className={wrapperClass}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-12 border-b border-border">
        <div className="flex items-center gap-2 text-accent">
          <WeaverLogo size={20} />
          <span className="font-semibold text-sm text-text-primary">Weaver</span>
        </div>
        {isMobile ? (
          <button onClick={() => setMobileOpen(false)} className="codex-icon-btn" title={t('sidebar.searchClose')}>
            <X size={14} />
          </button>
        ) : (
          <button onClick={toggleSidebar} className="codex-icon-btn" title={t('sidebar.collapse')}>
            <ChevronLeft size={14} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        {SECTIONS.map((section, idx) => (
          <div key={idx}>
            {section.title && <div className="sidebar-section-title">{t(section.title)}</div>}
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
                <span className="flex-1">{t(item.label)}</span>
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
                placeholder={t('sidebar.searchPlaceholder')}
                className="codex-input flex-1 px-2 py-1 text-xs bg-transparent border-0 focus:outline-none"
              />
              <button
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery('');
                }}
                className="codex-icon-btn w-5 h-5 shrink-0"
                title={t('sidebar.searchClose')}
              >
                <X size={10} />
              </button>
            </div>
            {searchQuery.trim() && (
              <div className="max-h-80 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <div className="text-[11px] text-text-muted px-1 py-2 italic">
                    {t('sidebar.searchEmpty')}
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
                        <span className="text-xs font-medium truncate flex-1">{conv.title || t('sidebar.newChat')}</span>
                        {matchInTitle && (
                          <span className="text-[9px] bg-accent/15 text-accent px-1 rounded-full">{t('sidebar.searchTitleBadge')}</span>
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
          <span>{t('sidebar.projects')}</span>
          <button
            onClick={() => setShowProjectInput((v) => !v)}
            className="codex-icon-btn w-4 h-4"
            title={t('sidebar.newProject')}
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
              placeholder={t('sidebar.projectName')}
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
            <div className="sidebar-section-title">{t('sidebar.noProject')}</div>
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
                  title={isOpen ? t('sidebar.collapse') : t('sidebar.expand')}
                >
                  {isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                </button>
                <Folder size={12} className="text-accent shrink-0" />
                <span className="flex-1 text-sm text-text-primary truncate">{p.name}</span>
                {p.passwordHash && (
                  <Lock size={9} className="text-text-muted shrink-0" />
                )}
                <span className="text-[10px] text-text-muted">{convs.length}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMemberSwitcherFor(memberSwitcherFor === p.id ? null : p.id);
                  }}
                  className="codex-icon-btn w-4 h-4 opacity-0 group-hover:opacity-100"
                  title="Cambiar de miembro"
                >
                  <UserCircle size={10} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSettingsFor(p);
                  }}
                  className="codex-icon-btn w-4 h-4 opacity-0 group-hover:opacity-100"
                  title="Ajustes del proyecto (miembros, permisos, contraseña)"
                >
                  <Users size={10} />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`${t('sidebar.deleteProject')} "${p.name}"?`)) {
                      deleteProject(p.id);
                    }
                  }}
                  className="codex-icon-btn w-4 h-4 opacity-0 group-hover:opacity-100"
                  title={t('sidebar.deleteProject')}
                >
                  <Trash2 size={10} />
                </button>
              </div>
              {/* Switcher de miembros: elige quién eres dentro de este proyecto. */}
              {memberSwitcherFor === p.id && (
                <div className="ml-3 mt-0.5 mb-1 border border-border rounded-codex bg-app-elevated p-1.5">
                  <div className="text-[9px] uppercase text-text-muted tracking-wider mb-1">
                    Cambiar de miembro
                  </div>
                  <button
                    onClick={() => setActiveMember(null)}
                    className={cn(
                      'w-full text-left px-1.5 py-1 rounded text-xs flex items-center gap-1.5',
                      activeMemberId === null
                        ? 'bg-app-bg text-text-primary'
                        : 'text-text-secondary hover:bg-app-bg',
                    )}
                  >
                    <UserCircle size={11} className="text-accent" />
                    <span className="flex-1 truncate">Tú (dueño)</span>
                    {activeMemberId === null && (
                      <span className="text-[9px] text-accent">●</span>
                    )}
                  </button>
                  {members
                    .filter((m) => m.projectId === p.id)
                    .map((m) => (
                      <button
                        key={m.id}
                        onClick={() => switchToMember(m)}
                        className={cn(
                          'w-full text-left px-1.5 py-1 rounded text-xs flex items-center gap-1.5',
                          activeMemberId === m.id
                            ? 'bg-app-bg text-text-primary'
                            : 'text-text-secondary hover:bg-app-bg',
                        )}
                      >
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: m.color ?? '#7aa67a' }}
                        />
                        <span className="flex-1 truncate">{m.name}</span>
                        {m.passwordHash && <Lock size={9} className="text-text-muted" />}
                        {activeMemberId === m.id && (
                          <span className="text-[9px] text-accent">●</span>
                        )}
                      </button>
                    ))}
                  {members.filter((m) => m.projectId === p.id).length === 0 && (
                    <div className="px-1.5 py-1 text-[10px] text-text-muted italic">
                      Sin miembros. Ábreles Ajustes para invitar.
                    </div>
                  )}
                </div>
              )}
              {isOpen && (
                <div className="ml-3 border-l border-border pl-1">
                  {convs.length === 0 ? (
                    <div className="px-2 py-1 text-[10px] text-text-muted italic">{t('sidebar.empty')}</div>
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
          <div className="px-2 py-1.5 text-xs text-text-muted">{t('sidebar.noConversations')}</div>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <button
          onClick={() => setView('configuracion')}
          className={cn('sidebar-item w-full text-left', view === 'configuracion' && 'active')}
        >
          <Cog size={14} />
          <span className="flex-1">{t('sidebar.configuracion')}</span>
        </button>
      </div>
    </aside>

    {settingsFor && (
      <ProjectSettingsModal
        project={settingsFor}
        onClose={() => setSettingsFor(null)}
      />
    )}

    {/* Prompt de contraseña para miembro protegido. */}
    {pendingMember && (
      <div
        className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
        onClick={() => setPendingMember(null)}
      >
        <div
          className="bg-app-bg border border-border-accent rounded-codex shadow-2xl w-full max-w-sm p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 mb-2">
            <Lock size={14} className="text-accent" />
            <h3 className="text-sm font-semibold">Acceso a "{pendingMember.name}"</h3>
          </div>
          <p className="text-[11px] text-text-muted mb-2">
            Este miembro tiene contraseña. Ingrésala para chatear como él.
          </p>
          <input
            type="password"
            autoFocus
            value={pwPrompt}
            onChange={(e) => {
              setPwPrompt(e.target.value);
              setPwError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && confirmMemberPassword()}
            className="codex-input w-full px-2 py-1.5 text-sm"
            placeholder="Contraseña del miembro"
          />
          {pwError && (
            <p className="text-[10px] text-red-400 mt-1">{pwError}</p>
          )}
          <div className="flex gap-2 mt-3 justify-end">
            <button
              onClick={() => setPendingMember(null)}
              className="codex-btn px-3 py-1.5 text-xs"
            >
              Cancelar
            </button>
            <button
              onClick={confirmMemberPassword}
              className="codex-btn px-3 py-1.5 text-xs"
            >
              Entrar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
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
  const t = useT();
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
      <span className="flex-1 truncate">{conv.title || t('sidebar.newChat')}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMenuToggle();
        }}
        className="opacity-0 group-hover:opacity-100 codex-icon-btn w-5 h-5"
        title={t('sidebar.moveTo')}
      >
        <MoreHorizontal size={12} />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 codex-icon-btn w-5 h-5"
        title={t('sidebar.delete')}
      >
        <Trash2 size={10} />
      </button>
      {menuOpen && (
        <div
          className="absolute right-0 mt-32 z-30 w-48 bg-app-elevated border border-border-accent rounded-codex shadow-2xl animate-slide-up overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] text-text-muted uppercase">{t('sidebar.moveTo')}</div>
          <button
            onClick={() => onMoveToProject(null)}
            className="w-full text-left px-2 py-1 text-xs hover:bg-app-input"
          >
            {t('sidebar.noProject')}
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
