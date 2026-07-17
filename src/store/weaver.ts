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
import { sqlite, runtime, type ProjectRow } from '@/lib/tauri';

export type ViewId = 'chat' | 'complementos' | 'habilidades' | 'automatizaciones' | 'configuracion';

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
}

export interface Project {
  id: string;
  name: string;
  color: string | null;
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
  setConversationProject: (convId: string, projectId: string | null) => Promise<void>;

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
  appendMessage: (msg: Message) => void;
  updateLastAssistantMessage: (delta: string) => void;
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

  // --- Modos del agente (toggles en el popup +) ---
  /** Modo plan: el agente primero propone un plan y espera confirmación antes de ejecutar. */
  planMode: boolean;
  /** Perseguir objetivo: el agente itera hasta completar el objetivo, no se rinde al primer fallo. */
  pursueObjective: boolean;
  setPlanMode: (v: boolean) => void;
  setPursueObjective: (v: boolean) => void;

  // --- Regeneración de mensajes ---
  regenerateMessage: (messageId: string) => Promise<void>;

  // --- Agent events ---
  handleAgentEvent: (event: AgentEvent) => void;
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
        })),
      });
    } else {
      // Fallback navegador: localStorage
      try {
        const raw = localStorage.getItem('weaver:projects');
        set({ projects: raw ? JSON.parse(raw) : [] });
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
      };
      set((s) => ({ projects: [...s.projects, proj] }));
      return proj;
    }
    const proj: Project = {
      id: crypto.randomUUID(),
      name,
      color: color ?? null,
      createdAt: Date.now(),
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

  // --- Modos del agente ---
  planMode: false,
  pursueObjective: true,
  setPlanMode: (v) => set({ planMode: v }),
  setPursueObjective: (v) => set({ pursueObjective: v }),

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
      const { streamUntilDone } = await import('@/lib/chain');
      const llm = await createProvider(s.providerId);
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
      const full = await streamUntilDone(llm, s.modelId, [systemMsg, ...context], {
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
}));

// Inicializar al cargar: crear conversación por defecto.
useWeaver.subscribe((s) => {
  if (s.conversations.length === 0 && !s.activeConversationId) {
    s.newConversation();
  }
});

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
