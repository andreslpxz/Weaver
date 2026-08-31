/**
 * Sistema de "Estilo total" — cada preset cambia la paleta, la redondez de
 * bordes, la elevación (sombras), la tipografía y la densidad de una sola vez.
 *
 * Las preferencias finas (sliders de la pestaña Apariencia) se guardan en
 * localStorage y se aplican al <html> como data-attributes + variables CSS,
 * que tokens.css traduce a estilos globales.
 */

import type { ThemeId } from '@/lib/themes';

// ---------------------------------------------------------------------------
// Tipos de preferencias de diseño
// ---------------------------------------------------------------------------

/** Escala de redondez de bordes (de esquinas rectas a tipo píldora). */
export type RadiusId = 'nulo' | 'sutil' | 'medio' | 'redondeado' | 'completo';

/** Intensidad de las sombras de elevación. */
export type ElevationId = '0' | '1' | '2' | '3';

/** Tipografía principal de la interfaz. */
export type FontMainId = 'inter' | 'system' | 'serif' | 'playfair';

/** Tipografía para bloques de código. */
export type FontCodeId = 'jetbrains' | 'fira' | 'system-mono';

/** Densidad del espaciado. */
export type DensityId = 'compacta' | 'normal' | 'relajada';

export interface DesignPrefs {
  radius: RadiusId;
  elevation: ElevationId;
  fontMain: FontMainId;
  fontCode: FontCodeId;
  /** Índice dentro de FONT_SCALES (0 = 87.5% … 6 = 125%). */
  fontScale: number;
  density: DensityId;
}

// ---------------------------------------------------------------------------
// Catálogos (orden = orden en los sliders)
// ---------------------------------------------------------------------------

export const RADII: { id: RadiusId; label: string; hint: string }[] = [
  { id: 'nulo', label: 'Nulo', hint: 'Esquinas rectas' },
  { id: 'sutil', label: 'Sutil', hint: 'Apenas redondeado' },
  { id: 'medio', label: 'Medio', hint: 'Equilibrado (default)' },
  { id: 'redondeado', label: 'Redondeado', hint: 'Suave y amable' },
  { id: 'completo', label: 'Completo', hint: 'Cápsulas tipo píldora' },
];

export const ELEVATIONS: { id: ElevationId; label: string }[] = [
  { id: '0', label: 'Mínima' },
  { id: '1', label: 'Baja' },
  { id: '2', label: 'Media' },
  { id: '3', label: 'Alta' },
];

export const FONT_MAINS: { id: FontMainId; label: string; stack: string }[] = [
  { id: 'inter', label: 'Inter Sans', stack: "'Inter', system-ui, sans-serif" },
  { id: 'system', label: 'Sistema', stack: 'system-ui, -apple-system, sans-serif' },
  { id: 'serif', label: 'Serif elegante', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'playfair', label: 'Playfair Display', stack: "'Playfair Display', Georgia, serif" },
];

export const FONT_CODES: { id: FontCodeId; label: string; stack: string }[] = [
  { id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', 'Fira Code', monospace" },
  { id: 'fira', label: 'Fira Code', stack: "'Fira Code', 'JetBrains Mono', monospace" },
  { id: 'system-mono', label: 'Mono del sistema', stack: "ui-monospace, 'Cascadia Code', Menlo, monospace" },
];

export const DENSITIES: { id: DensityId; label: string }[] = [
  { id: 'compacta', label: 'Compacto' },
  { id: 'normal', label: 'Normal' },
  { id: 'relajada', label: 'Relajado' },
];

/** Escalas de tamaño de texto (afecta a todo lo rem-based). */
export const FONT_SCALES: { pct: number; label: string }[] = [
  { pct: 87.5, label: 'Muy pequeño' },
  { pct: 93.75, label: 'Pequeño' },
  { pct: 100, label: 'Normal' },
  { pct: 106.25, label: 'Mediano' },
  { pct: 112.5, label: 'Grande' },
  { pct: 118.75, label: 'Muy grande' },
  { pct: 125, label: 'Enorme' },
];

// ---------------------------------------------------------------------------
// Presets de estilo completo
// ---------------------------------------------------------------------------

export type StyleId = 'weaver' | 'grok' | 'chatgpt' | 'claude' | 'gemini';

export interface StylePreset {
  id: StyleId;
  name: string;
  tagline: string;
  desc: string;
  /** Paleta asociada (se aplica junto con el resto de preferencias). */
  themeId: ThemeId;
  defaults: DesignPrefs;
  /** Colores para las muestras de la tarjeta. */
  preview: { bg: string; panel: string; accent: string; text: string; muted: string };
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'weaver',
    name: 'Weaver',
    tagline: 'El alma original',
    desc: 'Tejido textil cálido sobre carbón con verde sage. Equilibrado, para uso diario.',
    themeId: 'sage-dark',
    defaults: {
      radius: 'medio',
      elevation: '1',
      fontMain: 'inter',
      fontCode: 'jetbrains',
      fontScale: 2,
      density: 'normal',
    },
    preview: {
      bg: '#0e0f0c',
      panel: '#1e211d',
      accent: '#8FB89B',
      text: '#f4f4f0',
      muted: '#6b736e',
    },
  },
  {
    id: 'grok',
    name: 'Grok',
    tagline: 'Negro AMOLED',
    desc: 'Negro puro de alto contraste, esquinas casi rectas. Ideal para AMOLED y visión nocturna.',
    themeId: 'pure-black',
    defaults: {
      radius: 'sutil',
      elevation: '0',
      fontMain: 'inter',
      fontCode: 'jetbrains',
      fontScale: 2,
      density: 'normal',
    },
    preview: {
      bg: '#000000',
      panel: '#141414',
      accent: '#ffffff',
      text: '#ffffff',
      muted: '#6e6e6e',
    },
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    tagline: 'Neutro y limpio',
    desc: 'Gris neutro con botones claros y cero distracciones. Perfecto para trabajar sin ruido.',
    themeId: 'chatgpt-dark',
    defaults: {
      radius: 'medio',
      elevation: '1',
      fontMain: 'system',
      fontCode: 'jetbrains',
      fontScale: 2,
      density: 'normal',
    },
    preview: {
      bg: '#212121',
      panel: '#2f2f2f',
      accent: '#ececec',
      text: '#ececec',
      muted: '#8f8f8f',
    },
  },
  {
    id: 'claude',
    name: 'Claude',
    tagline: 'Cálido con serif',
    desc: 'Gris cálido con acento coral y tipografía serif elegante. Cómodo para lectura larga.',
    themeId: 'claude-warm',
    defaults: {
      radius: 'redondeado',
      elevation: '1',
      fontMain: 'serif',
      fontCode: 'fira',
      fontScale: 3,
      density: 'relajada',
    },
    preview: {
      bg: '#262624',
      panel: '#30302e',
      accent: '#d97757',
      text: '#f5f4ef',
      muted: '#8a8880',
    },
  },
  {
    id: 'gemini',
    name: 'Gemini',
    tagline: 'Brillo azul',
    desc: 'Negro azulado con brillos suaves y esquinas tipo píldora. Minimalista y moderno.',
    themeId: 'gemini-dark',
    defaults: {
      radius: 'completo',
      elevation: '2',
      fontMain: 'inter',
      fontCode: 'system-mono',
      fontScale: 2,
      density: 'normal',
    },
    preview: {
      bg: '#101214',
      panel: '#1d2026',
      accent: '#8ab4f8',
      text: '#e8eef8',
      muted: '#667186',
    },
  },
];

