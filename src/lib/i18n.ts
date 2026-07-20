/**
 * i18n — Internacionalización mínima para Weaver.
 *
 * Soporta ES e EN. La preferencia del usuario se persiste en
 * localStorage y se sincroniza con el store de Zustand.
 *
 * Las claves son rutas punteadas. Para añadir más traducciones,
 * extiende los diccionarios `dict.es` y `dict.en`.
 *
 * Uso:
 *   import { t } from '@/lib/i18n';
 *   const label = t('sidebar.newChat');
 *
 * Para componentes que necesitan re-renderizar al cambiar el idioma,
 * usar el hook:
 *   import { useT } from '@/lib/i18n';
 *   const t = useT();
 */

import { useSyncExternalStore } from 'react';

export type Lang = 'es' | 'en';

const LANG_KEY = 'weaver:lang';

// --- Diccionario ----------------------------------------------------------

type Dict = Record<string, string>;

const dict: Record<Lang, Dict> = {
  es: {
    // Sidebar
    'sidebar.newChat': 'Nuevo chat',
    'sidebar.search': 'Buscar',
    'sidebar.workspace': 'Workspace',
    'sidebar.me': 'ME',
    'sidebar.complementos': 'Complementos',
    'sidebar.schedules': 'Schedules',
    'sidebar.projects': 'Proyectos',
    'sidebar.noProject': 'Sin proyecto',
    'sidebar.empty': 'vacío',
    'sidebar.noConversations': 'Sin conversaciones',
    'sidebar.newProject': 'Nuevo proyecto',
    'sidebar.projectName': 'Nombre del proyecto',
    'sidebar.expand': 'Expandir sidebar',
    'sidebar.collapse': 'Colapsar',
    'sidebar.deleteProject': 'Eliminar proyecto',
    'sidebar.moveTo': 'Mover a',
    'sidebar.delete': 'Eliminar',
    'sidebar.configuracion': 'Configuración',
    'sidebar.searchPlaceholder': 'Buscar en chats…',
    'sidebar.searchEmpty': 'Sin resultados. Nota: chats antiguos pueden tener mensajes sin cargar.',
    'sidebar.searchTitleBadge': 'título',
    'sidebar.searchClose': 'Cerrar búsqueda',

    // TopBar
    'topbar.title': 'Weaver',

    // Search pane
    'search.placeholder': 'Buscar en chats…',

    // ME
    'me.title': 'ME',
    'me.subtitle': 'Calendario, tareas, notas y utilidades para facilitarte la vida.',

    // Complementos
    'complementos.title': 'Complementos',
    'complementos.subtitle': 'Servidores MCP y skills para extender al agente.',

    // Schedules
    'schedules.title': 'Schedules',
    'schedules.subtitle': 'Crea tareas que el agente ejecutará automáticamente en el horario que elijas.',
    'schedules.newTask': 'Nueva tarea',
    'schedules.empty': 'Aún no hay tareas programadas.',
    'schedules.emptyHint': 'Crea una con el botón Nueva tarea de arriba.',
    'schedules.active': 'Activa',
    'schedules.paused': 'Pausada',
    'schedules.lastRun': 'Última',
    'schedules.instruction': 'Instrucción',
    'schedules.pause': 'Pausar',
    'schedules.activate': 'Activar',
    'schedules.edit': 'Editar',
    'schedules.delete': 'Eliminar',
    'schedules.deleteConfirm': '¿Eliminar esta tarea programada?',
    'schedules.form.new': 'Nueva tarea programada',
    'schedules.form.edit': 'Editar tarea',
    'schedules.form.name': 'Nombre',
    'schedules.form.namePlaceholder': 'Ej: Organizar mis correos',
    'schedules.form.instruction': 'Instrucción para el agente',
    'schedules.form.instructionPlaceholder': 'Ej: organiza todos mis correos por carpeta según el remitente',
    'schedules.form.instructionHint': 'Puedes referenciar MCPs (@mcp:nombre) o herramientas del sistema. La instrucción se ejecuta como si la escribieras en el chat.',
    'schedules.form.time': 'Hora',
    'schedules.form.recurrence': 'Repetición',
    'schedules.form.weekday': 'Día de la semana',
    'schedules.form.monthDay': 'Día del mes',
    'schedules.form.cancel': 'Cancelar',
    'schedules.form.create': 'Crear tarea',
    'schedules.form.save': 'Guardar',
    'schedules.note': 'Nota',
    'schedules.noteText': 'el programador (cron) se ejecuta cuando Weaver está abierto. Al llegar la hora, se lanza la instrucción en un chat nuevo y el agente la procesa con las mismas herramientas que tendría a mano (MCPs, shell, archivos, web, ME calendario, etc.). Para tareas que necesiten correr 24/7 sin la app abierta, configura un cron del sistema que llame a weaver --run "instrucción".',
    'schedules.nextRun': 'Próxima',
    'schedules.recurrence.once': 'Una vez',
    'schedules.recurrence.daily': 'Diario',
    'schedules.recurrence.weekdays': 'Lunes a Viernes',
    'schedules.recurrence.weekly': 'Semanal',
    'schedules.recurrence.monthly': 'Mensual',
    'schedules.weekdays.0': 'Dom',
    'schedules.weekdays.1': 'Lun',
    'schedules.weekdays.2': 'Mar',
    'schedules.weekdays.3': 'Mié',
    'schedules.weekdays.4': 'Jue',
    'schedules.weekdays.5': 'Vie',
    'schedules.weekdays.6': 'Sáb',
    'schedules.todayAt': 'Hoy a las',
    'schedules.everyDayAt': 'Cada día a las',
    'schedules.weekdaysAt': 'Lun-Vie a las',
    'schedules.everyWeekAt': 'Cada',
    'schedules.everyMonthDayAt': 'El día',
    'schedules.ofEveryMonthAt': 'de cada mes a las',
    'schedules.at': 'a las',
    'schedules.nextIn': 'Próxima en',
    'schedules.now': 'Ahora',

    // Configuración
    'config.title': 'Configuración',
    'config.appearance': 'Apariencia',
    'config.theme': 'Tema',
    'config.language': 'Idioma',
    'config.language.es': 'Español',
    'config.language.en': 'English',
    'config.language.hint': 'Selecciona el idioma de la interfaz. Los prompts internos del agente y el contenido generado siguen en el idioma que les pidas.',
  },

  en: {
    // Sidebar
    'sidebar.newChat': 'New chat',
    'sidebar.search': 'Search',
    'sidebar.workspace': 'Workspace',
    'sidebar.me': 'ME',
    'sidebar.complementos': 'Add-ons',
    'sidebar.schedules': 'Schedules',
    'sidebar.projects': 'Projects',
    'sidebar.noProject': 'No project',
    'sidebar.empty': 'empty',
    'sidebar.noConversations': 'No conversations',
    'sidebar.newProject': 'New project',
    'sidebar.projectName': 'Project name',
    'sidebar.expand': 'Expand sidebar',
    'sidebar.collapse': 'Collapse',
    'sidebar.deleteProject': 'Delete project',
    'sidebar.moveTo': 'Move to',
    'sidebar.delete': 'Delete',
    'sidebar.configuracion': 'Settings',
    'sidebar.searchPlaceholder': 'Search chats…',
    'sidebar.searchEmpty': 'No results. Note: old chats may have messages not yet loaded.',
    'sidebar.searchTitleBadge': 'title',
    'sidebar.searchClose': 'Close search',

    // TopBar
    'topbar.title': 'Weaver',

    // Search pane
    'search.placeholder': 'Search chats…',

    // ME
    'me.title': 'ME',
    'me.subtitle': 'Calendar, tasks, notes, and utilities to make your life easier.',

    // Complementos
    'complementos.title': 'Add-ons',
    'complementos.subtitle': 'MCP servers and skills to extend the agent.',

    // Schedules
    'schedules.title': 'Schedules',
    'schedules.subtitle': 'Create tasks the agent will run automatically on the schedule you choose.',
    'schedules.newTask': 'New task',
    'schedules.empty': 'No scheduled tasks yet.',
    'schedules.emptyHint': 'Create one with the New task button above.',
    'schedules.active': 'Active',
    'schedules.paused': 'Paused',
    'schedules.lastRun': 'Last',
    'schedules.instruction': 'Instruction',
    'schedules.pause': 'Pause',
    'schedules.activate': 'Activate',
    'schedules.edit': 'Edit',
    'schedules.delete': 'Delete',
    'schedules.deleteConfirm': 'Delete this scheduled task?',
    'schedules.form.new': 'New scheduled task',
    'schedules.form.edit': 'Edit task',
    'schedules.form.name': 'Name',
    'schedules.form.namePlaceholder': 'E.g.: Organize my emails',
    'schedules.form.instruction': 'Instruction for the agent',
    'schedules.form.instructionPlaceholder': 'E.g.: organize all my emails by folder based on sender',
    'schedules.form.instructionHint': 'You can reference MCPs (@mcp:name) or system tools. The instruction runs as if you typed it in the chat.',
    'schedules.form.time': 'Time',
    'schedules.form.recurrence': 'Recurrence',
    'schedules.form.weekday': 'Day of the week',
    'schedules.form.monthDay': 'Day of the month',
    'schedules.form.cancel': 'Cancel',
    'schedules.form.create': 'Create task',
    'schedules.form.save': 'Save',
    'schedules.note': 'Note',
    'schedules.noteText': 'the scheduler (cron) runs while Weaver is open. At the scheduled time, the instruction is launched in a new chat and the agent processes it with the same tools it would have at hand (MCPs, shell, files, web, ME calendar, etc.). For tasks that need to run 24/7 without the app open, configure a system cron that calls weaver --run "instruction".',
    'schedules.nextRun': 'Next',
    'schedules.recurrence.once': 'Once',
    'schedules.recurrence.daily': 'Daily',
    'schedules.recurrence.weekdays': 'Mon to Fri',
    'schedules.recurrence.weekly': 'Weekly',
    'schedules.recurrence.monthly': 'Monthly',
    'schedules.weekdays.0': 'Sun',
    'schedules.weekdays.1': 'Mon',
    'schedules.weekdays.2': 'Tue',
    'schedules.weekdays.3': 'Wed',
    'schedules.weekdays.4': 'Thu',
    'schedules.weekdays.5': 'Fri',
    'schedules.weekdays.6': 'Sat',
    'schedules.todayAt': 'Today at',
    'schedules.everyDayAt': 'Every day at',
    'schedules.weekdaysAt': 'Mon-Fri at',
    'schedules.everyWeekAt': 'Every',
    'schedules.everyMonthDayAt': 'On day',
    'schedules.ofEveryMonthAt': 'of each month at',
    'schedules.at': 'at',
    'schedules.nextIn': 'Next in',
    'schedules.now': 'Now',

    // Settings
    'config.title': 'Settings',
    'config.appearance': 'Appearance',
    'config.theme': 'Theme',
    'config.language': 'Language',
    'config.language.es': 'Español',
    'config.language.en': 'English',
    'config.language.hint': 'Select the interface language. Agent internal prompts and generated content stay in whatever language you ask for.',
  },
};

// --- Estado externo -------------------------------------------------------

let currentLang: Lang = (() => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'es' || saved === 'en') return saved;
  } catch { /* ignore */ }
  // Detección por navegador.
  if (typeof navigator !== 'undefined') {
    const nav = (navigator.language || 'es').toLowerCase();
    if (nav.startsWith('en')) return 'en';
  }
  return 'es';
})();

const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang) {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch { /* ignore */ }
  // Actualizar <html lang>.
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
  }
  notify();
}

export function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// --- API pública ----------------------------------------------------------

/** Traduce una clave. Si no existe, devuelve la clave misma. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const d = dict[currentLang] ?? dict.es;
  let value = d[key] ?? dict.es[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return value;
}

/** Hook de React para que los componentes se re-rendericen al cambiar el idioma. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLang, getLang);
  return t;
}

/** Hook que devuelve el idioma actual y un setter. */
export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return [lang, setLang];
}

// Inicializar <html lang>.
if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLang;
}
