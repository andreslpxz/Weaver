/**
 * Registry de skills: parsea archivos SKILL.md (frontmatter YAML + body markdown)
 * y los carga en memoria para que el planner pueda inyectarlos en el contexto.
 *
 * Formato SKILL.md:
 *   ---
 *   name: write-prd
 *   description: Escribe un PRD estructurado
 *   triggers:
 *     - "escribe un PRD"
 *   tools_required:
 *     - file.write
 *     - mcp.notion
 *   ---
 *   # Cómo escribir un PRD
 *   1. Confirma el dominio...
 */

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  toolsRequired: string[];
  body: string;
  source: 'installed' | 'learned' | 'builtin';
  filePath?: string;
}

const STORE_KEY = 'weaver:skills:cache';

export const skillsRegistry = {
  /** Carga todas las skills disponibles (instaladas + aprendidas). */
  async loadAll(): Promise<Skill[]> {
    // MVP: leer de localStorage cache. En producción, via Tauri command
    // `skills_list` que escanea ~/.weaver/skills/{installed,learned}/*.md.
    const cached = readCache();
    return cached;
  },

  /** Devuelve skills cuyo trigger coincide con el objetivo del usuario. */
  async findRelevant(objective: string): Promise<Skill[]> {
    const all = await this.loadAll();
    const obj = objective.toLowerCase();
    return all.filter((s) =>
      s.triggers.some((t) => obj.includes(t.toLowerCase())),
    );
  },

  /** Registra una skill en el cache local (tras ser instalada o aprendida). */
  register(skill: Skill): void {
    const all = readCache();
    const idx = all.findIndex((s) => s.name === skill.name);
    if (idx >= 0) all[idx] = skill;
    else all.push(skill);
    writeCache(all);
  },

  /** Elimina una skill del cache. */
  unregister(name: string): void {
    writeCache(readCache().filter((s) => s.name !== name));
  },
};

// ============================================================================
// Parser
// ============================================================================

export function parseSkillMarkdown(content: string, source: Skill['source'] = 'installed'): Skill {
  const { frontmatter, body } = splitFrontmatter(content);
  const name = typeof frontmatter.name === 'string' ? frontmatter.name : 'unnamed';
  const description = typeof frontmatter.description === 'string' ? frontmatter.description : '';
  const triggers = Array.isArray(frontmatter.triggers) ? (frontmatter.triggers as string[]) : [];
  const toolsRequired = Array.isArray(frontmatter.tools_required)
    ? (frontmatter.tools_required as string[])
    : [];
  return {
    name,
    description,
    triggers,
    toolsRequired,
    body,
    source,
  };
}

function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const yaml = match[1];
  const body = match[2];
  const frontmatter: Record<string, unknown> = {};
  // Parser YAML minimalista (sólo claves planas y listas "- item").
  let currentKey = '';
  for (const line of yaml.split('\n')) {
    const listMatch = line.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      const existing = frontmatter[currentKey];
      const value: string = listMatch[1].replace(/^["']|["']$/g, '');
      if (Array.isArray(existing)) (existing as string[]).push(value);
      else frontmatter[currentKey] = [value];
      continue;
    }
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val: string = kvMatch[2].replace(/^["']|["']$/g, '').trim();
      if (val) frontmatter[currentKey] = val;
    }
  }
  return { frontmatter, body };
}

// ============================================================================
// Cache local
// ============================================================================

function readCache(): Skill[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Skill[];
  } catch {
    return [];
  }
}

function writeCache(skills: Skill[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(skills));
  } catch {
    // ignore
  }
}
