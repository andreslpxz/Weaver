/**
 * Memoria episódica + semántica.
 *
 * Estrategia híbrida:
 *   - En modo Tauri: usa SQLite vía `sqlite.*` (persistencia real en ~/.weaver/memory.db)
 *   - En modo navegador: usa localStorage con las mismas claves (fallback)
 *
 * La interfaz es idéntica para que el resto del código no se preocupe.
 */

import { runtime, sqlite, type EpisodeRow, type FactRow } from '@/lib/tauri';
import type { Episode, Fact } from './types';

const EPISODES_KEY = 'weaver:episodes';
const FACTS_KEY = 'weaver:facts';

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function lsWrite<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

// ============================================================================
// Helpers de conversión (SQLite ↔ domain types)
// ============================================================================

function rowToEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    objective: row.objective,
    plan: JSON.parse(row.plan_json),
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    outcome: row.outcome as Episode['outcome'],
    lessons: row.lessons_json ? JSON.parse(row.lessons_json) : [],
    skillGenerated: row.skill_generated ?? undefined,
  };
}

function rowToFact(row: FactRow): Fact {
  return {
    key: row.key,
    value: row.value,
    source: row.source as Fact['source'],
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// API pública
// ============================================================================

export const memory = {
  // --- Episodios -----------------------------------------------------------
  async listEpisodes(): Promise<Episode[]> {
    if (runtime.isTauri) {
      const rows = await sqlite.listEpisodes();
      return rows.map(rowToEpisode);
    }
    return lsRead<Episode[]>(EPISODES_KEY, []);
  },

  async saveEpisode(episode: Episode): Promise<void> {
    if (runtime.isTauri) {
      const row: EpisodeRow = {
        id: episode.id,
        objective: episode.objective,
        plan_json: JSON.stringify(episode.plan),
        started_at: episode.startedAt,
        finished_at: episode.finishedAt ?? null,
        outcome: episode.outcome,
        lessons_json: JSON.stringify(episode.lessons),
        skill_generated: episode.skillGenerated ?? null,
        project_id: null,
      };
      await sqlite.saveEpisode(row);
      return;
    }
    const all = lsRead<Episode[]>(EPISODES_KEY, []);
    const idx = all.findIndex((e) => e.id === episode.id);
    if (idx >= 0) all[idx] = episode;
    else all.unshift(episode);
    lsWrite(EPISODES_KEY, all.slice(0, 100));
  },

  async getEpisode(id: string): Promise<Episode | undefined> {
    const all = await memory.listEpisodes();
    return all.find((e) => e.id === id);
  },

  /** Busca episodios similares por texto simple (substring match en objetivo). */
  async findSimilar(query: string, limit = 3): Promise<Episode[]> {
    const q = query.toLowerCase();
    const all = await memory.listEpisodes();
    return all
      .filter(
        (e) =>
          e.objective.toLowerCase().includes(q) ||
          q.includes(e.objective.toLowerCase().split(' ')[0]),
      )
      .slice(0, limit);
  },

  // --- Hechos --------------------------------------------------------------
  async listFacts(): Promise<Fact[]> {
    if (runtime.isTauri) {
      const rows = await sqlite.listFacts();
      return rows.map(rowToFact);
    }
    return lsRead<Fact[]>(FACTS_KEY, []);
  },

  async getFact(key: string): Promise<string | undefined> {
    if (runtime.isTauri) {
      return await sqlite.getFact(key) ?? undefined;
    }
    return lsRead<Fact[]>(FACTS_KEY, []).find((f) => f.key === key)?.value;
  },

  async setFact(key: string, value: string, source: Fact['source'] = 'agent'): Promise<void> {
    if (runtime.isTauri) {
      await sqlite.setFact(key, value, source);
      return;
    }
    const all = lsRead<Fact[]>(FACTS_KEY, []);
    const idx = all.findIndex((f) => f.key === key);
    const fact: Fact = { key, value, source, updatedAt: Date.now() };
    if (idx >= 0) all[idx] = fact;
    else all.push(fact);
    lsWrite(FACTS_KEY, all);
  },

  async deleteFact(key: string): Promise<void> {
    if (runtime.isTauri) {
      await sqlite.deleteFact(key);
      return;
    }
    lsWrite(
      FACTS_KEY,
      lsRead<Fact[]>(FACTS_KEY, []).filter((f) => f.key !== key),
    );
  },

  // --- Limpieza ------------------------------------------------------------
  async clearAll(): Promise<void> {
    if (runtime.isTauri) {
      await sqlite.clearAll();
      return;
    }
    localStorage.removeItem(EPISODES_KEY);
    localStorage.removeItem(FACTS_KEY);
  },
};