export function getStyleById(id: StyleId): StylePreset {
  return STYLE_PRESETS.find((s) => s.id === id) ?? STYLE_PRESETS[0];
}

// ---------------------------------------------------------------------------
// Persistencia y aplicación al DOM
// ---------------------------------------------------------------------------

const PREFS_KEY = 'weaver:design';
const STYLE_KEY = 'weaver:style';

export function getStoredStyleId(): StyleId {
  try {
    const stored = localStorage.getItem(STYLE_KEY) as StyleId | null;
    if (stored && STYLE_PRESETS.some((s) => s.id === stored)) return stored;
  } catch {
    // ignore
  }
  return 'weaver';
}

export function getDesignPrefs(): DesignPrefs {
  const fallback = getStyleById(getStoredStyleId()).defaults;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...fallback };
    const parsed = JSON.parse(raw) as Partial<DesignPrefs>;
    const valid: DesignPrefs = {
      radius: RADII.some((r) => r.id === parsed.radius) ? parsed.radius! : fallback.radius,
      elevation: ELEVATIONS.some((e) => e.id === parsed.elevation) ? parsed.elevation! : fallback.elevation,
      fontMain: FONT_MAINS.some((f) => f.id === parsed.fontMain) ? parsed.fontMain! : fallback.fontMain,
      fontCode: FONT_CODES.some((f) => f.id === parsed.fontCode) ? parsed.fontCode! : fallback.fontCode,
      fontScale:
        typeof parsed.fontScale === 'number' && parsed.fontScale >= 0 && parsed.fontScale < FONT_SCALES.length
          ? parsed.fontScale
          : fallback.fontScale,
      density: DENSITIES.some((d) => d.id === parsed.density) ? parsed.density! : fallback.density,
    };
    return valid;
  } catch {
    return { ...fallback };
  }
}

export function saveDesignPrefs(prefs: DesignPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

/** Aplica las preferencias al <html> como data-attrs + variables CSS. */
export function applyDesign(prefs: DesignPrefs): void {
  const root = document.documentElement;
  root.setAttribute('data-radius', prefs.radius);
  root.setAttribute('data-elev', prefs.elevation);
  root.setAttribute('data-density', prefs.density);
  root.setAttribute('data-fontscale', String(prefs.fontScale));

  const fontMain = FONT_MAINS.find((f) => f.id === prefs.fontMain) ?? FONT_MAINS[0];
  const fontCode = FONT_CODES.find((f) => f.id === prefs.fontCode) ?? FONT_CODES[0];
  root.style.setProperty('--font-main', fontMain.stack);
  root.style.setProperty('--font-code', fontCode.stack);
}

/** Selecciona un estilo completo: guarda prefs + estilo activo y aplica. */
export function applyStylePreset(id: StyleId): DesignPrefs {
  const style = getStyleById(id);
  try {
    localStorage.setItem(STYLE_KEY, id);
  } catch {
    // ignore
  }
  const prefs = { ...style.defaults };
  saveDesignPrefs(prefs);
  applyDesign(prefs);
  return prefs;
}

/** Init al arrancar la app (junto a initTheme). */
export function initDesign(): void {
  applyDesign(getDesignPrefs());
}
