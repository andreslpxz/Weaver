/**
 * Sistema de temas. Cada tema define un set de variables CSS que se aplican
 * al :root mediante un data-attribute `<html data-theme="...">`.
 *
 * Los temas están diseñados para mantener el layout/spacing de Tailwind pero
 * cambiar la paleta completa (background, texto, accent).
 */

export type ThemeId =
  | 'sage-dark'      // Verde sage sobre negro (default, paleta actual)
  | 'pure-black'     // Negro puro OLED (zero light)
  | 'soft-gray'      // Gris claro modo claro
  | 'midnight-blue'  // Azul oscuro tipo VSCode
  | 'warm-paper'     // Crema/papel cálido modo claro
  | 'cobalt';        // Azul cobalto sobre negro

export interface Theme {
  id: ThemeId;
  label: string;
  desc: string;
  /** Modo claro u oscuro (afecta status bar, etc). */
  mode: 'dark' | 'light';
  /** Variables CSS a inyectar. */
  vars: Record<string, string>;
  /** Color de muestra para el swatch del selector. */
  swatch: string;
}

export const THEMES: Theme[] = [
  {
    id: 'sage-dark',
    label: 'Sage Dark',
    desc: 'Verde sage sobre carbón (default)',
    mode: 'dark',
    swatch: '#8FB89B',
    vars: {
      '--bg-app': '#0e0f0c',
      '--bg-sidebar': '#171915',
      '--bg-elevated': '#1e211d',
      '--bg-input': '#232722',
      '--border': '#2c302b',
      '--border-accent': '#3a3f38',
      '--text-primary': '#f4f4f0',
      '--text-secondary': '#9ca3a0',
      '--text-muted': '#6b736e',
      '--accent': '#8FB89B',
      '--accent-strong': '#A8C9B8',
      '--danger': '#E07A5F',
      '--warning': '#E8B86A',
      '--success': '#7BAE7F',
    },
  },
  {
    id: 'pure-black',
    label: 'Pure Black',
    desc: 'Negro puro OLED, ideal pantallas AMOLED',
    mode: 'dark',
    swatch: '#FFFFFF',
    vars: {
      '--bg-app': '#000000',
      '--bg-sidebar': '#0a0a0a',
      '--bg-elevated': '#141414',
      '--bg-input': '#1a1a1a',
      '--border': '#1f1f1f',
      '--border-accent': '#2a2a2a',
      '--text-primary': '#ffffff',
      '--text-secondary': '#a8a8a8',
      '--text-muted': '#6e6e6e',
      '--accent': '#ffffff',
      '--accent-strong': '#e0e0e0',
      '--danger': '#ff5555',
      '--warning': '#ffb86c',
      '--success': '#50fa7b',
    },
  },
  {
    id: 'soft-gray',
    label: 'Soft Gray',
    desc: 'Gris claro minimalista (modo claro)',
    mode: 'light',
    swatch: '#6B7280',
    vars: {
      '--bg-app': '#f7f7f5',
      '--bg-sidebar': '#ffffff',
      '--bg-elevated': '#ffffff',
      '--bg-input': '#ffffff',
      '--border': '#e5e5e3',
      '--border-accent': '#d4d4d2',
      '--text-primary': '#1a1a1a',
      '--text-secondary': '#525252',
      '--text-muted': '#9b9b9b',
      '--accent': '#4b5563',
      '--accent-strong': '#1f2937',
      '--danger': '#dc2626',
      '--warning': '#d97706',
      '--success': '#059669',
    },
  },
  {
    id: 'midnight-blue',
    label: 'Midnight Blue',
    desc: 'Azul oscuro estilo VSCode',
    mode: 'dark',
    swatch: '#569CD6',
    vars: {
      '--bg-app': '#0a0e1a',
      '--bg-sidebar': '#0f1424',
      '--bg-elevated': '#161c2e',
      '--bg-input': '#1a2138',
      '--border': '#252b3d',
      '--border-accent': '#364060',
      '--text-primary': '#d4d4d4',
      '--text-secondary': '#9cdcfe',
      '--text-muted': '#6a6a8a',
      '--accent': '#569CD6',
      '--accent-strong': '#4EC9B0',
      '--danger': '#F44747',
      '--warning': '#DCDCAA',
      '--success': '#6A9955',
    },
  },
  {
    id: 'warm-paper',
    label: 'Warm Paper',
    desc: 'Crema cálido tipo libro (modo claro)',
    mode: 'light',
    swatch: '#B8956A',
    vars: {
      '--bg-app': '#f5efe0',
      '--bg-sidebar': '#ede4cf',
      '--bg-elevated': '#faf6ec',
      '--bg-input': '#faf6ec',
      '--border': '#d9cfb8',
      '--border-accent': '#b8a888',
      '--text-primary': '#2a2218',
      '--text-secondary': '#5a4d3a',
      '--text-muted': '#8a7d6a',
      '--accent': '#b8956a',
      '--accent-strong': '#8b6914',
      '--danger': '#a14545',
      '--warning': '#b8860b',
      '--success': '#5a7a3a',
    },
  },
  {
    id: 'cobalt',
    label: 'Cobalt',
    desc: 'Azul cobalto eléctrico sobre negro',
    mode: 'dark',
    swatch: '#0047AB',
    vars: {
      '--bg-app': '#08090c',
      '--bg-sidebar': '#0d0f14',
      '--bg-elevated': '#14171f',
      '--bg-input': '#181c26',
      '--border': '#1f242f',
      '--border-accent': '#2a3142',
      '--text-primary': '#e8ecf1',
      '--text-secondary': '#8a96aa',
      '--text-muted': '#5a647a',
      '--accent': '#3b82f6',
      '--accent-strong': '#60a5fa',
      '--danger': '#ef4444',
      '--warning': '#f59e0b',
      '--success': '#10b981',
    },
  },
];

const STORAGE_KEY = 'weaver:theme';

export function getThemeById(id: ThemeId): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function getActiveTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch {
    // ignore
  }
  return 'sage-dark';
}

export function applyTheme(id: ThemeId): void {
  const theme = getThemeById(id);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v);
  }
  root.setAttribute('data-theme', id);
  root.setAttribute('data-mode', theme.mode);
  if (theme.mode === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

/** Hook simple: aplica el tema activo al montar la app. */
export function initTheme(): void {
  applyTheme(getActiveTheme());
}
