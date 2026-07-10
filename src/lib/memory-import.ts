/**
 * Importación de memoria desde otras IAs (ChatGPT, Claude, Gemini, Grok, etc.).
 *
 * Flujo:
 *   1. El usuario pega el prompt estándar (provisto por la app origen) en
 *      Weaver junto con la respuesta generada por la IA origen.
 *   2. `parseImportedMemory()` detecta la sección "Importado de: <name>" al
 *      final y categoriza el contenido según las 5 categorías del prompt:
 *        - Información demográfica
 *        - Intereses y preferencias
 *        - Relaciones
 *        - Eventos, proyectos y planes con fecha
 *        - Instrucciones
 *   3. Cada entrada se guarda como un Fact en la memoria semántica de Weaver
 *      con prefijo `imported:<source>:`.
 *   4. El agente usará estos facts automáticamente al planificar/razonar.
 *
 * El prompt estándar (incluido en la UI como placeholder) fuerza un formato
 * predecible que podemos parsear.
 */

import { memory } from '@/agent/memory';

export type MemorySource = 'ChatGPT' | 'Claude' | 'Gemini' | 'Grok' | 'Perplexity' | 'Copilot' | 'Other';

export interface ImportedFact {
  category: ImportedCategory;
  text: string;
  source: MemorySource;
}

export type ImportedCategory =
  | 'demographic'
  | 'interests'
  | 'relationships'
  | 'events'
  | 'instructions';

export const CATEGORY_LABELS: Record<ImportedCategory, string> = {
  demographic: 'Información demográfica',
  interests: 'Intereses y preferencias',
  relationships: 'Relaciones',
  events: 'Eventos, proyectos y planes',
  instructions: 'Instrucciones',
};

export const CATEGORY_KEYWORDS: Record<ImportedCategory, string[]> = {
  demographic: ['información demográfica', 'demographic'],
  interests: ['intereses y preferencias', 'interests'],
  relationships: ['relaciones', 'relationships'],
  events: ['eventos, proyectos y planes', 'eventos, planes', 'events'],
  instructions: ['instrucciones', 'instructions'],
};

/** El prompt canónico que el usuario debe pegar en la otra IA. */
export const IMPORT_PROMPT = `Me estás ayudando a importar contexto de un asistente de IA a otro. Tu trabajo es revisar nuestras conversaciones anteriores y resumir lo que sabes sobre mí.

En los datos de salida, evita usar pronombres en primera persona (yo, mi, mí o mío) y en segunda persona (tú, tu o tuyo). En cambio, refiérete a la persona de la que aprendiste como "el usuario" o usa una frase neutral.

Conserva las palabras del usuario de forma literal cuando sea posible, en especial para las instrucciones y preferencias.

Categorías (datos de salida en este orden):
1. Información demográfica: Nombres preferidos, profesión, educación y residencia general
2. Intereses y preferencias: Participaciones activas y sostenidas en el tiempo (no solo la posesión de un objeto o una compra única)
3. Relaciones: Relaciones confirmadas y sostenidas en el tiempo
4. Eventos, proyectos y planes con fecha: Un registro de actividades recientes y significativas
5. Instrucciones: Reglas que te pedí explícitamente que sigas en el futuro, como "siempre haz X", "nunca hagas Y" y correcciones a tu comportamiento (incluye solo reglas de memorias almacenadas, no de conversaciones)

Formato:
Usa las categorías anteriores para dividir el contenido en la sección etiquetada. Intenta incluir citas textuales de mis instrucciones que justifiquen cada entrada. Estructura cada entrada con este formato:
* El usuario se llama <name>.
    * Prueba: El usuario dijo "llámame <name>". Fecha: [YYYY-MM-DD].

Salida:
- Muestra SOLO la información solicitada. No incluyas texto de relleno, texto introductorio ni despedidas.

Por último, completa la frase "Importado de: <name>", donde el nombre es ChatGPT, Claude, Grok, etc. Este debe ser el texto final absoluto en tu respuesta.`;

/**
 * Parsea la respuesta generada por la IA origen.
 * Detecta secciones por headers y bullets, y la fuente final.
 */
export function parseImportedMemory(text: string): { facts: ImportedFact[]; source: MemorySource } {
  const source = detectSource(text);

  // Normalizar: quitar acentos para comparar keywords
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const facts: ImportedFact[] = [];

  // Dividir por secciones. Aceptamos headers tipo "## Categoría" o "1. Categoría"
  // o "Categoría:".
  const sections = splitSections(text);

  for (const section of sections) {
    const cat = detectCategory(section.header);
    if (!cat) continue;
    // Extraer bullets del cuerpo.
    const bullets = extractBullets(section.body);
    for (const b of bullets) {
      const cleaned = b.trim();
      if (!cleaned) continue;
      facts.push({ category: cat, text: cleaned, source });
    }
  }

  // Si no se detectaron secciones pero hay bullets sueltos, asignar a "instructions".
  if (facts.length === 0) {
    const looseBullets = extractBullets(text);
    for (const b of looseBullets) {
      if (b.trim()) facts.push({ category: 'instructions', text: b.trim(), source });
    }
  }

  // Filtrar bullets que sean solo "Importado de:"
  return {
    facts: facts.filter((f) => !f.text.toLowerCase().startsWith('importado de:')),
    source,
  };
}

