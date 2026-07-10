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

export type ViewId = 'chat' | 'complementos' | 'habilidades' | 'automatizaciones' | 'configuracion';

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  plan?: Plan;
  traces: Record<string, TraceStep[]>; // subtaskId → steps
  agentState: 'idle' | 'planning' | 'executing' | 'reflecting' | 'error';
  createdAt: number;
  updatedAt: number;
}

interface WeaverState {
  // --- UI ---
  view: ViewId;
  setView: (v: ViewId) => void;

  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  modelPickerOpen: boolean;
  setModelPickerOpen: (open: boolean) => void;

  // --- Conversaciones ---
  conversations: Conversation[];
  activeConversationId: string | null;
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

  // --- Conversaciones ---
  conversations: [],
  activeConversationId: null,

  newConversation: () => {
    const id = crypto.randomUUID();
    const conv: Conversation = {
      id,
      title: 'Nuevo chat',
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
    return id;
  },

  selectConversation: (id) => set({ activeConversationId: id, view: 'chat' }),

  deleteConversation: (id) =>
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      const activeConversationId =
        s.activeConversationId === id ? conversations[0]?.id ?? null : s.activeConversationId;
      return { conversations, activeConversationId };
    }),

  appendMessage: (msg) =>
    set((s) => {
      if (!s.activeConversationId) return s;
      const conversations = s.conversations.map((c) =>
        c.id === s.activeConversationId
          ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() }
          : c,
      );
      return { conversations };
    }),

  updateLastAssistantMessage: (delta) =>
    set((s) => {
      if (!s.activeConversationId) return s;
      const conversations = s.conversations.map((c) => {
        if (c.id !== s.activeConversationId) return c;
        const msgs = [...c.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: last.content + delta };
        } else {
          msgs.push({ role: 'assistant', content: delta });
        }
        return { ...c, messages: msgs, updatedAt: Date.now() };
      });
      return { conversations };
    }),

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
