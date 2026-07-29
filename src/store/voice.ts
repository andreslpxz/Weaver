/**
 * Estado del Modo Live de Weaver.
 *
 * State machine:
 *   idle → listening → thinking → speaking → listening → ...
 *                ↑                                |
 *                └── interrupción del usuario ────┘
 *
 * Además de la conversación principal, mantiene una lista de "background tasks"
 * que el usuario delegó a subagentes/orquestador mientras sigue hablando.
 */

import { create } from 'zustand';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

/**
 * Modo de audio:
 *   - 'headphones': ASR siempre activo. El usuario puede interrumpir al
 *     agente hablando (el TTS se cancela). Ideal con auriculares.
 *   - 'speakers':   ASR se pausa mientras el agente habla (thinking +
 *     speaking) para evitar feedback loop (eco). El usuario no puede
 *     interrumpir con voz; debe usar el botón Interrumpir. Ideal con
 *     altavoces sin auriculares.
 */
export type AudioMode = 'headphones' | 'speakers';

export interface VoiceTurn {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  /** Si es un mensaje de background task, el id de esa task. */
  taskId?: string;
  /** Tiempo de la emisión. */
  ts: number;
  /** true si es texto parcial (interim ASR) — se reemplaza. */
  interim?: boolean;
}

export interface VoiceBackgroundTask {
  id: string;
  label: string;          // descripción corta para la UI
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  result?: string;        // resumen corto del resultado
  error?: string;
}

export interface VoiceStore {
  open: boolean;
  state: VoiceState;
  error: string | null;
  turns: VoiceTurn[];
  interimText: string;
  backgroundTasks: VoiceBackgroundTask[];
  audioMode: AudioMode;

  // Acciones
  setOpen: (v: boolean) => void;
  setState: (s: VoiceState) => void;
  setError: (e: string | null) => void;
  pushTurn: (t: Omit<VoiceTurn, 'id' | 'ts'>) => string;
  updateTurn: (id: string, patch: Partial<VoiceTurn>) => void;
  setInterimText: (t: string) => void;
  clearTurns: () => void;
  setAudioMode: (m: AudioMode) => void;

  addBackgroundTask: (label: string) => string;
  setBackgroundTaskStatus: (id: string, status: VoiceBackgroundTask['status'], result?: string, error?: string) => void;
  removeBackgroundTask: (id: string) => void;
}

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const useVoiceStore = create<VoiceStore>((set) => ({
  open: false,
  state: 'idle',
  error: null,
  turns: [],
  interimText: '',
  backgroundTasks: [],
  // Default: 'speakers' (safe — pausa ASR durante TTS para evitar eco).
  // Si el usuario usa auriculares, puede cambiar a 'headphones' para
  // permitir interrupción por voz.
  audioMode: 'speakers',

  setOpen: (v) => set((s) => (v === s.open ? s : { open: v, error: v ? s.error : null })),
  setState: (st) => set({ state: st }),
  setError: (e) => set({ error: e, state: e ? 'error' : 'idle' }),
  pushTurn: (t) => {
    const id = newId();
    set((s) => ({ turns: [...s.turns, { ...t, id, ts: Date.now() }] }));
    return id;
  },
  updateTurn: (id, patch) =>
    set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  setInterimText: (t) => set({ interimText: t }),
  clearTurns: () => set({ turns: [], interimText: '' }),
  setAudioMode: (m) => set({ audioMode: m }),

  addBackgroundTask: (label) => {
    const id = newId();
    set((s) => ({
      backgroundTasks: [
        ...s.backgroundTasks,
        { id, label, status: 'pending', startedAt: Date.now() },
      ],
    }));
    return id;
  },
  setBackgroundTaskStatus: (id, status, result, error) =>
    set((s) => ({
      backgroundTasks: s.backgroundTasks.map((t) =>
        t.id === id
          ? { ...t, status, result, error, finishedAt: status === 'done' || status === 'failed' || status === 'cancelled' ? Date.now() : t.finishedAt }
          : t,
      ),
    })),
  removeBackgroundTask: (id) =>
    set((s) => ({ backgroundTasks: s.backgroundTasks.filter((t) => t.id !== id) })),
}));