function detectSource(text: string): MemorySource {
  const m = text.match(/Importado\s+de:\s*([A-Za-z]+)/i);
  if (!m) return 'Other';
  const name = m[1].toLowerCase();
  if (name.includes('chatgpt') || name.includes('openai')) return 'ChatGPT';
  if (name.includes('claude') || name.includes('anthropic')) return 'Claude';
  if (name.includes('gemini') || name.includes('google')) return 'Gemini';
  if (name.includes('grok') || name.includes('xai')) return 'Grok';
  if (name.includes('perplexity')) return 'Perplexity';
  if (name.includes('copilot')) return 'Copilot';
  return 'Other';
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

interface Section {
  header: string;
  body: string;
}

function splitSections(text: string): Section[] {
  // Buscar headers tipo "## X", "### X", "1. X", "X:" donde X contiene una keyword
  const lines = text.split('\n');
  const sections: Section[] = [];
  let current: Section | null = null;

  const isHeader = (line: string): boolean => {
    const norm = normalize(line);
    // Formato "## X", "### X", "1. X", "**X**"
    if (/^#{1,6}\s+\S/.test(line)) return true;
    if (/^\d+\.\s+[A-ZÁÉÍÓÚÑ]/.test(line)) return true;
    if (/^\*\*[^*]+\*\*:?\s*$/.test(line)) return true;
    // Línea corta terminada en ":" que contiene una keyword de categoría
    const short = line.trim().replace(/:$/, '');
    if (short.length < 80) {
      for (const kws of Object.values(CATEGORY_KEYWORDS)) {
        if (kws.some((k) => norm.includes(normalize(k)))) return true;
      }
    }
    return false;
  };

  for (const line of lines) {
    if (isHeader(line) || (line.startsWith('Importado de:') && current)) {
      if (current) sections.push(current);
      current = { header: line.trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    } else {
      // Línea suelta antes de cualquier header: la metemos en una sección sin header.
      current = { header: '', body: line + '\n' };
    }
  }
  if (current) sections.push(current);
  return sections;
}

function detectCategory(header: string): ImportedCategory | null {
  const norm = normalize(header);
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS) as [ImportedCategory, string[]][]) {
    if (kws.some((k) => norm.includes(normalize(k)))) return cat;
  }
  return null;
}

function extractBullets(body: string): string[] {
  const bullets: string[] = [];
  // Acepta "-", "*", "•" y numerales "1." como bullets.
  // Un bullet puede ocupar múltiples líneas si las siguientes están indentadas.
  const lines = body.split('\n');
  let current: string | null = null;
  for (const line of lines) {
    const match = line.match(/^\s*([-*•]|\d+\.)\s+(.*)$/);
    if (match) {
      if (current) bullets.push(current);
      current = match[2];
    } else if (current && /^\s+\S/.test(line)) {
      // Continuación indentada
      current += ' ' + line.trim();
    } else if (current) {
      bullets.push(current);
      current = null;
    }
  }
  if (current) bullets.push(current);
  return bullets;
}

/**
 * Importa los facts parseados al store de memoria de Weaver.
 * Cada fact se guarda con key `imported:<source>:<category>:<n>`.
 */
export async function importMemory(text: string): Promise<{
  facts: ImportedFact[];
  source: MemorySource;
  saved: number;
}> {
  const { facts, source } = parseImportedMemory(text);
  let saved = 0;
  const counters: Partial<Record<ImportedCategory, number>> = {};
  for (const f of facts) {
    const cat = f.category;
    counters[cat] = (counters[cat] ?? 0) + 1;
    const key = `imported:${source.toLowerCase()}:${cat}:${counters[cat]}`;
    await memory.setFact(key, f.text, 'user');
    saved++;
  }
  // Marcar la fuente como importada
  await memory.setFact(`imported:${source.toLowerCase()}:_meta`, `Importado el ${new Date().toISOString()}`, 'system');
  return { facts, source, saved };
}

/** Lista facts importados agrupados por source y categoría. */
export async function listImportedMemories(): Promise<
  { source: MemorySource; category: ImportedCategory; text: string }[]
> {
  const all = await memory.listFacts();
  return all
    .filter((f) => f.key.startsWith('imported:'))
    .filter((f) => !f.key.endsWith(':_meta'))
    .map((f) => {
      const parts = f.key.split(':');
      const source = (parts[1] ?? 'other') as MemorySource;
      const category = (parts[2] ?? 'instructions') as ImportedCategory;
      return { source, category, text: f.value };
    });
}
