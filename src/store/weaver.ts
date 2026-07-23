/**
 * Store global de Weaver (Zustand).
 *
 * Mantiene:
 * - Conversaciones (lista de mensajes + planes + traces).
 * - Proveedor/modelo seleccionados.
 * - Vista activa (chat, complementos, habilidades, configuración, automatizaciones).
 * - Estado del agente (idle/planning/executing/reflecting).
 */

import { create } from 'zustand';
import type { Message, ProviderId } from '@/providers/types';
import type { AgentEvent } from '@/agent/loop';
import type { Plan, Subtask, TraceStep } from '@/agent/types';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, getProvider } from '@/providers/registry';
import { apiKeyStore } from '@/providers/store';
import type { Attachment } from '@/lib/attachments';
import type { ThemeId } from '@/lib/themes';
import { getActiveTheme, applyTheme } from '@/lib/themes';
import { sqlite, runtime, type ProjectRow, type ProjectMemberRow, type MeEvent, type MeCalendar, type MeTask, type MeNote, type MeHealth, type MeShoppingItem, type MeIntegration } from '@/lib/tauri';

export type ViewId = 'chat' | 'complementos' | 'habilidades' | 'automatizaciones' | 'configuracion' | 'me';

export interface Conversation {
  id: string;
  title: string;
  projectId: string | null;
  messages: Message[];
  plan?: Plan;
  traces: Record<string, TraceStep[]>; // subtaskId → steps
  agentState: 'idle' | 'planning' | 'executing' | 'reflecting' | 'error';
  createdAt: number;
  updatedAt: number;
  /** Si está fijado, la conversación es privada del miembro indicado
   *  (aislamiento tipo "carpeta" dentro del proyecto). */
  ownerMemberId: string | null;
}

export interface Project {
  id: string;
  name: string;
  color: string | null;
  createdAt: number;
  passwordHash: string | null;
  agentExecutionScope: 'local' | 'owner_only' | 'each_user';
}

/** Miembro de un proyecto de colaboración. Cada uno puede usar su propio
 *  proveedor+modelo (la API key se guarda en el keyring del OS bajo
 *  provider_id = `member:<memberId>`). */
export interface ProjectMember {
  id: string;
  projectId: string;
  name: string;
  color: string | null;
  providerId: string | null;
  modelId: string | null;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  canRunAgent: boolean;
  canEditFiles: boolean;
  canUseShell: boolean;
  canSeeOtherChats: boolean;
  canManageMembers: boolean;
  passwordHash: string | null;
  createdAt: number;
}

interface WeaverState {
  // --- UI ---
  view: ViewId;
  setView: (v: ViewId) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  modelPickerOpen: boolean;
  setModelPickerOpen: (open: boolean) => void;

  // --- Adjuntos (draft del composer, no persistidos por conversación) ---
  draftAttachments: Attachment[];
  addDraftAttachment: (att: Attachment) => void;
  addDraftAttachments: (atts: Attachment[]) => void;
  removeDraftAttachment: (id: string) => void;
  clearDraftAttachments: () => void;

  // --- Proyectos ---
  projects: Project[];
  loadProjects: () => Promise<void>;
  createProject: (name: string, color?: string) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  setProjectPassword: (id: string, password: string | null) => Promise<void>;
  setProjectScope: (id: string, scope: Project['agentExecutionScope']) => Promise<void>;
  setConversationProject: (convId: string, projectId: string | null) => Promise<void>;
  setConversationOwner: (convId: string, memberId: string | null) => Promise<void>;

  // --- Miembros de proyecto (colaboración local) ---
  members: ProjectMember[];
  /** Miembro "activo" del proyecto actual. Si está fijado, el chat usa el
   *  provider+model de este miembro en lugar del global. Si es null, se usa
   *  el provider+model global (es decir, "tú" como dueño del proyecto). */
  activeMemberId: string | null;
  setActiveMember: (memberId: string | null) => void;
  /** Devuelve el miembro activo del proyecto indicado (o null). */
  getActiveMember: () => ProjectMember | null;
  loadMembers: (projectId: string) => Promise<void>;
  createMember: (member: Omit<ProjectMember, 'id' | 'createdAt' | 'passwordHash'>) => Promise<ProjectMember | null>;
  updateMember: (member: ProjectMember) => Promise<void>;
  deleteMember: (id: string) => Promise<void>;
  setMemberPassword: (id: string, password: string | null) => Promise<void>;

  // --- Conversaciones ---
  conversations: Conversation[];
  activeConversationId: string | null;
  /** Carga conversaciones desde SQLite (Tauri) o localStorage al iniciar. */
  loadConversations: () => Promise<void>;
  /** Carga mensajes de una conversación (lazy load). */
  loadMessages: (conversationId: string) => Promise<void>;
  newConversation: () => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => Promise<void>;
  appendMessage: (msg: Message) => void;
  updateLastAssistantMessage: (delta: string) => void;
  /** Reemplaza el contenido completo del último mensaje asistente (no append). */
  setLastAssistantMessage: (content: string) => void;
  setConversationPlan: (plan: Plan) => void;
  appendTrace: (subtaskId: string, step: TraceStep) => void;
  setSubtaskStatus: (subtaskId: string, status: Subtask['status']) => void;
  setAgentState: (state: Conversation['agentState']) => void;

  // --- Provider/model ---
  providerId: ProviderId;
  modelId: string;
  setProvider: (id: ProviderId) => void;
  setModel: (id: string) => void;
  providersWithKey: Set<ProviderId>;
  refreshProvidersWithKey: () => Promise<void>;

  // --- Tema ---
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;

