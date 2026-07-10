/**
 * Memoria episódica + semántica.
 *
 * MVP: usa localStorage con claves prefijadas. Para producción se migrará a
 * SQLite (vía Tauri command `memory_*`). La interfaz es la misma.
 */

import type { Episode, Fact } from './types';

const EPISODES_KEY = 'weaver:episodes';
const FACTS_KEY = 'weaver:facts';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

export const memory = {
  // --- Episodios -----------------------------------------------------------
  listEpisodes(): Episode[] {
    return read<Episode[]>(EPISODES_KEY, []);
  },

  saveEpisode(episode: Episode): void {
    const all = memory.listEpisodes();
    const idx = all.findIndex((e) => e.id === episode.id);
    if (idx >= 0) all[idx] = episode;
    else all.unshift(episode);
    write(EPISODES_KEY, all.slice(0, 100));
  },

  getEpisode(id: string): Episode | undefined {
    return memory.listEpisodes().find((e) => e.id === id);
  },

  /** Busca episodios similares por texto simple (substring match en objetivo). */
  findSimilar(query: string, limit = 3): Episode[] {
    const q = query.toLowerCase();
    return memory
      .listEpisodes()
      .filter((e) => e.objective.toLowerCase().includes(q) || q.includes(e.objective.toLowerCase().split(' ')[0]))
      .slice(0, limit);
  },

  // --- Hechos --------------------------------------------------------------
  listFacts(): Fact[] {
    return read<Fact[]>(FACTS_KEY, []);
  },

  getFact(key: string): string | undefined {
    return memory.listFacts().find((f) => f.key === key)?.value;
  },

  setFact(key: string, value: string, source: Fact['source'] = 'agent'): void {
    const all = memory.listFacts();
    const idx = all.findIndex((f) => f.key === key);
    const fact: Fact = { key, value, source, updatedAt: Date.now() };
    if (idx >= 0) all[idx] = fact;
    else all.push(fact);
    write(FACTS_KEY, all);
  },

  deleteFact(key: string): void {
    write(
      FACTS_KEY,
      memory.listFacts().filter((f) => f.key !== key),
    );
  },

  // --- Limpieza ------------------------------------------------------------
  clearAll(): void {
    localStorage.removeItem(EPISODES_KEY);
    localStorage.removeItem(FACTS_KEY);
  },
};
