/**
 * Pins de conversaciones (chats fijados).
 *
 * Se persisten en localStorage (`weaver:pinned-convs`) para funcionar tanto
 * en navegador como en Tauri sin tocar el esquema SQLite. Los chats fijados
 * se muestran primero en el sidebar con una estrella.
 */

const KEY = 'weaver:pinned-convs';
const EVENT = 'weaver:pins-changed';

export function getPinnedConvIds(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function isConvPinned(id: string): boolean {
  return getPinnedConvIds().includes(id);
}

/** Alterna el pin de una conversación. Devuelve la lista actualizada. */
export function toggleConvPin(id: string): string[] {
  const current = getPinnedConvIds();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(EVENT));
  return next;
}

/** Limpia pins que apuntan a conversaciones que ya no existen. */
export function prunePins(existingIds: Set<string>): void {
  const current = getPinnedConvIds();
  const next = current.filter((id) => existingIds.has(id));
  if (next.length !== current.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }
}

/** Suscripción a cambios de pins (misma ventana). Devuelve unsubscribe. */
export function onPinsChanged(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