  // --- Modo de interfaz: 'normal' (chat) o 'ide' (editor + agente lateral) ---
  appMode: 'normal' | 'ide';
  setAppMode: (m: 'normal' | 'ide') => void;
  /** Directorio de trabajo actual para el Modo IDE. Persistido por proyecto. */
  ideCwd: string | null;
  setIdeCwd: (path: string | null) => void;

  // --- Modos del agente (toggles en el popup +) ---
  /** Modo plan: el agente primero propone un plan y espera confirmación antes de ejecutar. */
  planMode: boolean;
  /** Perseguir objetivo: el agente itera hasta completar el objetivo, no se rinde al primer fallo. */
  pursueObjective: boolean;
  /**
   * Modo Cognitivo: el agente se vuelve hiper-especializado en el proyecto activo.
   * Antes de proponer cambios, construye/consulta un Grafo Cognitivo del proyecto
   * (graphify) y emite un juicio con 3 fases: intuición → lógica → juicio.
   * Requiere Tauri para escanear archivos.
   */
  cognitiveMode: boolean;
  setPlanMode: (v: boolean) => void;
  setPursueObjective: (v: boolean) => void;
  setCognitiveMode: (v: boolean) => void;

  // --- Regeneración de mensajes ---
  regenerateMessage: (messageId: string) => Promise<void>;

  // --- Agent events ---
  handleAgentEvent: (event: AgentEvent) => void;

  // --- ME: Calendario + utilidades de vida ---
  meEvents: MeEvent[];
  meCalendars: MeCalendar[];
  meTasks: MeTask[];
  meNotes: MeNote[];
  meHealth: MeHealth[];
  meShopping: MeShoppingItem[];
  meIntegrations: MeIntegration[];
  loadMeEvents: () => Promise<void>;
  upsertMeEvent: (event: MeEvent) => Promise<void>;
  deleteMeEvent: (id: string) => Promise<void>;
  loadMeCalendars: () => Promise<void>;
  upsertMeCalendar: (cal: MeCalendar) => Promise<void>;
  deleteMeCalendar: (id: string) => Promise<void>;
  loadMeTasks: () => Promise<void>;
  upsertMeTask: (task: MeTask) => Promise<void>;
  deleteMeTask: (id: string) => Promise<void>;
  loadMeNotes: () => Promise<void>;
  upsertMeNote: (note: MeNote) => Promise<void>;
  deleteMeNote: (id: string) => Promise<void>;
  loadMeHealth: () => Promise<void>;
  upsertMeHealth: (h: MeHealth) => Promise<void>;
  deleteMeHealth: (id: string) => Promise<void>;
  loadMeShopping: () => Promise<void>;
  upsertMeShopping: (item: MeShoppingItem) => Promise<void>;
  deleteMeShopping: (id: string) => Promise<void>;
  loadMeIntegrations: () => Promise<void>;
  upsertMeIntegration: (it: MeIntegration) => Promise<void>;
  deleteMeIntegration: (id: string) => Promise<void>;
  loadMeAll: () => Promise<void>;

  // --- Cápsulas ocultadas por el usuario (UI chat) ---
  hiddenCapsules: Set<string>;
  hideCapsule: (id: string) => void;
}

