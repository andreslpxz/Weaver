/**
 * Motor de tareas programadas (Schedules).
 *
 * - Carga las tareas desde localStorage (clave `weaver:schedules`).
 * - Cada 30s revisa si alguna tarea activa debe ejecutarse ahora.
 * - Cuando llega la hora, crea una nueva conversación y envía la instrucción
 *   del schedule al agente (igual que si el usuario la escribiera).
 * - Marca lastRunAt para no repetir la misma tarea en el mismo minuto.
 *
 * El scheduler sólo corre mientras Weaver está abierto.
 */

import type { ScheduledTask } from '@/views/Views';

const SCHEDULES_KEY = 'weaver:schedules';
const CHECK_INTERVAL_MS = 30_000; // 30s

function loadSchedules(): ScheduledTask[] {
  try {
    const raw = localStorage.getItem(SCHEDULES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSchedules(tasks: ScheduledTask[]) {
  try {
    localStorage.setItem(SCHEDULES_KEY, JSON.stringify(tasks));
  } catch { /* ignore */ }
}

function shouldRunNow(t: ScheduledTask, now: Date): boolean {
  if (!t.enabled) return false;
  const [hh, mm] = t.time.split(':').map(Number);
  if (hh !== now.getHours() || mm !== now.getMinutes()) return false;
  // ¿Ya corrió este minuto?
  if (t.lastRunAt) {
    const last = new Date(t.lastRunAt);
    if (
      last.getFullYear() === now.getFullYear() &&
      last.getMonth() === now.getMonth() &&
      last.getDate() === now.getDate() &&
      last.getHours() === now.getHours() &&
      last.getMinutes() === now.getMinutes()
    ) {
      return false;
    }
  }
  switch (t.recurrence) {
    case 'once':
      return true;
    case 'daily':
      return true;
    case 'weekdays': {
      const d = now.getDay();
      return d >= 1 && d <= 5;
    }
    case 'weekly':
      return now.getDay() === (t.weekday ?? 1);
    case 'monthly':
      return now.getDate() === (t.monthDay ?? 1);
    default:
      return false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

async function runTask(t: ScheduledTask): Promise<void> {
  const { useWeaver } = await import('@/store/weaver');
  const { createProvider } = await import('@/providers');
  const { runAgent } = await import('@/agent/loop');

  const store = useWeaver.getState();
  const newId = store.newConversation();
  // Renombrar la conversación con el nombre de la tarea para que sea reconocible.
  await store.renameConversation(newId, `[Schedule] ${t.name}`);
  // Añadir un mensaje de sistema que indique que es un schedule, con la instrucción.
  store.appendMessage({
    id: crypto.randomUUID(),
    ts: Date.now(),
    role: 'user',
    content:
      `[Tarea programada: ${t.name}]\n\n` +
      t.instruction +
      '\n\n[Contexto: esta tarea se ejecutó automáticamente según el schedule configurado en la sección Schedules. ' +
      'Procede igual que si te lo hubiera pedido el usuario.]',
  });

  try {
    const llm = await createProvider(store.providerId);
    const ac = new AbortController();
    for await (const _evt of runAgent(llm, store.modelId, t.instruction, {
      signal: ac.signal,
      onEvent: store.handleAgentEvent,
    })) {
      void _evt;
    }
    // Marcar como éxito (aproximado: si no lanzó excepción, asumimos success).
    markRun(t.id, 'success', 'Tarea ejecutada.');
  } catch (e) {
    markRun(t.id, 'failed', e instanceof Error ? e.message : String(e));
  }
}

function markRun(id: string, status: 'success' | 'partial' | 'failed', message: string) {
  const tasks = loadSchedules();
  const updated = tasks.map((t) =>
    t.id === id
      ? {
          ...t,
          lastRunAt: Date.now(),
          lastRunStatus: status,
          lastRunMessage: message.slice(0, 200),
        }
      : t,
  );
  saveSchedules(updated);
  // Notificar a la UI (si está abierta) que el schedule cambió.
  window.dispatchEvent(new CustomEvent('weaver:schedules-updated'));
}

function tick() {
  if (isRunning) return;
  const tasks = loadSchedules();
  if (tasks.length === 0) return;
  const now = new Date();
  const due = tasks.filter((t) => shouldRunNow(t, now));
  if (due.length === 0) return;
  isRunning = true;
  // Ejecutar en paralelo pero limitando a 3 simultáneas.
  Promise.all(due.slice(0, 3).map((t) => runTask(t).catch(() => {}))).finally(() => {
    isRunning = false;
  });
}

export function startScheduler() {
  if (timer) return;
  // Tick inicial tras 2s (para que cargue el store).
  setTimeout(tick, 2000);
  timer = setInterval(tick, CHECK_INTERVAL_MS);
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
