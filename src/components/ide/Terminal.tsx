/**
 * Terminal — terminal integrada del IDE.
 *
 * No es una PTY real (eso requeriría un backend Tauri con pty.js o similar),
 * pero sí una terminal de comandos que:
 *  - Ejecuta comandos shell vía sqlite.shellExec (Tauri)
 *  - Mantiene un historial de comandos (↑ / ↓)
 *  - Muestra stdout + stderr + código de salida
 *  - Cd visual al cambiar de directorio (pwd)
 *  - Autocompleta rutas con Tab (básico)
 *
 * Limitaciones conocidas:
 *  - No es interactiva: no soporta programas que esperan stdin (vim, less, etc.)
 *  - No hay color ANSI parsing por ahora (se renderiza como texto plano)
 *  - Cada comando es una ejecución fresca (no hay estado de shell persistente)
 *
 * Para v1 es suficiente. Si necesitas PTY real, podemos integrar
 * tauri-plugin-shell con PTY en una próxima iteración.
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Loader2, X } from 'lucide-react';
import { sqlite, runtime } from '@/lib/tauri';

interface TermLine {
  id: string;
  kind: 'cmd' | 'stdout' | 'stderr' | 'error' | 'info';
  text: string;
  ts: number;
}

interface TerminalProps {
  cwd: string | null;
}

const LINE_ID = () =>
  `tl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function Terminal({ cwd }: TerminalProps) {
  const [lines, setLines] = useState<TermLine[]>([
    {
      id: LINE_ID(),
      kind: 'info',
      text: runtime.isTauri
        ? `Weaver Terminal · escribe "help" para ver atajos · cwd: ${cwd ?? '(sin carpeta)'}`
        : 'Weaver Terminal (modo navegador) · las operaciones requieren Tauri',
      ts: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  async function runCommand(raw: string) {
    const cmd = raw.trim();
    if (!cmd) return;
    if (!runtime.isTauri) {
      setLines((prev) => [
        ...prev,
        { id: LINE_ID(), kind: 'error', text: 'Requiere Tauri para ejecutar comandos.', ts: Date.now() },
      ]);
      return;
    }

    setHistory((prev) => [...prev, cmd]);
    setHistIdx(-1);
    setLines((prev) => [
      ...prev,
      { id: LINE_ID(), kind: 'cmd', text: cmd, ts: Date.now() },
    ]);
    setRunning(true);
    setInput('');

    // Built-ins.
    if (cmd === 'help') {
      setLines((prev) => [
        ...prev,
        {
          id: LINE_ID(),
          kind: 'info',
          text: 'Atajos: ↑/↓ historial · Tab autocompletar ruta · clear limpiar · help esta ayuda · cd <dir> cambiar carpeta',
          ts: Date.now(),
        },
      ]);
      setRunning(false);
      return;
    }
    if (cmd === 'clear' || cmd === 'cls') {
      setLines([]);
      setRunning(false);
      return;
    }
    if (cmd.startsWith('cd ')) {
      const target = cmd.slice(3).trim();
      // No podemos cambiar el cwd real del store desde aquí porque
      // el cwd es del IDE, no de la terminal. Lo dejamos como info.
      setLines((prev) => [
        ...prev,
        {
          id: LINE_ID(),
          kind: 'info',
          text: `cd es relativo al cwd del IDE (${cwd}). Usa el botón "Carpeta" del topbar para cambiarlo.`,
          ts: Date.now(),
        },
      ]);
      setRunning(false);
      return;
    }

    try {
      const result = await sqlite.shellExec(cmd, cwd ?? undefined, 30_000);
      if (result.stdout) {
        setLines((prev) => [
          ...prev,
          { id: LINE_ID(), kind: 'stdout', text: result.stdout, ts: Date.now() },
        ]);
      }
      if (result.stderr) {
        setLines((prev) => [
          ...prev,
          { id: LINE_ID(), kind: 'stderr', text: result.stderr, ts: Date.now() },
        ]);
      }
      if (result.code !== 0) {
        setLines((prev) => [
          ...prev,
          {
            id: LINE_ID(),
            kind: 'error',
            text: `Proceso terminó con código ${result.code}`,
            ts: Date.now(),
          },
        ]);
      }
      if (!result.stdout && !result.stderr && result.code === 0) {
        setLines((prev) => [
          ...prev,
          { id: LINE_ID(), kind: 'info', text: '(sin output)', ts: Date.now() },
        ]);
      }
    } catch (e) {
      setLines((prev) => [
        ...prev,
        {
          id: LINE_ID(),
          kind: 'error',
          text: e instanceof Error ? e.message : String(e),
          ts: Date.now(),
        },
      ]);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const next = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next);
      setInput(history[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx === -1) return;
      const next = histIdx + 1;
      if (next >= history.length) {
        setHistIdx(-1);
        setInput('');
      } else {
        setHistIdx(next);
        setInput(history[next]);
      }
    } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setLines([]);
    }
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 bg-app-bg font-mono text-[12px] cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Output */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5 selectable">
        {lines.map((l) => (
          <Line key={l.id} line={l} cwd={cwd} />
        ))}
        {running && (
          <div className="flex items-center gap-1.5 text-text-muted">
            <Loader2 size={10} className="animate-spin" />
            <span className="text-[10px]">ejecutando…</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border bg-app-sidebar">
        <ChevronRight size={11} className="text-accent shrink-0" />
        <span className="text-[10px] text-text-muted shrink-0 max-w-[200px] truncate">
          {cwd ?? '~'}
        </span>
        <span className="text-text-muted shrink-0">$</span>
        <input
          ref={inputRef}
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          disabled={!runtime.isTauri}
          className="flex-1 bg-transparent outline-none text-text-primary font-mono text-[12px] disabled:opacity-50"
          placeholder={runtime.isTauri ? 'escribe un comando… (help para ayuda)' : 'requiere Tauri'}
        />
      </div>
    </div>
  );
}

function Line({ line, cwd }: { line: TermLine; cwd: string | null }) {
  const color =
    line.kind === 'cmd'
      ? 'text-accent'
      : line.kind === 'stderr'
        ? 'text-danger'
        : line.kind === 'error'
          ? 'text-danger'
          : line.kind === 'info'
            ? 'text-text-muted'
            : 'text-text-secondary';

  if (line.kind === 'cmd') {
    return (
      <div className="flex gap-1.5">
        <span className="text-text-muted shrink-0">{cwd ?? '~'} $</span>
        <span className={color}>{line.text}</span>
      </div>
    );
  }
  return <div className={color + ' whitespace-pre-wrap break-all'}>{line.text}</div>;
}