export const useWeaver = create<WeaverState>((set, get) => ({
  // --- UI ---
  view: 'chat',
  setView: (v) => set({ view: v }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  modelPickerOpen: false,
  setModelPickerOpen: (open) => set({ modelPickerOpen: open }),

  // --- Adjuntos ---
  draftAttachments: [],
  addDraftAttachment: (att) =>
    set((s) => ({ draftAttachments: [...s.draftAttachments, att] })),
  addDraftAttachments: (atts) =>
    set((s) => ({ draftAttachments: [...s.draftAttachments, ...atts] })),
  removeDraftAttachment: (id) =>
    set((s) => ({
      draftAttachments: s.draftAttachments.filter((a) => a.id !== id),
    })),
  clearDraftAttachments: () => set({ draftAttachments: [] }),

  // --- Proyectos ---
  projects: [],
  loadProjects: async () => {
    if (runtime.isTauri) {
      const rows = await sqlite.listProjects();
      set({
        projects: rows.map((r) => ({
          id: r.id,
          name: r.name,
          color: r.color,
          createdAt: r.created_at,
          passwordHash: r.password_hash,
          agentExecutionScope: (r.agent_execution_scope as Project['agentExecutionScope']) ?? 'local',
        })),
      });
    } else {
      // Fallback navegador: localStorage
      try {
        const raw = localStorage.getItem('weaver:projects');
        const parsed: Project[] = raw ? JSON.parse(raw) : [];
        // Garantizar campos nuevos en datos antiguos.
        for (const p of parsed) {
          if (!p.passwordHash) p.passwordHash = null;
          if (!p.agentExecutionScope) p.agentExecutionScope = 'local';
        }
        set({ projects: parsed });
      } catch {
        set({ projects: [] });
      }
    }
  },
  createProject: async (name, color) => {
    if (runtime.isTauri) {
      const row = await sqlite.createProject(name, color);
      if (!row) return null;
      const proj: Project = {
        id: row.id,
        name: row.name,
        color: row.color,
        createdAt: row.created_at,
        passwordHash: row.password_hash,
        agentExecutionScope: (row.agent_execution_scope as Project['agentExecutionScope']) ?? 'local',
      };
      set((s) => ({ projects: [...s.projects, proj] }));
      return proj;
    }
    const proj: Project = {
      id: crypto.randomUUID(),
      name,
      color: color ?? null,
      createdAt: Date.now(),
      passwordHash: null,
      agentExecutionScope: 'local',
    };
    set((s) => ({ projects: [...s.projects, proj] }));
    try {
      localStorage.setItem('weaver:projects', JSON.stringify(useWeaver.getState().projects));
    } catch { /* ignore */ }
    return proj;
  },
  deleteProject: async (id) => {
    if (runtime.isTauri) {
      await sqlite.deleteProject(id);
    }
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      conversations: s.conversations.map((c) =>
        c.projectId === id ? { ...c, projectId: null } : c,
      ),
      members: s.members.filter((m) => m.projectId !== id),
    }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:projects', JSON.stringify(useWeaver.getState().projects));
      } catch { /* ignore */ }
    }
  },
  renameProject: async (id, name) => {
    if (runtime.isTauri) {
      await sqlite.renameProject(id, name);
    }
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)),
    }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:projects', JSON.stringify(useWeaver.getState().projects));
      } catch { /* ignore */ }
    }
  },
  setProjectPassword: async (id, password) => {
    if (runtime.isTauri) {
      await sqlite.setProjectPassword(id, password);
    }
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, passwordHash: password ? 'set' : null } : p)),
    }));
  },
  setProjectScope: async (id, scope) => {
    if (runtime.isTauri) {
      await sqlite.setProjectScope(id, scope);
    }
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, agentExecutionScope: scope } : p)),
    }));
  },
  setConversationProject: async (convId, projectId) => {
    if (runtime.isTauri) {
      await sqlite.setConversationProject(convId, projectId);
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, projectId } : c,
      ),
    }));
  },
  setConversationOwner: async (convId, memberId) => {
    if (runtime.isTauri) {
      await sqlite.setConversationOwner(convId, memberId);
    }
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, ownerMemberId: memberId } : c,
      ),
    }));
  },

  // --- Miembros de proyecto (colaboración local) ---
  members: [],
  activeMemberId: null,
  setActiveMember: (memberId) => set({ activeMemberId: memberId }),
  getActiveMember: () => {
    const { members, activeMemberId } = get();
    return members.find((m) => m.id === activeMemberId) ?? null;
  },
  loadMembers: async (projectId) => {
    if (runtime.isTauri) {
      try {
        const rows = await sqlite.listMembers(projectId);
        set({
          members: rows.map((r) => ({
            id: r.id,
            projectId: r.project_id,
            name: r.name,
            color: r.color,
            providerId: r.provider_id,
            modelId: r.model_id,
            role: r.role,
            canRunAgent: r.can_run_agent,
            canEditFiles: r.can_edit_files,
            canUseShell: r.can_use_shell,
            canSeeOtherChats: r.can_see_other_chats,
            canManageMembers: r.can_manage_members,
            passwordHash: r.password_hash,
            createdAt: r.created_at,
          })),
        });
      } catch {
        set({ members: [] });
      }
    } else {
      try {
        const raw = localStorage.getItem(`weaver:members:${projectId}`);
        set({ members: raw ? JSON.parse(raw) : [] });
      } catch {
        set({ members: [] });
      }
    }
  },
  createMember: async (member) => {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const newMember: ProjectMember = { ...member, id, createdAt, passwordHash: null };
    if (runtime.isTauri) {
      const row: ProjectMemberRow = {
        id,
        project_id: member.projectId,
        name: member.name,
        color: member.color,
        provider_id: member.providerId,
        model_id: member.modelId,
        role: member.role,
        can_run_agent: member.canRunAgent,
        can_edit_files: member.canEditFiles,
        can_use_shell: member.canUseShell,
        can_see_other_chats: member.canSeeOtherChats,
        can_manage_members: member.canManageMembers,
        password_hash: null,
        created_at: createdAt,
      };
      try {
        await sqlite.createMember(row);
      } catch (e) {
        console.error('createMember', e);
        return null;
      }
    } else {
      const list = [...useWeaver.getState().members, newMember];
      try {
        localStorage.setItem(`weaver:members:${member.projectId}`, JSON.stringify(list));
      } catch { /* ignore */ }
    }
    set((s) => ({ members: [...s.members, newMember] }));
    return newMember;
  },
  updateMember: async (member) => {
    if (runtime.isTauri) {
      const row: ProjectMemberRow = {
        id: member.id,
        project_id: member.projectId,
        name: member.name,
        color: member.color,
        provider_id: member.providerId,
        model_id: member.modelId,
        role: member.role,
        can_run_agent: member.canRunAgent,
        can_edit_files: member.canEditFiles,
        can_use_shell: member.canUseShell,
        can_see_other_chats: member.canSeeOtherChats,
        can_manage_members: member.canManageMembers,
        password_hash: member.passwordHash,
        created_at: member.createdAt,
      };
      await sqlite.updateMember(row);
    } else {
      const list = useWeaver.getState().members.map((m) => (m.id === member.id ? member : m));
      try {
        localStorage.setItem(`weaver:members:${member.projectId}`, JSON.stringify(list));
      } catch { /* ignore */ }
    }
    set((s) => ({ members: s.members.map((m) => (m.id === member.id ? member : m)) }));
  },
  deleteMember: async (id) => {
    const member = useWeaver.getState().members.find((m) => m.id === id);
    if (runtime.isTauri) {
      await sqlite.deleteMember(id);
    } else if (member) {
      const list = useWeaver.getState().members.filter((m) => m.id !== id);
      try {
        localStorage.setItem(`weaver:members:${member.projectId}`, JSON.stringify(list));
      } catch { /* ignore */ }
    }
    set((s) => ({
      members: s.members.filter((m) => m.id !== id),
      conversations: s.conversations.map((c) =>
        c.ownerMemberId === id ? { ...c, ownerMemberId: null } : c,
      ),
    }));
  },
  setMemberPassword: async (id, password) => {
    if (runtime.isTauri) {
      await sqlite.setMemberPassword(id, password);
    }
    set((s) => ({
      members: s.members.map((m) =>
        m.id === id ? { ...m, passwordHash: password ? 'set' : null } : m,
      ),
    }));
  },

  // --- Conversaciones ---
  conversations: [],
  activeConversationId: null,
  /** Carga conversaciones desde SQLite (Tauri) o localStorage (navegador). */
  loadConversations: async () => {
    if (runtime.isTauri) {
      try {
        const convs = await sqlite.listConversations();
        if (convs.length === 0) {
          // Sin conversaciones, crear una nueva.
          useWeaver.getState().newConversation();
          return;
        }
        const conversations: Conversation[] = convs.map((c) => ({
          id: c.id,
          title: c.title,
          projectId: c.project_id,
          messages: [], // Se cargan al seleccionar (lazy load).
          traces: {},
          agentState: 'idle' as const,
          createdAt: c.created_at,
          updatedAt: c.updated_at,
          ownerMemberId: c.owner_member_id,
        }));
        set({ conversations, activeConversationId: conversations[0]?.id ?? null });
        // Cargar mensajes de la conversación activa.
        if (conversations[0]) {
          await useWeaver.getState().loadMessages(conversations[0].id);
        }
      } catch (e) {
        console.warn('loadConversations failed:', e);
        useWeaver.getState().newConversation();
      }
    } else {
      // Navegador: usar localStorage.
      try {
        const raw = localStorage.getItem('weaver:conversations');
        if (raw) {
          const conversations = JSON.parse(raw) as Conversation[];
          set({
            conversations,
            activeConversationId: conversations[0]?.id ?? null,
          });
        } else {
          useWeaver.getState().newConversation();
        }
      } catch {
        useWeaver.getState().newConversation();
      }
    }
  },
  /** Carga mensajes de una conversación desde SQLite (lazy load). */
  loadMessages: async (conversationId: string) => {
    if (runtime.isTauri) {
      try {
        const rows = await sqlite.listMessages(conversationId);
        const messages: Message[] = rows.map((r) => ({
          id: r.id,
          role: r.role as Message['role'],
          content: r.content,
          ts: r.ts,
          reasoning: r.reasoning ?? undefined,
          // attachments_json se parsea si existe.
          ...(r.attachments_json ? { attachments: JSON.parse(r.attachments_json) } : {}),
        }));
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === conversationId ? { ...c, messages } : c,
          ),
        }));
      } catch (e) {
        console.warn('loadMessages failed:', e);
      }
    }
  },

  newConversation: () => {
    const id = crypto.randomUUID();
    const conv: Conversation = {
      id,
      title: 'Nuevo chat',
      projectId: null,
      messages: [],
      traces: {},
      agentState: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ownerMemberId: null,
    };
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeConversationId: id,
      view: 'chat',
    }));
    // Persistir en SQLite si estamos en Tauri.
    if (runtime.isTauri) {
      sqlite.createConversation(id, null, 'Nuevo chat').catch((e) =>
        console.warn('createConversation failed:', e),
      );
    } else {
      // Navegador: guardar en localStorage.
      try {
        localStorage.setItem('weaver:conversations', JSON.stringify(useWeaver.getState().conversations));
      } catch { /* ignore */ }
    }
    return id;
  },

  selectConversation: (id) => {
    set({ activeConversationId: id, view: 'chat' });
    // Lazy load mensajes desde SQLite si la conversación está vacía.
    const conv = useWeaver.getState().conversations.find((c) => c.id === id);
    if (conv && conv.messages.length === 0) {
      useWeaver.getState().loadMessages(id);
    }
  },

  renameConversation: async (id, title) => {
    const cleanTitle = title.trim().slice(0, 80) || 'Sin título';
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, title: cleanTitle } : c,
      ),
    }));
    if (runtime.isTauri) {
      try {
        await sqlite.renameConversation(id, cleanTitle);
      } catch (e) {
        console.warn('renameConversation failed:', e);
      }
    } else {
      try {
        localStorage.setItem('weaver:conversations', JSON.stringify(useWeaver.getState().conversations));
      } catch { /* ignore */ }
    }
  },

  deleteConversation: (id) => {
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      const activeConversationId =
        s.activeConversationId === id ? conversations[0]?.id ?? null : s.activeConversationId;
      return { conversations, activeConversationId };
    });
    // Eliminar de SQLite.
    if (runtime.isTauri) {
      sqlite.deleteConversation(id).catch((e) =>
        console.warn('deleteConversation failed:', e),
      );
    } else {
      try {
        localStorage.setItem('weaver:conversations', JSON.stringify(useWeaver.getState().conversations));
      } catch { /* ignore */ }
    }
  },

  appendMessage: (msg) => {
    set((s) => {
      if (!s.activeConversationId) return s;
      const conversations = s.conversations.map((c) =>
        c.id === s.activeConversationId
          ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() }
          : c,
      );
      return { conversations };
    });
    // Persistir mensaje en SQLite.
    const convId = useWeaver.getState().activeConversationId;
    if (convId) {
      if (runtime.isTauri) {
        const msgRow = {
          id: msg.id ?? crypto.randomUUID(),
          conversation_id: convId,
          role: msg.role,
          content: msg.content ?? '',
          ts: msg.ts ?? Date.now(),
          attachments_json: msg.attachments ? JSON.stringify(msg.attachments) : null,
          reasoning: msg.reasoning ?? null,
        };
        sqlite.saveMessage(msgRow).catch((e) =>
          console.warn('saveMessage failed:', e),
        );
      } else {
        try {
          localStorage.setItem('weaver:conversations', JSON.stringify(useWeaver.getState().conversations));
        } catch { /* ignore */ }
      }
    }
    // Auto-titular conversación con IA si es el primer mensaje del usuario.
    if (msg.role === 'user' && convId) {
      void maybeAutoTitleConversation(convId, msg.content ?? '');
    }
  },

  updateLastAssistantMessage: (delta) => {
    set((s) => {
      if (!s.activeConversationId) return s;
      const conversations = s.conversations.map((c) => {
        if (c.id !== s.activeConversationId) return c;
        const msgs = [...c.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          const prev = last.content ?? '';
          msgs[msgs.length - 1] = { ...last, content: prev + delta };
        } else {
          msgs.push({ role: 'assistant', content: delta });
        }
        return { ...c, messages: msgs, updatedAt: Date.now() };
      });
      return { conversations };
    });
    // Debounce persistencia: el último update se persiste tras 2s de inactividad.
    if (runtime.isTauri) {
      schedulePersistLastMessage();
    } else {
      try {
        localStorage.setItem('weaver:conversations', JSON.stringify(useWeaver.getState().conversations));
      } catch { /* ignore */ }
    }
  },

  setLastAssistantMessage: (content) => {
    set((s) => {
      if (!s.activeConversationId) return s;
      const conversations = s.conversations.map((c) => {
        if (c.id !== s.activeConversationId) return c;
        const msgs = [...c.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content };
        } else {
          msgs.push({ role: 'assistant', content });
        }
        return { ...c, messages: msgs, updatedAt: Date.now() };
      });
      return { conversations };
    });
    if (runtime.isTauri) {
      schedulePersistLastMessage();
    } else {
      try {
        localStorage.setItem('weaver:conversations', JSON.stringify(useWeaver.getState().conversations));
      } catch { /* ignore */ }
    }
  },

  setConversationPlan: (plan) =>
    set((s) => {
      if (!s.activeConversationId) return s;
      const conversations = s.conversations.map((c) =>
        c.id === s.activeConversationId ? { ...c, plan } : c,
      );
      return { conversations };
    }),

  appendTrace: (subtaskId, step) =>
    set((s) => {
      if (!s.activeConversationId) return s;
      const conversations = s.conversations.map((c) => {
        if (c.id !== s.activeConversationId) return c;
        const traces = { ...c.traces };
        traces[subtaskId] = [...(traces[subtaskId] ?? []), step];
        return { ...c, traces };
      });
      return { conversations };
    }),

  setSubtaskStatus: (subtaskId, status) =>
    set((s) => {
      if (!s.activeConversationId || !s.conversations.find((c) => c.id === s.activeConversationId)?.plan)
        return s;
      const conversations = s.conversations.map((c) => {
        if (c.id !== s.activeConversationId || !c.plan) return c;
        const subtasks = c.plan.subtasks.map((st) =>
          st.id === subtaskId ? { ...st, status } : st,
        );
        return { ...c, plan: { ...c.plan, subtasks } };
      });
      return { conversations };
    }),

  setAgentState: (agentState) =>
    set((s) => {
      if (!s.activeConversationId) return s;
      const conversations = s.conversations.map((c) =>
        c.id === s.activeConversationId ? { ...c, agentState } : c,
      );
      return { conversations };
    }),

  // --- Provider/model ---
  providerId: DEFAULT_PROVIDER,
  modelId: DEFAULT_MODEL,
  setProvider: (id) => {
    const info = getProvider(id);
    const firstModel = info?.models[0]?.id ?? '';
    set({ providerId: id, modelId: firstModel });
  },
  setModel: (id) => set({ modelId: id }),

  providersWithKey: new Set<ProviderId>(),
  refreshProvidersWithKey: async () => {
    const known = await apiKeyStore.listKnown();
    set({ providersWithKey: new Set(known) });
  },

  // --- Tema ---
  themeId: getActiveTheme(),
  setTheme: (id) => {
    applyTheme(id);
    set({ themeId: id });
  },

  // --- Modo de interfaz (Normal vs IDE) ---
  appMode: (() => {
    try {
      const stored = localStorage.getItem('weaver:appMode');
      return stored === 'ide' ? 'ide' : 'normal';
    } catch {
      return 'normal';
    }
  })(),
  setAppMode: (m) => {
    try {
      localStorage.setItem('weaver:appMode', m);
    } catch {
      // ignore
    }
    set({ appMode: m });
  },

  // --- Directorio de trabajo del Modo IDE ---
  ideCwd: (() => {
    try {
      return localStorage.getItem('weaver:ideCwd');
    } catch {
      return null;
    }
  })(),
  setIdeCwd: (path) => {
    try {
      if (path) localStorage.setItem('weaver:ideCwd', path);
      else localStorage.removeItem('weaver:ideCwd');
    } catch {
      // ignore
    }
    set({ ideCwd: path });
  },

  // --- Modos del agente ---
  planMode: false,
  pursueObjective: true,
  cognitiveMode: false,
  setPlanMode: (v) => set({ planMode: v }),
  setPursueObjective: (v) => set({ pursueObjective: v }),
  setCognitiveMode: (v) => set({ cognitiveMode: v }),

  // --- Regeneración ---
  regenerateMessage: async (messageId) => {
    // Encuentra la conversación activa y el mensaje.
    const s = get();
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    // Toma todos los mensajes anteriores al que se regenera.
    const context = conv.messages.slice(0, idx).filter((m) => m.role === 'user' || m.role === 'assistant');
    // Reemplaza el contenido del mensaje a regenerar.
    s.setAgentState('executing');
    try {
      const { createProvider } = await import('@/providers');
      const { apiKeyStore } = await import('@/providers/store');
      const { streamUntilDone } = await import('@/lib/chain');
      // Si hay un miembro activo, usar su API key específica.
      const activeMember = s.members.find((m) => m.id === s.activeMemberId);
      const providerId = (activeMember?.providerId as typeof s.providerId | null) ?? s.providerId;
      const apiKeyOverride = activeMember
        ? await apiKeyStore.getForMember(activeMember.id, providerId)
        : undefined;
      const llm = await createProvider(providerId, { apiKeyOverride });
      // Vaciar el mensaje a regenerar.
      const emptyMsg: Message = { ...conv.messages[idx], content: '', reasoning: undefined };
      const newMsgs = [...conv.messages];
      newMsgs[idx] = emptyMsg;
      set((st) => ({
        conversations: st.conversations.map((c) =>
          c.id === conv.id ? { ...c, messages: newMsgs } : c,
        ),
      }));
      const systemMsg: Message = {
        role: 'system',
        content:
          'Eres Weaver, un asistente de escritorio amable y conciso. Si tu respuesta se acerca al límite de tokens, termina con la línea exacta <<CONTINUE>>. Al terminar del todo, emite <<END>>.',
      };
      const full = await streamUntilDone(llm, activeMember?.modelId ?? s.modelId, [systemMsg, ...context], {
        maxChains: 5,
        onDelta: (delta) => {
          set((st) => ({
            conversations: st.conversations.map((c) => {
              if (c.id !== conv.id) return c;
              const msgs = [...c.messages];
              const cur = msgs[idx];
              msgs[idx] = { ...cur, content: (cur.content ?? '') + delta };
              return { ...c, messages: msgs };
            }),
          }));
        },
      });
      // Para el último delta consolidado (por si quedó algo sin emitir).
      void full;
    } catch (e) {
      s.appendMessage({
        role: 'assistant',
        content: `❌ Error regenerando: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      s.setAgentState('idle');
    }
  },

  // --- Agent events → store mutations ---
  handleAgentEvent: (event) => {
    const s = get();
    switch (event.type) {
      case 'planning_started':
        s.setAgentState('planning');
        s.appendMessage({ role: 'assistant', content: '🔄 Planificando…' });
        break;
      case 'plan_ready':
        s.setConversationPlan(event.plan);
        s.setAgentState('executing');
        s.appendMessage({
          role: 'assistant',
          content: `📋 Plan generado con ${event.plan.subtasks.length} subtareas:\n\n${event.plan.subtasks
            .map((st, i) => `${i + 1}. ${st.description}`)
            .join('\n')}\n\nEjecutando…`,
        });
        break;
      case 'subtask_started':
        s.setSubtaskStatus(event.subtask.id, 'in_progress');
        break;
      case 'trace':
        s.appendTrace(event.subtaskId, event.step);
        break;
      case 'subtask_finished':
        s.setSubtaskStatus(event.subtask.id, event.status === 'succeeded' ? 'succeeded' : 'failed');
        break;
      case 'reflection_started':
        s.setAgentState('reflecting');
        break;
      case 'episode_finished':
        s.setAgentState('idle');
        s.appendMessage({
          role: 'assistant',
          content: `✅ Episodio terminado: ${event.episode.outcome}.\nLecciones: ${
            event.episode.lessons.join('; ') || '(ninguna)'
          }`,
        });
        break;
      case 'error':
        s.setAgentState('error');
        s.appendMessage({ role: 'assistant', content: `❌ Error: ${event.message}` });
        break;
      default:
        // 'critic_verdict', 'replanning' → no mutan estado principal, sólo traces.
        if (event.type === 'critic_verdict') {
          s.appendTrace(event.subtaskId, {
            ts: Date.now(),
            kind: 'observation',
            content: `Crítico: ${event.verdict} — ${event.reason}`,
          });
        } else if (event.type === 'replanning') {
          s.appendMessage({ role: 'assistant', content: `⚠️ Replanificando: ${event.reason}` });
        }
        break;
    }
  },

  // ==========================================================================
  // ME — Calendario + utilidades
  // ==========================================================================
  meEvents: [],
  meCalendars: [],
  meTasks: [],
  meNotes: [],
  meHealth: [],
  meShopping: [],
  meIntegrations: [],
  hiddenCapsules: new Set<string>(),

  loadMeEvents: async () => {
    if (runtime.isTauri) {
      const rows = await sqlite.meEventsList();
      set({ meEvents: rows });
    } else {
      try {
        const raw = localStorage.getItem('weaver:me:events');
        set({ meEvents: raw ? JSON.parse(raw) : [] });
      } catch { set({ meEvents: [] }); }
    }
  },
  upsertMeEvent: async (event) => {
    if (runtime.isTauri) {
      await sqlite.meEventsSave(event);
    } else {
      try {
        const cur = useWeaver.getState().meEvents;
        const next = [...cur.filter((e) => e.id !== event.id), event];
        localStorage.setItem('weaver:me:events', JSON.stringify(next));
      } catch { /* ignore */ }
    }
    set((s) => ({ meEvents: [...s.meEvents.filter((e) => e.id !== event.id), event] }));
  },
  deleteMeEvent: async (id) => {
    if (runtime.isTauri) await sqlite.meEventsDelete(id);
    set((s) => ({ meEvents: s.meEvents.filter((e) => e.id !== id) }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:events', JSON.stringify(useWeaver.getState().meEvents));
      } catch { /* ignore */ }
    }
  },

  loadMeCalendars: async () => {
    if (runtime.isTauri) {
      const rows = await sqlite.meCalendarsList();
      if (rows.length === 0) {
        // Seed default calendars
        const defaults = [
          { id: 'personal', name: 'Personal', color: '#7aa67a', visible: true, created_at: Date.now() },
          { id: 'work', name: 'Trabajo', color: '#6b8cff', visible: true, created_at: Date.now() },
          { id: 'family', name: 'Familia', color: '#d97757', visible: true, created_at: Date.now() },
        ];
        for (const d of defaults) await sqlite.meCalendarsSave(d);
        set({ meCalendars: defaults });
      } else {
        set({ meCalendars: rows });
      }
    } else {
      try {
        const raw = localStorage.getItem('weaver:me:calendars');
        if (raw) {
          set({ meCalendars: JSON.parse(raw) });
        } else {
          const defaults = [
            { id: 'personal', name: 'Personal', color: '#7aa67a', visible: true, created_at: Date.now() },
            { id: 'work', name: 'Trabajo', color: '#6b8cff', visible: true, created_at: Date.now() },
            { id: 'family', name: 'Familia', color: '#d97757', visible: true, created_at: Date.now() },
          ];
          localStorage.setItem('weaver:me:calendars', JSON.stringify(defaults));
          set({ meCalendars: defaults });
        }
      } catch { set({ meCalendars: [] }); }
    }
  },
  upsertMeCalendar: async (cal) => {
    if (runtime.isTauri) await sqlite.meCalendarsSave(cal);
    set((s) => ({ meCalendars: [...s.meCalendars.filter((c) => c.id !== cal.id), cal] }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:calendars', JSON.stringify(useWeaver.getState().meCalendars));
      } catch { /* ignore */ }
    }
  },
  deleteMeCalendar: async (id) => {
    if (runtime.isTauri) await sqlite.meCalendarsDelete(id);
    set((s) => ({ meCalendars: s.meCalendars.filter((c) => c.id !== id) }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:calendars', JSON.stringify(useWeaver.getState().meCalendars));
      } catch { /* ignore */ }
    }
  },

  loadMeTasks: async () => {
    if (runtime.isTauri) {
      const rows = await sqlite.meTasksList();
      set({ meTasks: rows });
    } else {
      try {
        const raw = localStorage.getItem('weaver:me:tasks');
        set({ meTasks: raw ? JSON.parse(raw) : [] });
      } catch { set({ meTasks: [] }); }
    }
  },
  upsertMeTask: async (task) => {
    if (runtime.isTauri) await sqlite.meTasksSave(task);
    set((s) => ({ meTasks: [...s.meTasks.filter((t) => t.id !== task.id), task] }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:tasks', JSON.stringify(useWeaver.getState().meTasks));
      } catch { /* ignore */ }
    }
  },
  deleteMeTask: async (id) => {
    if (runtime.isTauri) await sqlite.meTasksDelete(id);
    set((s) => ({ meTasks: s.meTasks.filter((t) => t.id !== id) }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:tasks', JSON.stringify(useWeaver.getState().meTasks));
      } catch { /* ignore */ }
    }
  },

  loadMeNotes: async () => {
    if (runtime.isTauri) {
      const rows = await sqlite.meNotesList();
      set({ meNotes: rows });
    } else {
      try {
        const raw = localStorage.getItem('weaver:me:notes');
        set({ meNotes: raw ? JSON.parse(raw) : [] });
      } catch { set({ meNotes: [] }); }
    }
  },
  upsertMeNote: async (note) => {
    if (runtime.isTauri) await sqlite.meNotesSave(note);
    set((s) => ({ meNotes: [...s.meNotes.filter((n) => n.id !== note.id), note] }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:notes', JSON.stringify(useWeaver.getState().meNotes));
      } catch { /* ignore */ }
    }
  },
  deleteMeNote: async (id) => {
    if (runtime.isTauri) await sqlite.meNotesDelete(id);
    set((s) => ({ meNotes: s.meNotes.filter((n) => n.id !== id) }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:notes', JSON.stringify(useWeaver.getState().meNotes));
      } catch { /* ignore */ }
    }
  },

  loadMeHealth: async () => {
    if (runtime.isTauri) {
      const rows = await sqlite.meHealthList();
      set({ meHealth: rows });
    } else {
      try {
        const raw = localStorage.getItem('weaver:me:health');
        set({ meHealth: raw ? JSON.parse(raw) : [] });
      } catch { set({ meHealth: [] }); }
    }
  },
  upsertMeHealth: async (h) => {
    if (runtime.isTauri) await sqlite.meHealthSave(h);
    set((s) => ({ meHealth: [...s.meHealth.filter((x) => x.id !== h.id), h] }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:health', JSON.stringify(useWeaver.getState().meHealth));
      } catch { /* ignore */ }
    }
  },
  deleteMeHealth: async (id) => {
    if (runtime.isTauri) await sqlite.meHealthDelete(id);
    set((s) => ({ meHealth: s.meHealth.filter((x) => x.id !== id) }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:health', JSON.stringify(useWeaver.getState().meHealth));
      } catch { /* ignore */ }
    }
  },

  loadMeShopping: async () => {
    if (runtime.isTauri) {
      const rows = await sqlite.meShoppingList();
      set({ meShopping: rows });
    } else {
      try {
        const raw = localStorage.getItem('weaver:me:shopping');
        set({ meShopping: raw ? JSON.parse(raw) : [] });
      } catch { set({ meShopping: [] }); }
    }
  },
  upsertMeShopping: async (item) => {
    if (runtime.isTauri) await sqlite.meShoppingSave(item);
    set((s) => ({ meShopping: [...s.meShopping.filter((x) => x.id !== item.id), item] }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:shopping', JSON.stringify(useWeaver.getState().meShopping));
      } catch { /* ignore */ }
    }
  },
  deleteMeShopping: async (id) => {
    if (runtime.isTauri) await sqlite.meShoppingDelete(id);
    set((s) => ({ meShopping: s.meShopping.filter((x) => x.id !== id) }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:shopping', JSON.stringify(useWeaver.getState().meShopping));
      } catch { /* ignore */ }
    }
  },

  loadMeIntegrations: async () => {
    if (runtime.isTauri) {
      const rows = await sqlite.meIntegrationsList();
      set({ meIntegrations: rows });
    } else {
      try {
        const raw = localStorage.getItem('weaver:me:integrations');
        set({ meIntegrations: raw ? JSON.parse(raw) : [] });
      } catch { set({ meIntegrations: [] }); }
    }
  },
  upsertMeIntegration: async (it) => {
    if (runtime.isTauri) await sqlite.meIntegrationsSave(it);
    set((s) => ({ meIntegrations: [...s.meIntegrations.filter((x) => x.id !== it.id), it] }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:integrations', JSON.stringify(useWeaver.getState().meIntegrations));
      } catch { /* ignore */ }
    }
  },
  deleteMeIntegration: async (id) => {
    if (runtime.isTauri) await sqlite.meIntegrationsDelete(id);
    set((s) => ({ meIntegrations: s.meIntegrations.filter((x) => x.id !== id) }));
    if (runtime.isBrowser) {
      try {
        localStorage.setItem('weaver:me:integrations', JSON.stringify(useWeaver.getState().meIntegrations));
      } catch { /* ignore */ }
    }
  },

  loadMeAll: async () => {
    await Promise.all([
      get().loadMeCalendars(),
      get().loadMeEvents(),
      get().loadMeTasks(),
      get().loadMeNotes(),
      get().loadMeHealth(),
      get().loadMeShopping(),
      get().loadMeIntegrations(),
    ]);
  },

  hideCapsule: (id) =>
    set((s) => {
      const next = new Set(s.hiddenCapsules);
      next.add(id);
      return { hiddenCapsules: next };
    }),
}));

// Inicializar al cargar: crear conversación por defecto.
useWeaver.subscribe((s) => {
  if (s.conversations.length === 0 && !s.activeConversationId) {
    s.newConversation();
  }
});

// ============================================================================
// Auto-titulación de conversaciones con IA.
// ============================================================================

/** Conversaciones que ya están siendo tituladas, para evitar duplicar. */
const inFlightTitles = new Set<string>();

/**
 * Si la conversación sigue con el título por defecto ("Nuevo chat"),
 * llama al LLM con el primer mensaje del usuario para generar un título
 * corto (máx 5 palabras) y lo persiste.
 *
 * Es best-effort: si falla (no hay API key, sin red, etc.) se queda con
 * el título por defecto.
 */
async function maybeAutoTitleConversation(convId: string, userText: string) {
  // Solo titulamos si el texto no está vacío.
  const text = userText.trim();
  if (!text) return;
  // Solo titulamos si la conversación sigue con el título por defecto.
  const conv = useWeaver.getState().conversations.find((c) => c.id === convId);
  if (!conv) return;
  if (conv.title !== 'Nuevo chat') return;
  // Solo titulamos si es efectivamente el primer mensaje del usuario.
  const userMsgs = conv.messages.filter((m) => m.role === 'user');
  if (userMsgs.length !== 1) return;
  // Evitar invocaciones simultáneas para la misma conversación.
  if (inFlightTitles.has(convId)) return;
  inFlightTitles.add(convId);
  try {
    const { createProvider } = await import('@/providers');
    const { apiKeyStore } = await import('@/providers/store');
    const { streamChat } = await import('@/lib/chain');
    const s = useWeaver.getState();
    // Respetar el activeMember (mismo provider+model+API key que el chat).
    const activeMember = s.members.find((m) => m.id === s.activeMemberId);
    const providerId = (activeMember?.providerId as typeof s.providerId | null) ?? s.providerId;
    const apiKeyOverride = activeMember
      ? await apiKeyStore.getForMember(activeMember.id, providerId)
      : undefined;
    const llm = await createProvider(providerId, { apiKeyOverride });
    const prompt: Message[] = [
      {
        role: 'system',
        content:
          'Generas un título MUY corto (máximo 5 palabras, sin comillas, sin puntuación final) ' +
          'que resuma el tema del primer mensaje del usuario. ' +
          'Responde con el título ÚNICAMENTE, sin prefijos como "Título:" ni explicaciones. ' +
          'Usa el mismo idioma del mensaje del usuario. ' +
          'Ejemplos: "Receta pasta carbonara", "Configurar servidor nginx", "Comparar vuelos Madrid".',
      },
      {
        role: 'user',
        content: text.slice(0, 800),
      },
    ];
    const result = await streamChat(llm, activeMember?.modelId ?? s.modelId, prompt, {});
    let title = result.text.trim();
    // Limpiar comillas, "Título:", etc.
    title = title
      .replace(/^t[íi]tulo\s*:\s*/i, '')
      .replace(/^["'«»]+|["'«»]+$/g, '')
      .replace(/\.$/, '')
      .replace(/\n.*$/s, '')
      .slice(0, 60);
    if (title && title.length >= 2) {
      await useWeaver.getState().renameConversation(convId, title);
    }
  } catch (e) {
    console.warn('maybeAutoTitleConversation failed:', e);
  } finally {
    inFlightTitles.delete(convId);
  }
}

// ============================================================================
// Helper: persistencia con debounce del último mensaje del asistente.
// ============================================================================

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Programa la persistencia del último mensaje del asistente con debounce.
 * El mensaje se persiste 2s después del último delta, para no spammear
 * la base de datos durante el streaming.
 */
function schedulePersistLastMessage() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const s = useWeaver.getState();
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    if (!conv) return;
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'assistant' || !last.id) return;
    const msgRow = {
      id: last.id,
      conversation_id: conv.id,
      role: 'assistant',
      content: last.content ?? '',
      ts: last.ts ?? Date.now(),
      attachments_json: last.attachments ? JSON.stringify(last.attachments) : null,
      reasoning: last.reasoning ?? null,
    };
    sqlite.saveMessage(msgRow).catch((e) =>
      console.warn('debounced saveMessage failed:', e),
    );
  }, 2000);
}
