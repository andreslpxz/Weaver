/**
 * ME — Vista de "vida personal" en Weaver.
 *
 * Incluye:
 *  - Calendario editable visualmente (mes / semana / día)
 *  - Tareas / Notas
 *  - Clima (con caché)
 *  - Salud (mediciones: peso, sueño, hidratación, medicación)
 *  - Lista de la compra
 *
 * Toda la edición es en caliente (sin recargar). El store Zustand sincroniza
 * contra SQLite en Tauri y contra localStorage en navegador.
 */

import { useEffect, useMemo, useState, useRef } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, X, Pencil,
  Cloud, Droplets, Moon, Pill, Footprints, Heart, ShoppingCart,
  Check, ListTodo, StickyNote, Pin, Clock, MapPin, Tag, Eye, EyeOff,
} from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import { cn } from '@/components/common/Button';
import type {
  MeEvent, MeCalendar, MeTask, MeNote, MeHealth, MeShoppingItem,
} from '@/lib/tauri';

type SubTab = 'calendar' | 'tasks' | 'notes' | 'weather' | 'health' | 'shopping';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  // Lunes como primer día
  const dow = (d.getDay() + 6) % 7;
  return d.getTime() - dow * DAY_MS;
}
function startOfMonth(ts: number): number {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function fmtDate(ts: number, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(ts).toLocaleDateString('es-MX', opts ?? { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function fmtDateTimeLocal(ts: number): string {
  const d = new Date(ts);
  const off = d.getTimezoneOffset();
  return new Date(ts - off * 60 * 1000).toISOString().slice(0, 16);
}
function parseDateTimeLocal(s: string): number {
  return new Date(s).getTime();
}

const DEFAULT_COLORS = ['#7aa67a', '#6b8cff', '#d97757', '#c084fc', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'];

export function MeView() {
  const [tab, setTab] = useState<SubTab>('calendar');

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <CalendarDays size={20} className="text-accent" />
          <h1 className="text-lg font-semibold">ME</h1>
          <span className="text-xs text-text-muted">Tu vida, organizada</span>
        </div>
        <SubTabs tab={tab} setTab={setTab} />
      </header>
      <div className="flex-1 overflow-y-auto">
        {tab === 'calendar' && <CalendarModule />}
        {tab === 'tasks' && <TasksModule />}
        {tab === 'notes' && <NotesModule />}
        {tab === 'weather' && <WeatherModule />}
        {tab === 'health' && <HealthModule />}
        {tab === 'shopping' && <ShoppingModule />}
      </div>
    </div>
  );
}

// ============================================================================
// Pestañas
// ============================================================================

function SubTabs({ tab, setTab }: { tab: SubTab; setTab: (t: SubTab) => void }) {
  const tabs: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'calendar', label: 'Calendario', icon: <CalendarDays size={14} /> },
    { id: 'tasks', label: 'Tareas', icon: <ListTodo size={14} /> },
    { id: 'notes', label: 'Notas', icon: <StickyNote size={14} /> },
    { id: 'weather', label: 'Clima', icon: <Cloud size={14} /> },
    { id: 'health', label: 'Salud', icon: <Heart size={14} /> },
    { id: 'shopping', label: 'Compras', icon: <ShoppingCart size={14} /> },
  ];
  return (
    <div className="flex items-center gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-codex text-xs transition-colors',
            tab === t.id
              ? 'bg-app-elevated text-text-primary border border-border-accent'
              : 'text-text-secondary hover:text-text-primary hover:bg-app-elevated',
          )}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Calendario
// ============================================================================

type CalView = 'month' | 'week' | 'day';

function CalendarModule() {
  const {
    meEvents, meCalendars, upsertMeEvent, deleteMeEvent,
    upsertMeCalendar, deleteMeCalendar,
  } = useWeaver();

  const [calView, setCalView] = useState<CalView>('month');
  const [cursor, setCursor] = useState<number>(Date.now());
  const [editing, setEditing] = useState<MeEvent | null>(null);
  const [showCalMgr, setShowCalMgr] = useState(false);

  const visibleCals = useMemo(() => meCalendars.filter((c) => c.visible), [meCalendars]);
  const eventsByDay = useMemo(() => {
    const m = new Map<number, MeEvent[]>();
    for (const ev of meEvents) {
      if (!visibleCals.find((c) => c.id === ev.calendar_id)) continue;
      const start = startOfDay(ev.start_ts);
      for (let d = start; d <= ev.end_ts; d += DAY_MS) {
        const key = startOfDay(d);
        if (!m.has(key)) m.set(key, []);
        m.get(key)!.push(ev);
      }
    }
    return m;
  }, [meEvents, visibleCals]);

  function moveCursor(delta: number) {
    const d = new Date(cursor);
    if (calView === 'month') d.setMonth(d.getMonth() + delta);
    else if (calView === 'week') d.setTime(d.getTime() + delta * WEEK_MS);
    else d.setTime(d.getTime() + delta * DAY_MS);
    setCursor(d.getTime());
  }

  function handleCreateAt(startTs: number) {
    const id = crypto.randomUUID();
    const now = Date.now();
    const ev: MeEvent = {
      id, title: 'Nuevo evento', description: null, location: null,
      calendar_id: visibleCals[0]?.id ?? 'personal',
      start_ts: startTs, end_ts: startTs + 60 * 60 * 1000, all_day: false,
      color: null, recurrence: null, reminder_minutes: 15,
      created_at: now, updated_at: now,
    };
    upsertMeEvent(ev);
    setEditing(ev);
  }

  function handleDragEvent(ev: MeEvent, newStart: number) {
    const dur = ev.end_ts - ev.start_ts;
    upsertMeEvent({ ...ev, start_ts: newStart, end_ts: newStart + dur, updated_at: Date.now() });
  }

  function handleResizeEvent(ev: MeEvent, newEnd: number) {
    if (newEnd <= ev.start_ts) return;
    upsertMeEvent({ ...ev, end_ts: newEnd, updated_at: Date.now() });
  }

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => moveCursor(-1)} className="codex-icon-btn"><ChevronLeft size={16} /></button>
          <button onClick={() => setCursor(Date.now())} className="codex-btn text-xs px-3 py-1">Hoy</button>
          <button onClick={() => moveCursor(1)} className="codex-icon-btn"><ChevronRight size={16} /></button>
          <div className="ml-3 text-sm font-medium">
            {calView === 'month' && new Date(cursor).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
            {calView === 'week' && `${fmtDate(startOfWeek(cursor))} – ${fmtDate(startOfWeek(cursor) + 6 * DAY_MS)}`}
            {calView === 'day' && fmtDate(cursor, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-app-elevated rounded-codex p-0.5">
            {(['month', 'week', 'day'] as CalView[]).map((v) => (
              <button
                key={v}
                onClick={() => setCalView(v)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-codex transition-colors',
                  calView === v ? 'bg-app-input text-text-primary' : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {v === 'month' ? 'Mes' : v === 'week' ? 'Semana' : 'Día'}
              </button>
            ))}
          </div>
          <button onClick={() => setShowCalMgr((v) => !v)} className="codex-icon-btn" title="Gestionar calendarios">
            <Tag size={14} />
          </button>
        </div>
      </div>

      {/* Leyenda de calendarios */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {meCalendars.map((c) => (
          <button
            key={c.id}
            onClick={() => upsertMeCalendar({ ...c, visible: !c.visible })}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-codex text-xs border border-border hover:bg-app-elevated"
            title={c.visible ? 'Ocultar' : 'Mostrar'}
          >
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.color, opacity: c.visible ? 1 : 0.3 }} />
            <span className={c.visible ? '' : 'line-through opacity-60'}>{c.name}</span>
            {c.visible ? <Eye size={10} /> : <EyeOff size={10} />}
          </button>
        ))}
      </div>

      {/* Gestor de calendarios */}
      {showCalMgr && (
        <CalManager
          calendars={meCalendars}
          onSave={upsertMeCalendar}
          onDelete={deleteMeCalendar}
          onClose={() => setShowCalMgr(false)}
        />
      )}

      {/* Grid */}
      {calView === 'month' && (
        <MonthGrid
          cursor={cursor}
          eventsByDay={eventsByDay}
          calendars={meCalendars}
          onCreate={handleCreateAt}
          onEventClick={(ev) => setEditing(ev)}
          onEventDrag={handleDragEvent}
        />
      )}
      {calView === 'week' && (
        <WeekGrid
          cursor={cursor}
          events={meEvents.filter((e) => visibleCals.find((c) => c.id === e.calendar_id))}
          calendars={meCalendars}
          onCreate={handleCreateAt}
          onEventClick={(ev) => setEditing(ev)}
          onEventDrag={handleDragEvent}
          onEventResize={handleResizeEvent}
        />
      )}
      {calView === 'day' && (
        <DayGrid
          cursor={cursor}
          events={meEvents.filter((e) => visibleCals.find((c) => c.id === e.calendar_id))}
          calendars={meCalendars}
          onCreate={handleCreateAt}
          onEventClick={(ev) => setEditing(ev)}
          onEventDrag={handleDragEvent}
          onEventResize={handleResizeEvent}
        />
      )}

      {/* Modal de edición */}
      {editing && (
        <EventEditor
          event={editing}
          calendars={meCalendars}
          onChange={(ev) => {
            setEditing(ev);
            upsertMeEvent(ev);
          }}
          onClose={() => setEditing(null)}
          onDelete={() => {
            if (confirm('¿Eliminar evento?')) {
              deleteMeEvent(editing.id);
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

function MonthGrid({
  cursor, eventsByDay, calendars, onCreate, onEventClick, onEventDrag,
}: {
  cursor: number;
  eventsByDay: Map<number, MeEvent[]>;
  calendars: MeCalendar[];
  onCreate: (startTs: number) => void;
  onEventClick: (ev: MeEvent) => void;
  onEventDrag: (ev: MeEvent, newStart: number) => void;
}) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const days: number[] = [];
  for (let i = 0; i < 42; i++) days.push(gridStart + i * DAY_MS);

  const today = startOfDay(Date.now());
  const dragRef = useRef<{ ev: MeEvent; offset: number } | null>(null);

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
          <div key={d} className="text-center text-[10px] uppercase text-text-muted py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const inMonth = new Date(day).getMonth() === new Date(cursor).getMonth();
          const isToday = day === today;
          const evs = eventsByDay.get(day) ?? [];
          return (
            <div
              key={day}
              onClick={() => onCreate(day + 9 * 60 * 60 * 1000)}
              className={cn(
                'min-h-[88px] rounded-codex border p-1 cursor-pointer transition-colors',
                'border-border hover:border-border-accent hover:bg-app-elevated',
                !inMonth && 'opacity-40',
                isToday && 'border-accent bg-accent/5',
              )}
            >
              <div className={cn('text-[10px] mb-0.5', isToday ? 'text-accent font-bold' : 'text-text-muted')}>
                {new Date(day).getDate()}
              </div>
              <div className="space-y-0.5">
                {evs.slice(0, 3).map((ev) => {
                  const cal = calendars.find((c) => c.id === ev.calendar_id);
                  return (
                    <div
                      key={ev.id}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        dragRef.current = { ev, offset: ev.start_ts - day };
                      }}
                      onDragEnd={(e) => {
                        e.stopPropagation();
                        dragRef.current = null;
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEventClick(ev);
                      }}
                      className="text-[10px] px-1 py-0.5 rounded truncate cursor-pointer hover:opacity-80"
                      style={{
                        background: (ev.color ?? cal?.color ?? '#7aa67a') + '22',
                        color: ev.color ?? cal?.color ?? '#7aa67a',
                        borderLeft: `2px solid ${ev.color ?? cal?.color ?? '#7aa67a'}`,
                      }}
                      title={`${ev.title} · ${fmtTime(ev.start_ts)}`}
                    >
                      {!ev.all_day && <span className="opacity-70">{fmtTime(ev.start_ts)} </span>}
                      {ev.title}
                    </div>
                  );
                })}
                {evs.length > 3 && (
                  <div className="text-[10px] text-text-muted px-1">+{evs.length - 3} más</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* Drop zone invisible para drag entre días */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!dragRef.current) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          const dayIdx = Math.floor((x / rect.width) * 7);
          const targetDay = startOfWeek(monthStart) + dayIdx * DAY_MS;
          onEventDrag(dragRef.current.ev, targetDay + dragRef.current.offset);
          dragRef.current = null;
        }}
        className="sr-only"
      />
    </div>
  );
}

function WeekGrid({
  cursor, events, calendars, onCreate, onEventClick, onEventDrag, onEventResize,
}: {
  cursor: number;
  events: MeEvent[];
  calendars: MeCalendar[];
  onCreate: (startTs: number) => void;
  onEventClick: (ev: MeEvent) => void;
  onEventDrag: (ev: MeEvent, newStart: number) => void;
  onEventResize: (ev: MeEvent, newEnd: number) => void;
}) {
  const weekStart = startOfWeek(cursor);
  const days: number[] = [];
  for (let i = 0; i < 7; i++) days.push(weekStart + i * DAY_MS);
  const HOURS = 24;
  const HOUR_H = 44;

  const dragRef = useRef<{ ev: MeEvent; offsetMin: number } | null>(null);
  const resizeRef = useRef<{ ev: MeEvent } | null>(null);

  function yToTime(day: number, y: number): number {
    const minutes = Math.floor((y / HOUR_H) * 60);
    return day + minutes * 60 * 1000;
  }

  return (
    <div className="flex">
      <div className="w-12 shrink-0">
        <div className="h-8" />
        {Array.from({ length: HOURS }, (_, h) => (
          <div key={h} style={{ height: HOUR_H }} className="text-[9px] text-text-muted text-right pr-1 -mt-1">
            {h === 0 ? '' : `${h}:00`}
          </div>
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7 gap-1 relative">
        {days.map((day) => {
          const isToday = startOfDay(day) === startOfDay(Date.now());
          return (
            <div key={day} className="border-l border-border">
              <div className={cn('h-8 text-center text-xs py-1.5', isToday && 'text-accent font-bold')}>
                {new Date(day).toLocaleDateString('es-MX', { weekday: 'short' })}
                <span className="ml-1 opacity-60">{new Date(day).getDate()}</span>
              </div>
              <div
                className="relative cursor-crosshair"
                style={{ height: HOURS * HOUR_H }}
                onClick={(e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  onCreate(yToTime(day, y));
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragRef.current) return;
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const y = e.clientY - rect.top;
                  const newStart = yToTime(day, y) - dragRef.current.offsetMin * 60 * 1000;
                  onEventDrag(dragRef.current.ev, newStart);
                  dragRef.current = null;
                }}
              >
                {/* Eventos */}
                {events
                  .filter((ev) => startOfDay(ev.start_ts) === startOfDay(day) || startOfDay(ev.end_ts) === startOfDay(day) || (ev.start_ts <= day && ev.end_ts >= day + DAY_MS))
                  .map((ev) => {
                    const cal = calendars.find((c) => c.id === ev.calendar_id);
                    const evStart = Math.max(ev.start_ts, day);
                    const evEnd = Math.min(ev.end_ts, day + DAY_MS);
                    const top = ((evStart - day) / DAY_MS) * (HOUR_H * HOURS);
                    const height = Math.max(20, ((evEnd - evStart) / DAY_MS) * (HOUR_H * HOURS));
                    return (
                      <div
                        key={ev.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(ev);
                        }}
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const y = e.clientY - rect.top;
                          dragRef.current = { ev, offsetMin: Math.floor((y / height) * ((evEnd - evStart) / 60000)) };
                        }}
                        onDragEnd={(e) => { e.stopPropagation(); dragRef.current = null; }}
                        className="absolute left-0.5 right-0.5 rounded p-1 text-[10px] cursor-move overflow-hidden"
                        style={{
                          top, height,
                          background: (ev.color ?? cal?.color ?? '#7aa67a') + '22',
                          color: ev.color ?? cal?.color ?? '#7aa67a',
                          borderLeft: `2px solid ${ev.color ?? cal?.color ?? '#7aa67a'}`,
                        }}
                      >
                        <div className="font-medium truncate">{ev.title}</div>
                        <div className="opacity-70">{fmtTime(evStart)} – {fmtTime(evEnd)}</div>
                        {/* Resize handle */}
                        <div
                          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            resizeRef.current = { ev };
                          }}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
      {/* Global mouse move for resize */}
      <ResizeListener
        onResize={(dy) => {
          if (!resizeRef.current) return;
          const mins = Math.round((dy / HOUR_H) * 60);
          onEventResize(resizeRef.current.ev, resizeRef.current.ev.end_ts + mins * 60 * 1000);
        }}
        onEnd={() => { resizeRef.current = null; }}
      />
    </div>
  );
}

function DayGrid({
  cursor, events, calendars, onCreate, onEventClick, onEventDrag, onEventResize,
}: {
  cursor: number;
  events: MeEvent[];
  calendars: MeCalendar[];
  onCreate: (startTs: number) => void;
  onEventClick: (ev: MeEvent) => void;
  onEventDrag: (ev: MeEvent, newStart: number) => void;
  onEventResize: (ev: MeEvent, newEnd: number) => void;
}) {
  const day = startOfDay(cursor);
  const HOURS = 24;
  const HOUR_H = 56;
  const dragRef = useRef<{ ev: MeEvent; offsetMin: number } | null>(null);
  const resizeRef = useRef<{ ev: MeEvent } | null>(null);

  return (
    <div className="flex max-w-3xl mx-auto">
      <div className="w-14 shrink-0">
        <div className="h-8" />
        {Array.from({ length: HOURS }, (_, h) => (
          <div key={h} style={{ height: HOUR_H }} className="text-[10px] text-text-muted text-right pr-2 -mt-1">
            {h === 0 ? '' : `${h}:00`}
          </div>
        ))}
      </div>
      <div className="flex-1 border-l border-border">
        <div className="h-8 px-2 text-sm font-medium">
          {new Date(day).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>
        <div
          className="relative cursor-crosshair"
          style={{ height: HOURS * HOUR_H }}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const y = e.clientY - rect.top;
            onCreate(day + Math.floor((y / HOUR_H) * 60) * 60 * 1000);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!dragRef.current) return;
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const y = e.clientY - rect.top;
            const newStart = day + Math.floor((y / HOUR_H) * 60) * 60 * 1000 - dragRef.current.offsetMin * 60 * 1000;
            onEventDrag(dragRef.current.ev, newStart);
            dragRef.current = null;
          }}
        >
          {events
            .filter((ev) => ev.start_ts >= day && ev.start_ts < day + DAY_MS)
            .map((ev) => {
              const cal = calendars.find((c) => c.id === ev.calendar_id);
              const top = ((ev.start_ts - day) / DAY_MS) * (HOUR_H * HOURS);
              const height = Math.max(28, ((ev.end_ts - ev.start_ts) / DAY_MS) * (HOUR_H * HOURS));
              return (
                <div
                  key={ev.id}
                  onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    dragRef.current = { ev, offsetMin: Math.floor((y / height) * ((ev.end_ts - ev.start_ts) / 60000)) };
                  }}
                  onDragEnd={(e) => { e.stopPropagation(); dragRef.current = null; }}
                  className="absolute left-1 right-1 rounded p-1.5 text-xs cursor-move overflow-hidden"
                  style={{
                    top, height,
                    background: (ev.color ?? cal?.color ?? '#7aa67a') + '22',
                    color: ev.color ?? cal?.color ?? '#7aa67a',
                    borderLeft: `3px solid ${ev.color ?? cal?.color ?? '#7aa67a'}`,
                  }}
                >
                  <div className="font-medium truncate">{ev.title}</div>
                  <div className="opacity-70 text-[10px]">{fmtTime(ev.start_ts)} – {fmtTime(ev.end_ts)}</div>
                  {ev.location && <div className="opacity-60 text-[10px] flex items-center gap-0.5"><MapPin size={8} /> {ev.location}</div>}
                  <div
                    className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
                    onMouseDown={(e) => { e.stopPropagation(); resizeRef.current = { ev }; }}
                  />
                </div>
              );
            })}
        </div>
      </div>
      <ResizeListener
        onResize={(dy) => {
          if (!resizeRef.current) return;
          const mins = Math.round((dy / HOUR_H) * 60);
          onEventResize(resizeRef.current.ev, resizeRef.current.ev.end_ts + mins * 60 * 1000);
        }}
        onEnd={() => { resizeRef.current = null; }}
      />
    </div>
  );
}

function ResizeListener({ onResize, onEnd }: { onResize: (dy: number) => void; onEnd: () => void }) {
  const lastY = useRef<number | null>(null);
  useEffect(() => {
    function move(e: MouseEvent) {
      if (lastY.current !== null) {
        onResize(e.clientY - lastY.current);
      }
      lastY.current = e.clientY;
    }
    function up() {
      lastY.current = null;
      onEnd();
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [onResize, onEnd]);
  return null;
}

function EventEditor({
  event, calendars, onChange, onClose, onDelete,
}: {
  event: MeEvent;
  calendars: MeCalendar[];
  onChange: (ev: MeEvent) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [local, setLocal] = useState<MeEvent>(event);
  useEffect(() => setLocal(event), [event.id]);

  function update(patch: Partial<MeEvent>) {
    const next = { ...local, ...patch, updated_at: Date.now() };
    setLocal(next);
    onChange(next);
  }

  const cal = calendars.find((c) => c.id === local.calendar_id);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-app-bg border border-border-accent rounded-codex shadow-2xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ background: local.color ?? cal?.color ?? '#7aa67a' }} />
            <h2 className="text-sm font-semibold">Editar evento</h2>
          </div>
          <button onClick={onClose} className="codex-icon-btn"><X size={14} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase text-text-muted">Título</label>
            <input
              autoFocus
              value={local.title}
              onChange={(e) => update({ title: e.target.value })}
              className="codex-input w-full mt-0.5 px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-muted">Calendario</label>
            <select
              value={local.calendar_id}
              onChange={(e) => update({ calendar_id: e.target.value })}
              className="codex-input w-full mt-0.5 px-2 py-1.5 text-sm"
            >
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase text-text-muted">Inicio</label>
              <input
                type="datetime-local"
                value={fmtDateTimeLocal(local.start_ts)}
                onChange={(e) => {
                  const ts = parseDateTimeLocal(e.target.value);
                  if (!isNaN(ts)) update({ start_ts: ts, end_ts: Math.max(ts + 30 * 60 * 1000, local.end_ts) });
                }}
                className="codex-input w-full mt-0.5 px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-text-muted">Fin</label>
              <input
                type="datetime-local"
                value={fmtDateTimeLocal(local.end_ts)}
                onChange={(e) => {
                  const ts = parseDateTimeLocal(e.target.value);
                  if (!isNaN(ts) && ts > local.start_ts) update({ end_ts: ts });
                }}
                className="codex-input w-full mt-0.5 px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={local.all_day}
              onChange={(e) => update({ all_day: e.target.checked })}
            />
            Todo el día
          </label>

          <div>
            <label className="text-[10px] uppercase text-text-muted">Ubicación</label>
            <input
              value={local.location ?? ''}
              onChange={(e) => update({ location: e.target.value || null })}
              placeholder="Dirección o lugar"
              className="codex-input w-full mt-0.5 px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-muted">Descripción</label>
            <textarea
              value={local.description ?? ''}
              onChange={(e) => update({ description: e.target.value || null })}
              rows={3}
              className="codex-input w-full mt-0.5 px-2 py-1.5 text-sm resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase text-text-muted">Recordar</label>
              <select
                value={local.reminder_minutes ?? 0}
                onChange={(e) => update({ reminder_minutes: Number(e.target.value) })}
                className="codex-input w-full mt-0.5 px-2 py-1.5 text-sm"
              >
                <option value={0}>Sin aviso</option>
                <option value={5}>5 min antes</option>
                <option value={15}>15 min antes</option>
                <option value={30}>30 min antes</option>
                <option value={60}>1 h antes</option>
                <option value={1440}>1 día antes</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-text-muted">Repetir</label>
              <select
                value={local.recurrence ?? 'none'}
                onChange={(e) => update({ recurrence: e.target.value === 'none' ? null : e.target.value })}
                className="codex-input w-full mt-0.5 px-2 py-1.5 text-sm"
              >
                <option value="none">No repetir</option>
                <option value="daily">Diario</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensual</option>
                <option value="yearly">Anual</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase text-text-muted">Color</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => update({ color: c })}
                  className={cn('w-5 h-5 rounded-sm border', local.color === c ? 'border-text-primary ring-1 ring-accent' : 'border-border')}
                  style={{ background: c }}
                />
              ))}
              <button
                onClick={() => update({ color: null })}
                className={cn('w-5 h-5 rounded-sm border text-[8px] flex items-center justify-center', local.color === null ? 'border-text-primary ring-1 ring-accent' : 'border-border')}
                title="Usar color del calendario"
              >
                A
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mt-5 pt-3 border-t border-border">
          <button onClick={onDelete} className="codex-btn text-xs text-danger flex items-center gap-1">
            <Trash2 size={12} /> Eliminar
          </button>
          <button onClick={onClose} className="codex-btn codex-btn-primary text-xs px-3 py-1.5">Listo</button>
        </div>
      </div>
    </div>
  );
}

function CalManager({
  calendars, onSave, onDelete, onClose,
}: {
  calendars: MeCalendar[];
  onSave: (c: MeCalendar) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_COLORS[0]);

  return (
    <div className="mb-4 p-3 rounded-codex border border-border bg-app-elevated">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium">Calendarios</div>
        <button onClick={onClose} className="codex-icon-btn"><X size={12} /></button>
      </div>
      <div className="space-y-1 mb-2">
        {calendars.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-xs">
            <span className="w-3 h-3 rounded-sm" style={{ background: c.color }} />
            <span className="flex-1">{c.name}</span>
            <button
              onClick={() => {
                if (calendars.length === 1) return;
                if (confirm(`¿Eliminar calendario "${c.name}"? Los eventos no se borrarán pero perderán su categoría.`)) {
                  onDelete(c.id);
                }
              }}
              className="codex-icon-btn"
              title="Eliminar"
            >
              <Trash2 size={10} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nuevo calendario"
          className="codex-input flex-1 px-2 py-1 text-xs"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              onSave({
                id: crypto.randomUUID(),
                name: name.trim(),
                color,
                visible: true,
                created_at: Date.now(),
              });
              setName('');
            }
          }}
        />
        <div className="flex">
          {DEFAULT_COLORS.slice(0, 5).map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn('w-5 h-5 rounded-sm border', color === c ? 'ring-1 ring-accent' : '')}
              style={{ background: c }}
            />
          ))}
        </div>
        <button
          onClick={() => {
            if (!name.trim()) return;
            onSave({
              id: crypto.randomUUID(),
              name: name.trim(),
              color,
              visible: true,
              created_at: Date.now(),
            });
            setName('');
          }}
          className="codex-btn codex-btn-primary text-xs px-2 py-1"
        >
          <Plus size={10} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Tareas
// ============================================================================

function TasksModule() {
  const { meTasks, upsertMeTask, deleteMeTask } = useWeaver();
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'done'>('all');

  const lists = useMemo(() => {
    const m = new Map<string, MeTask[]>();
    for (const t of meTasks) {
      if (!m.has(t.list_id)) m.set(t.list_id, []);
      m.get(t.list_id)!.push(t);
    }
    return m;
  }, [meTasks]);

  function addTask() {
    if (!newTitle.trim()) return;
    const t: MeTask = {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      notes: null,
      priority: 0,
      done: false,
      due_ts: null,
      list_id: 'inbox',
      created_at: Date.now(),
      completed_at: null,
    };
    upsertMeTask(t);
    setNewTitle('');
  }

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTask(); }}
          placeholder="Añadir tarea..."
          className="codex-input flex-1 px-3 py-2 text-sm"
        />
        <button onClick={addTask} className="codex-btn codex-btn-primary text-xs px-3 py-2 flex items-center gap-1">
          <Plus size={12} /> Añadir
        </button>
      </div>

      <div className="flex gap-1 mb-3">
        {(['all', 'pending', 'done'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2.5 py-1 rounded-codex text-xs',
              filter === f ? 'bg-app-elevated border border-border-accent' : 'text-text-secondary hover:bg-app-elevated',
            )}
          >
            {f === 'all' ? 'Todas' : f === 'pending' ? 'Pendientes' : 'Hechas'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {Array.from(lists.entries()).map(([listId, items]) => {
          const filtered = items.filter((t) => filter === 'all' || (filter === 'pending' ? !t.done : t.done));
          if (filtered.length === 0) return null;
          return (
            <div key={listId}>
              <div className="text-[10px] uppercase text-text-muted mb-1.5 px-1">
                {listId === 'inbox' ? 'Bandeja' : listId}
              </div>
              <div className="space-y-1">
                {filtered.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    onToggle={() => upsertMeTask({ ...t, done: !t.done, completed_at: !t.done ? Date.now() : null })}
                    onPriority={() => upsertMeTask({ ...t, priority: (t.priority + 1) % 3 })}
                    onChangeTitle={(title) => upsertMeTask({ ...t, title })}
                    onSetDue={(due_ts) => upsertMeTask({ ...t, due_ts })}
                    onDelete={() => deleteMeTask(t.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {meTasks.length === 0 && (
          <div className="text-center py-12 text-text-muted text-sm">
            <ListTodo size={32} className="mx-auto mb-2 opacity-50" />
            Sin tareas. Añade la primera arriba.
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({
  task, onToggle, onPriority, onChangeTitle, onSetDue, onDelete,
}: {
  task: MeTask;
  onToggle: () => void;
  onPriority: () => void;
  onChangeTitle: (title: string) => void;
  onSetDue: (due_ts: number | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const priorityColors = ['text-text-muted', 'text-warning', 'text-danger'];
  const priorityLabels = ['Sin prioridad', 'Media', 'Alta'];

  return (
    <div className={cn(
      'group flex items-center gap-2 px-2 py-1.5 rounded-codex border border-transparent hover:border-border hover:bg-app-elevated',
      task.done && 'opacity-50',
    )}>
      <button
        onClick={onToggle}
        className={cn(
          'w-4 h-4 rounded border flex items-center justify-center shrink-0',
          task.done ? 'bg-success border-success' : 'border-border-accent hover:border-accent',
        )}
      >
        {task.done && <Check size={10} className="text-white" />}
      </button>
      <button
        onClick={onPriority}
        className={cn('text-xs shrink-0', priorityColors[task.priority])}
        title={priorityLabels[task.priority]}
      >
        {'▲'.repeat(task.priority) || '·'}
      </button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onChangeTitle(draft); setEditing(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { onChangeTitle(draft); setEditing(false); } }}
          className="codex-input flex-1 px-2 py-0.5 text-sm"
        />
      ) : (
        <span
          onDoubleClick={() => { setDraft(task.title); setEditing(true); }}
          className={cn('flex-1 text-sm truncate', task.done && 'line-through')}
        >
          {task.title}
        </span>
      )}
      {task.due_ts && (
        <span className="text-[10px] text-text-muted flex items-center gap-0.5">
          <Clock size={9} /> {fmtDate(task.due_ts, { day: 'numeric', month: 'short' })}
        </span>
      )}
      <input
        type="date"
        value={task.due_ts ? new Date(task.due_ts).toISOString().slice(0, 10) : ''}
        onChange={(e) => onSetDue(e.target.value ? new Date(e.target.value).getTime() : null)}
        className="opacity-0 group-hover:opacity-100 text-[10px] bg-transparent border-0 cursor-pointer"
        title="Fecha límite"
      />
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 codex-icon-btn w-5 h-5"
        title="Eliminar"
      >
        <Trash2 size={10} />
      </button>
    </div>
  );
}

// ============================================================================
// Notas
// ============================================================================

function NotesModule() {
  const { meNotes, upsertMeNote, deleteMeNote } = useWeaver();
  const [editing, setEditing] = useState<MeNote | null>(null);

  function createNote() {
    const n: MeNote = {
      id: crypto.randomUUID(),
      title: null,
      body: '',
      color: DEFAULT_COLORS[Math.floor(Math.random() * 5)],
      tags_json: null,
      pinned: false,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    upsertMeNote(n);
    setEditing(n);
  }

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-text-muted">{meNotes.length} nota(s)</div>
        <button onClick={createNote} className="codex-btn codex-btn-primary text-xs px-3 py-1.5 flex items-center gap-1">
          <Plus size={12} /> Nueva nota
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {meNotes
          .slice()
          .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at)
          .map((n) => (
            <button
              key={n.id}
              onClick={() => setEditing(n)}
              className={cn(
                'text-left p-3 rounded-codex border min-h-[120px] flex flex-col',
                'hover:border-border-accent transition-colors',
              )}
              style={{
                background: (n.color ?? '#7aa67a') + '11',
                borderColor: (n.color ?? '#7aa67a') + '33',
              }}
            >
              <div className="flex items-center justify-between mb-1">
                {n.pinned && <Pin size={10} className="text-accent" />}
                <span className="text-[9px] text-text-muted ml-auto">{fmtDate(n.updated_at, { day: 'numeric', month: 'short' })}</span>
              </div>
              {n.title && <div className="font-medium text-sm mb-1 truncate">{n.title}</div>}
              <div className="text-xs text-text-secondary line-clamp-6 whitespace-pre-wrap flex-1">{n.body || '(vacía)'}</div>
            </button>
          ))}
      </div>

      {meNotes.length === 0 && (
        <div className="text-center py-12 text-text-muted text-sm">
          <StickyNote size={32} className="mx-auto mb-2 opacity-50" />
          Sin notas. Crea la primera.
        </div>
      )}

      {editing && (
        <NoteEditor
          note={editing}
          onChange={(n) => { setEditing(n); upsertMeNote(n); }}
          onClose={() => setEditing(null)}
          onDelete={() => { deleteMeNote(editing.id); setEditing(null); }}
        />
      )}
    </div>
  );
}

function NoteEditor({
  note, onChange, onClose, onDelete,
}: {
  note: MeNote;
  onChange: (n: MeNote) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-app-bg border border-border-accent rounded-codex shadow-2xl w-full max-w-lg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onChange({ ...note, pinned: !note.pinned, updated_at: Date.now() })}
              className={cn('codex-icon-btn', note.pinned && 'text-accent')}
              title={note.pinned ? 'Desfijar' : 'Fijar'}
            >
              <Pin size={14} />
            </button>
            <h2 className="text-sm font-semibold">Nota</h2>
          </div>
          <button onClick={onClose} className="codex-icon-btn"><X size={14} /></button>
        </div>
        <input
          value={note.title ?? ''}
          onChange={(e) => onChange({ ...note, title: e.target.value || null, updated_at: Date.now() })}
          placeholder="Título"
          className="codex-input w-full px-2 py-1.5 text-sm mb-2 font-medium"
        />
        <textarea
          value={note.body}
          onChange={(e) => onChange({ ...note, body: e.target.value, updated_at: Date.now() })}
          placeholder="Escribe..."
          rows={12}
          autoFocus
          className="codex-input w-full px-2 py-1.5 text-sm resize-none"
        />
        <div className="flex items-center justify-between mt-3">
          <div className="flex gap-1">
            {DEFAULT_COLORS.slice(0, 6).map((c) => (
              <button
                key={c}
                onClick={() => onChange({ ...note, color: c, updated_at: Date.now() })}
                className={cn('w-5 h-5 rounded-sm border', note.color === c ? 'ring-1 ring-accent' : 'border-border')}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={onDelete} className="codex-btn text-xs text-danger flex items-center gap-1">
              <Trash2 size={12} /> Eliminar
            </button>
            <button onClick={onClose} className="codex-btn codex-btn-primary text-xs px-3 py-1.5">Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Clima
// ============================================================================

interface WeatherData {
  location: string;
  temp: number;
  feels_like: number;
  description: string;
  icon: string;
  humidity: number;
  wind: number;
  forecast: Array<{ date: number; temp_max: number; temp_min: number; description: string; icon: string }>;
}

const WEATHER_ICONS: Record<string, React.ReactNode> = {
  '01d': '☀️', '02d': '⛅', '03d': '☁️', '04d': '☁️',
  '09d': '🌧️', '10d': '🌦️', '11d': '⛈️', '13d': '❄️', '50d': '🌫️',
};

function WeatherModule() {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState('Ciudad de México');

  async function fetchWeather(loc: string) {
    setLoading(true);
    setError(null);
    try {
      // Open-Meteo: gratis, sin API key
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(loc)}&count=1&language=es&format=json`);
      const geo = await geoRes.json();
      if (!geo.results || geo.results.length === 0) {
        throw new Error('No se encontró la ubicación');
      }
      const { latitude, longitude, name, country } = geo.results[0];
      const weatherRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`,
      );
      const w = await weatherRes.json();
      const codeMap: Record<number, { desc: string; icon: string }> = {
        0: { desc: 'Despejado', icon: '01d' },
        1: { desc: 'Mayormente despejado', icon: '02d' },
        2: { desc: 'Parcialmente nublado', icon: '03d' },
        3: { desc: 'Nublado', icon: '04d' },
        45: { desc: 'Niebla', icon: '50d' },
        48: { desc: 'Niebla helada', icon: '50d' },
        51: { desc: 'Llovizna ligera', icon: '09d' },
        53: { desc: 'Llovizna', icon: '09d' },
        55: { desc: 'Llovizna fuerte', icon: '09d' },
        61: { desc: 'Lluvia ligera', icon: '10d' },
        63: { desc: 'Lluvia', icon: '10d' },
        65: { desc: 'Lluvia fuerte', icon: '10d' },
        71: { desc: 'Nieve ligera', icon: '13d' },
        73: { desc: 'Nieve', icon: '13d' },
        75: { desc: 'Nieve fuerte', icon: '13d' },
        80: { desc: 'Chubascos', icon: '09d' },
        81: { desc: 'Chubascos fuertes', icon: '09d' },
        82: { desc: 'Chubascos violentos', icon: '09d' },
        95: { desc: 'Tormenta', icon: '11d' },
        96: { desc: 'Tormenta con granizo', icon: '11d' },
        99: { desc: 'Tormenta severa', icon: '11d' },
      };
      const cur = codeMap[w.current.weather_code] ?? { desc: 'Desconocido', icon: '03d' };
      setData({
        location: `${name}, ${country}`,
        temp: Math.round(w.current.temperature_2m),
        feels_like: Math.round(w.current.apparent_temperature),
        description: cur.desc,
        icon: cur.icon,
        humidity: w.current.relative_humidity_2m,
        wind: Math.round(w.current.wind_speed_10m),
        forecast: w.daily.time.slice(0, 7).map((t: string, i: number) => {
          const fc = codeMap[w.daily.weather_code[i]] ?? { desc: '—', icon: '03d' };
          return {
            date: new Date(t).getTime(),
            temp_max: Math.round(w.daily.temperature_2m_max[i]),
            temp_min: Math.round(w.daily.temperature_2m_min[i]),
            description: fc.desc,
            icon: fc.icon,
          };
        }),
      });
    } catch (e: any) {
      setError(e.message ?? 'Error al obtener el clima');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchWeather(location);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto">
      <form
        onSubmit={(e) => { e.preventDefault(); fetchWeather(location); }}
        className="flex items-center gap-2 mb-5"
      >
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Ciudad..."
          className="codex-input flex-1 px-3 py-2 text-sm"
        />
        <button type="submit" disabled={loading} className="codex-btn codex-btn-primary text-xs px-3 py-2">
          {loading ? 'Cargando…' : 'Buscar'}
        </button>
      </form>

      {error && (
        <div className="p-3 rounded-codex bg-danger/10 text-danger text-sm mb-3">{error}</div>
      )}

      {data && !loading && (
        <>
          {/* Actual */}
          <div className="p-5 rounded-codex border border-border bg-app-elevated mb-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-text-muted flex items-center gap-1">
                  <MapPin size={10} /> {data.location}
                </div>
                <div className="text-5xl font-light mt-1">{data.temp}°</div>
                <div className="text-sm text-text-secondary">{data.description}</div>
                <div className="text-xs text-text-muted mt-1">Sensación {data.feels_like}°</div>
              </div>
              <div className="text-6xl">{WEATHER_ICONS[data.icon]}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-border">
              <div className="flex items-center gap-2 text-xs">
                <Droplets size={14} className="text-accent" /> Humedad: {data.humidity}%
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Cloud size={14} className="text-accent" /> Viento: {data.wind} km/h
              </div>
            </div>
          </div>

          {/* Forecast */}
          <div className="grid grid-cols-7 gap-1">
            {data.forecast.map((f, i) => (
              <div key={i} className="p-2 rounded-codex border border-border text-center">
                <div className="text-[10px] text-text-muted uppercase">
                  {i === 0 ? 'Hoy' : new Date(f.date).toLocaleDateString('es-MX', { weekday: 'short' })}
                </div>
                <div className="text-2xl my-1">{WEATHER_ICONS[f.icon]}</div>
                <div className="text-xs font-medium">{f.temp_max}°</div>
                <div className="text-[10px] text-text-muted">{f.temp_min}°</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Salud
// ============================================================================

const HEALTH_KINDS = [
  { id: 'weight', label: 'Peso', icon: <Footprints size={14} />, unit: 'kg' },
  { id: 'sleep', label: 'Sueño', icon: <Moon size={14} />, unit: 'h' },
  { id: 'water', label: 'Agua', icon: <Droplets size={14} />, unit: 'ml' },
  { id: 'meds', label: 'Medicación', icon: <Pill size={14} />, unit: '' },
  { id: 'steps', label: 'Pasos', icon: <Footprints size={14} />, unit: '' },
  { id: 'heart', label: 'Ritmo cardíaco', icon: <Heart size={14} />, unit: 'bpm' },
];

function HealthModule() {
  const { meHealth, upsertMeHealth, deleteMeHealth } = useWeaver();
  const [kind, setKind] = useState('weight');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');

  function add() {
    if (!value.trim()) return;
    const kindDef = HEALTH_KINDS.find((k) => k.id === kind)!;
    const h: MeHealth = {
      id: crypto.randomUUID(),
      kind,
      value: value.trim(),
      unit: kindDef.unit || null,
      ts: Date.now(),
      notes: notes.trim() || null,
    };
    upsertMeHealth(h);
    setValue('');
    setNotes('');
  }

  // Estadísticas por tipo
  const stats = useMemo(() => {
    const m = new Map<string, MeHealth[]>();
    for (const h of meHealth) {
      if (!m.has(h.kind)) m.set(h.kind, []);
      m.get(h.kind)!.push(h);
    }
    return m;
  }, [meHealth]);

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto">
      <div className="p-4 rounded-codex border border-border bg-app-elevated mb-4">
        <div className="text-xs text-text-muted mb-2">Nuevo registro</div>
        <div className="grid grid-cols-12 gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="codex-input col-span-4 px-2 py-1.5 text-sm"
          >
            {HEALTH_KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder={`Valor ${HEALTH_KINDS.find((k) => k.id === kind)?.unit ?? ''}`.trim()}
            className="codex-input col-span-3 px-2 py-1.5 text-sm"
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Notas (opcional)"
            className="codex-input col-span-4 px-2 py-1.5 text-sm"
          />
          <button onClick={add} className="codex-btn codex-btn-primary col-span-1 text-xs px-2 py-1.5">
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Estadísticas rápidas */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        {HEALTH_KINDS.map((k) => {
          const arr = (stats.get(k.id) ?? []).slice().sort((a, b) => b.ts - a.ts);
          if (arr.length === 0) return null;
          const latest = arr[0];
          return (
            <div key={k.id} className="p-3 rounded-codex border border-border">
              <div className="flex items-center gap-1.5 text-xs text-text-muted mb-1">
                {k.icon} {k.label}
              </div>
              <div className="text-lg font-medium">
                {latest.value}{latest.unit && <span className="text-xs text-text-muted ml-1">{latest.unit}</span>}
              </div>
              <div className="text-[10px] text-text-muted">{fmtDate(latest.ts, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          );
        })}
      </div>

      {/* Historial */}
      <div className="text-xs text-text-muted mb-2">Historial reciente</div>
      <div className="space-y-1">
        {meHealth.slice().sort((a, b) => b.ts - a.ts).slice(0, 30).map((h) => {
          const k = HEALTH_KINDS.find((x) => x.id === h.kind);
          return (
            <div key={h.id} className="group flex items-center gap-2 px-2 py-1.5 rounded-codex hover:bg-app-elevated text-sm">
              <span className="text-accent">{k?.icon}</span>
              <span className="text-text-muted text-xs w-20">{k?.label}</span>
              <span className="font-medium">{h.value}{h.unit && <span className="text-text-muted text-xs ml-1">{h.unit}</span>}</span>
              {h.notes && <span className="text-xs text-text-secondary truncate flex-1">— {h.notes}</span>}
              <span className="text-[10px] text-text-muted ml-auto">{fmtDate(h.ts, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <button
                onClick={() => deleteMeHealth(h.id)}
                className="opacity-0 group-hover:opacity-100 codex-icon-btn w-5 h-5"
                title="Eliminar"
              >
                <Trash2 size={10} />
              </button>
            </div>
          );
        })}
        {meHealth.length === 0 && (
          <div className="text-center py-8 text-text-muted text-sm">
            <Heart size={28} className="mx-auto mb-2 opacity-50" />
            Sin registros. Empieza añadiendo uno arriba.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Lista de la compra
// ============================================================================

const SHOPPING_CATEGORIES = [
  { id: 'produce', label: 'Frutas y verduras', icon: '🥬' },
  { id: 'dairy', label: 'Lácteos', icon: '🥛' },
  { id: 'meat', label: 'Carnes', icon: '🥩' },
  { id: 'bakery', label: 'Panadería', icon: '🍞' },
  { id: 'pantry', label: 'Despensa', icon: '🥫' },
  { id: 'frozen', label: 'Congelados', icon: '🧊' },
  { id: 'beverages', label: 'Bebidas', icon: '🥤' },
  { id: 'snacks', label: 'Snacks', icon: '🍫' },
  { id: 'household', label: 'Hogar', icon: '🧽' },
  { id: 'other', label: 'Otros', icon: '🛒' },
];

function ShoppingModule() {
  const { meShopping, upsertMeShopping, deleteMeShopping } = useWeaver();
  const [name, setName] = useState('');
  const [qty, setQty] = useState('');
  const [category, setCategory] = useState('other');

  function add() {
    if (!name.trim()) return;
    const item: MeShoppingItem = {
      id: crypto.randomUUID(),
      list_id: 'default',
      name: name.trim(),
      qty: qty.trim() || null,
      category,
      checked: false,
      created_at: Date.now(),
      checked_at: null,
    };
    upsertMeShopping(item);
    setName('');
    setQty('');
  }

  const grouped = useMemo(() => {
    const m = new Map<string, MeShoppingItem[]>();
    for (const it of meShopping) {
      if (it.checked) continue;
      if (!m.has(it.category ?? 'other')) m.set(it.category ?? 'other', []);
      m.get(it.category ?? 'other')!.push(it);
    }
    return m;
  }, [meShopping]);
  const checkedItems = meShopping.filter((i) => i.checked).sort((a, b) => (b.checked_at ?? 0) - (a.checked_at ?? 0));

  return (
    <div className="px-6 py-6 max-w-3xl mx-auto">
      <div className="p-3 rounded-codex border border-border bg-app-elevated mb-4">
        <div className="grid grid-cols-12 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Producto"
            className="codex-input col-span-5 px-2 py-1.5 text-sm"
          />
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Cant."
            className="codex-input col-span-2 px-2 py-1.5 text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="codex-input col-span-4 px-2 py-1.5 text-sm"
          >
            {SHOPPING_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
            ))}
          </select>
          <button onClick={add} className="codex-btn codex-btn-primary col-span-1 text-xs px-2 py-1.5">
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Pendientes agrupados por categoría */}
      <div className="space-y-3 mb-5">
        {SHOPPING_CATEGORIES.map((c) => {
          const items = grouped.get(c.id) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={c.id}>
              <div className="text-xs text-text-muted mb-1 px-1 flex items-center gap-1">
                <span>{c.icon}</span> {c.label}
              </div>
              <div className="space-y-0.5">
                {items.map((it) => (
                  <div
                    key={it.id}
                    className="group flex items-center gap-2 px-2 py-1.5 rounded-codex hover:bg-app-elevated text-sm"
                  >
                    <button
                      onClick={() => upsertMeShopping({ ...it, checked: true, checked_at: Date.now() })}
                      className="w-4 h-4 rounded border border-border-accent hover:border-accent"
                      title="Marcar"
                    />
                    <span className="flex-1">{it.name}</span>
                    {it.qty && <span className="text-xs text-text-muted">{it.qty}</span>}
                    <button
                      onClick={() => deleteMeShopping(it.id)}
                      className="opacity-0 group-hover:opacity-100 codex-icon-btn w-5 h-5"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {meShopping.filter((i) => !i.checked).length === 0 && (
          <div className="text-center py-8 text-text-muted text-sm">
            <ShoppingCart size={32} className="mx-auto mb-2 opacity-50" />
            Lista vacía. Añade productos arriba.
          </div>
        )}
      </div>

      {/* Comprados */}
      {checkedItems.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-text-muted">Comprados ({checkedItems.length})</div>
            <button
              onClick={() => { for (const it of checkedItems) deleteMeShopping(it.id); }}
              className="text-[10px] text-danger hover:underline"
            >
              Limpiar
            </button>
          </div>
          <div className="space-y-0.5">
            {checkedItems.map((it) => (
              <div key={it.id} className="group flex items-center gap-2 px-2 py-1 rounded-codex text-sm">
                <button
                  onClick={() => upsertMeShopping({ ...it, checked: false, checked_at: null })}
                  className="w-4 h-4 rounded bg-success border border-success flex items-center justify-center"
                >
                  <Check size={10} className="text-white" />
                </button>
                <span className="flex-1 line-through opacity-50">{it.name}</span>
                {it.qty && <span className="text-xs text-text-muted line-through">{it.qty}</span>}
                <button
                  onClick={() => deleteMeShopping(it.id)}
                  className="opacity-0 group-hover:opacity-100 codex-icon-btn w-5 h-5"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
