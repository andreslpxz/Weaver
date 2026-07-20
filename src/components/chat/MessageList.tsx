import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/components/common/Button';
import type { Message } from '@/providers/types';
import { useWeaver } from '@/store/weaver';
import type { Subtask, TraceStep } from '@/agent/types';
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Brain,
  Copy,
  Check,
  RefreshCw,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Search,
  Terminal,
  Globe,
  FileCode,
  Download,
  X,
  EyeOff,
  Maximize2,
  ExternalLink,
  Calendar,
  ListTodo,
  StickyNote,
  Heart,
  ShoppingCart,
  Mail,
  Cloud,
  Map as MapIcon,
  Home,
  MessageSquare,
  Puzzle,
  Cog,
  Sparkles,
} from 'lucide-react';
import { formatSize } from '@/lib/attachments';

export function MessageList() {
  const conversation = useWeaver((s) =>
    s.conversations.find((c) => c.id === s.activeConversationId),
  );

  if (!conversation) return null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {conversation.messages.length === 0 && <EmptyState />}
        {conversation.messages.map((msg, i) => (
          <MessageBubble key={msg.id ?? i} msg={msg} />
        ))}
        {conversation.plan && <PlanCard plan={conversation.plan} />}
        {Object.entries(conversation.traces).map(([sid, steps]) =>
          steps.length > 0 ? <TraceCard key={sid} subtaskId={sid} steps={steps} /> : null,
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20">
      <WeaverMark />
      <h1 className="text-2xl font-medium mt-6 mb-2">¿En qué deberíamos trabajar?</h1>
      <p className="text-text-secondary text-sm max-w-md">
        Dile a Weaver qué quieres lograr. Planeará, ejecutará acciones en tus apps vía
        accesibilidad AT-SPI, verificará y reflexionará para aprender.
      </p>
      <div className="mt-8 grid grid-cols-1 gap-2 max-w-md w-full">
        <Suggestion text="Abre gedit y escribe 'Hola desde Weaver', luego guárdalo en ~/weaver-test.txt" />
        <Suggestion text="Busca en internet las últimas noticias de IA y haz un resumen" />
        <Suggestion text="Lee el archivo /etc/os-release y dime qué distro es" />
        <Suggestion text="En mi calendario ME, organiza mi fiesta el próximo sábado a las 8pm" />
      </div>
    </div>
  );
}

function Suggestion({ text }: { text: string }) {
  const setComposer = useSuggestionSetter();
  return (
    <button
      onClick={() => setComposer(text)}
      className="text-left text-sm text-text-secondary hover:text-text-primary border border-border hover:border-border-accent rounded-codex px-3 py-2 transition-colors"
    >
      {text}
    </button>
  );
}

// Bridge mínimo para comunicar sugerencias al composer sin contexto extra.
let suggestionListener: ((text: string) => void) | null = null;
export function setSuggestionSetter(fn: (text: string) => void) {
  suggestionListener = fn;
}
function useSuggestionSetter() {
  return (text: string) => suggestionListener?.(text);
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const isTool = msg.role === 'tool';
  const isAssistant = msg.role === 'assistant';
  const [showReasoning, setShowReasoning] = useState(false);
  const [copied, setCopied] = useState(false);
  const regenerate = useWeaver((s) => s.regenerateMessage);
  const isRunning = useWeaver((s) => {
    const c = s.conversations.find((cc) => cc.id === s.activeConversationId);
    return c?.agentState !== 'idle' && c?.agentState !== 'error';
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="group selectable">
      {/* Reasoning toggle (cerebro) — solo si hay reasoning y es assistant */}
      {isAssistant && msg.reasoning && msg.reasoning.trim() && (
        <button
          onClick={() => setShowReasoning((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-accent mb-1.5 transition-colors"
          title="Mostrar/ocultar razonamiento"
        >
          <Brain size={12} />
          {showReasoning ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          Razonamiento
        </button>
      )}
      {isAssistant && showReasoning && msg.reasoning && (
        <div
          className="text-xs leading-relaxed mb-2 px-3 py-2 rounded-codex bg-app-bg border border-border"
          style={{ color: 'var(--text-muted)', opacity: 0.75 }}
        >
          <pre className="whitespace-pre-wrap font-sans">{msg.reasoning}</pre>
        </div>
      )}

      {/* Contenido del mensaje */}
      {isUser ? (
        <div className="flex justify-end">
          <div className="bg-app-elevated border border-border rounded-codex px-3 py-2 max-w-[85%]">
            <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
            {msg.attachments && msg.attachments.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border space-y-1">
                {msg.attachments.map((a) => (
                  <div key={a.id} className="flex items-center gap-1.5 text-xs text-text-secondary">
                    {a.kind === 'text' ? (
                      <FileText size={11} className="text-accent" />
                    ) : a.kind === 'image' ? (
                      <ImageIcon size={11} className="text-warning" />
                    ) : (
                      <FileIcon size={11} className="text-text-muted" />
                    )}
                    <span className="truncate flex-1">{a.name}</span>
                    <span className="text-text-muted">{formatSize(a.size)}</span>
                    {a.truncated && <span className="text-warning text-[10px]">trunc</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : isTool ? (
        <div className="border-l-2 border-border-accent pl-2 py-1">
          <div className="text-xs opacity-70 mb-1">tool result</div>
          <div className="whitespace-pre-wrap text-xs text-text-muted">{msg.content}</div>
        </div>
      ) : (
        <div className="max-w-none text-sm leading-relaxed">
          {(msg.content ?? '').trim() === '' && isRunning ? (
            <div className="flex items-center gap-2 text-text-muted text-xs">
              <Loader2 size={12} className="animate-spin" />
              pensando…
            </div>
          ) : (
            <MessageContent content={msg.content ?? ''} />
          )}

          {/* Botones de acción bajo el mensaje: copiar + regenerar */}
          {(msg.content ?? '').trim() !== '' && (
            <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                className="codex-icon-btn w-6 h-6"
                title="Copiar mensaje"
              >
                {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              </button>
              {msg.id && (
                <button
                  onClick={() => regenerate(msg.id!)}
                  disabled={isRunning}
                  className="codex-icon-btn w-6 h-6 disabled:opacity-40"
                  title="Regenerar respuesta"
                >
                  <RefreshCw size={11} className={isRunning ? 'animate-spin' : ''} />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Renderizado de contenido con cápsulas acordeón + mini-ventanas
// ============================================================================
//
// Patrones reconocidos dentro del contenido de un mensaje del asistente:
//
// 1. [tool <name>: <label>]
//    Cápsula inicial. Crea el header colapsable. El resultado se mostrará
//    dentro cuando llegue el patrón [result <name>: ...] siguiente.
//
// 2. [result <name>: <text>]
//    Resultado de la herramienta. Se acopla a la última cápsula del mismo
//    tool name dentro del mismo mensaje.
//
// 3. [file:<filename>:<sizeBytes>:<pathOrLabel>]
//    Botón de descarga de archivo generado.
//
// 4. [render:<type>:<id>:<title>]
//    Marca el inicio de una mini-ventana que renderiza contenido embebido.
//    El contenido viene después, en bloques [render-content:<id>:<contentType>]
//    ... contenido ... [/render-content]
//    type ∈ {html, pdf, docx, xlsx, md}
//
// 5. [app:<appId>:<label>]
//    Muestra el logo de la app con la que el agente está interactuando.
//    appId ∈ {firefox, chrome, vscode, gedit, terminal, libreoffice, ...}
//
// ============================================================================

interface CapsuleGroup {
  toolName: string;
  label: string;
  appId?: string;
  resultText?: string;
  capsuleId: string; // id único para tracking de hide
}

interface RenderWindow {
  id: string;
  type: 'html' | 'pdf' | 'docx' | 'xlsx' | 'md';
  title: string;
  content: string;
  capsuleId: string;
}

interface ParsedSegment {
  kind: 'text' | 'capsule' | 'file' | 'render' | 'app';
  text?: string;
  capsule?: CapsuleGroup;
  file?: { filename: string; sizeBytes: number; pathOrLabel: string };
  render?: RenderWindow;
  app?: { appId: string; label: string };
}

function parseMessageContent(content: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  // Regex que captura: tool, result, file, render-open, render-close, render-content-open, render-content-close, app
  const pattern = /(\[tool \w+: [^\]]+\]|\[result \w+: [\s\S]*?\]|\[file:[^\]]+\]|\[render:[a-z]+:[a-f0-9-]+:[^\]]+\]|\[render-content:[a-f0-9-]+:[a-z+]+\]|\[\/render-content\]|\[app:\w+:[^\]]+\])/g;
  const parts = content.split(pattern).filter((p) => p !== undefined && p !== '');

  const pendingCapsules: CapsuleGroup[] = [];
  const openRenders: Map<string, { type: RenderWindow['type']; title: string; capsuleId: string; contentType: string }> = new Map();
  const renderContents: Map<string, string> = new Map();
  let currentRenderContentId: string | null = null;
  let currentRenderContentBuf = '';

  for (const part of parts) {
    // tool
    const toolMatch = part.match(/^\[tool (\w+): (.+)\]$/);
    if (toolMatch) {
      const capsuleId = `cap-${pendingCapsules.length}-${Math.random().toString(36).slice(2, 8)}`;
      // Si hay un [app:...] precedente sin capsule, lo absorbemos
      const lastSeg = segments[segments.length - 1];
      const appId = lastSeg?.app?.appId;
      const label = lastSeg?.app?.label;
      if (lastSeg?.kind === 'app') segments.pop();
      const capsule: CapsuleGroup = {
        toolName: toolMatch[1],
        label: toolMatch[2],
        appId: appId,
        capsuleId,
      };
      pendingCapsules.push(capsule);
      segments.push({ kind: 'capsule', capsule });
      continue;
    }

    // result — se acopla a la última capsule con el mismo tool name
    const resultMatch = part.match(/^\[result (\w+): ([\s\S]*)\]$/);
    if (resultMatch) {
      const toolName = resultMatch[1];
      const text = resultMatch[2];
      // Buscar la última capsule pendiente con ese toolName
      for (let i = pendingCapsules.length - 1; i >= 0; i--) {
        if (pendingCapsules[i].toolName === toolName && !pendingCapsules[i].resultText) {
          pendingCapsules[i].resultText = text;
          break;
        }
      }
      // El segmento capsule ya se añadió; se actualizará su contenido al renderizar
      continue;
    }

    // file
    const fileMatch = part.match(/^\[file:([^:]+):(\d+):([^\]]+)\]$/);
    if (fileMatch) {
      segments.push({
        kind: 'file',
        file: { filename: fileMatch[1], sizeBytes: parseInt(fileMatch[2], 10), pathOrLabel: fileMatch[3] },
      });
      continue;
    }

    // app
    const appMatch = part.match(/^\[app:(\w+):([^\]]+)\]$/);
    if (appMatch) {
      segments.push({ kind: 'app', app: { appId: appMatch[1], label: appMatch[2] } });
      continue;
    }

    // render-open
    const renderOpenMatch = part.match(/^\[render:(html|pdf|docx|xlsx|md):([a-f0-9-]+):([^\]]+)\]$/);
    if (renderOpenMatch) {
      openRenders.set(renderOpenMatch[2], {
        type: renderOpenMatch[1] as RenderWindow['type'],
        title: renderOpenMatch[3],
        capsuleId: `rw-${renderOpenMatch[2]}`,
        contentType: '',
      });
      continue;
    }

    // render-content-open
    const rcOpenMatch = part.match(/^\[render-content:([a-f0-9-]+):([a-z+]+)\]$/);
    if (rcOpenMatch) {
      currentRenderContentId = rcOpenMatch[1];
      currentRenderContentBuf = '';
      continue;
    }

    // render-content-close
    if (part === '[/render-content]') {
      if (currentRenderContentId) {
        renderContents.set(currentRenderContentId, currentRenderContentBuf.trim());
        currentRenderContentId = null;
        currentRenderContentBuf = '';
      }
      continue;
    }

    // Si estamos dentro de un render-content, acumular
    if (currentRenderContentId !== null) {
      currentRenderContentBuf += part;
      continue;
    }

    // Texto normal
    if (part.trim()) {
      segments.push({ kind: 'text', text: part });
    }
  }

  // Construir segmentos de render a partir de openRenders + renderContents
  for (const [id, info] of openRenders.entries()) {
    const content = renderContents.get(id) ?? '';
    segments.push({
      kind: 'render',
      render: {
        id, type: info.type, title: info.title, content, capsuleId: info.capsuleId,
      },
    });
  }

  return segments;
}

function MessageContent({ content }: { content: string }) {
  const segments = useMemoParse(content);
  const hiddenCapsules = useWeaver((s) => s.hiddenCapsules);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.kind === 'text' && seg.text) {
          return <MarkdownText key={i} text={seg.text} />;
        }
        if (seg.kind === 'file' && seg.file) {
          return (
            <FileDownloadBlock
              key={i}
              filename={seg.file.filename}
              sizeBytes={seg.file.sizeBytes}
              pathOrLabel={seg.file.pathOrLabel}
            />
          );
        }
        if (seg.kind === 'app' && seg.app) {
          // Este segmento se absorbe en la siguiente capsule; si llega aquí, mostrarlo inline.
          return (
            <div key={i} className="inline-flex items-center gap-1.5 my-1 px-2 py-1 rounded-codex bg-app-elevated border border-border text-xs">
              <AppLogo appId={seg.app.appId} size={14} />
              <span className="text-text-secondary">{seg.app.label}</span>
            </div>
          );
        }
        if (seg.kind === 'capsule' && seg.capsule) {
          if (hiddenCapsules.has(seg.capsule.capsuleId)) return null;
          return <ToolCapsule key={i} capsule={seg.capsule} />;
        }
        if (seg.kind === 'render' && seg.render) {
          if (hiddenCapsules.has(seg.render.capsuleId)) return null;
          return <RenderWindowBlock key={i} rw={seg.render} />;
        }
        return null;
      })}
    </>
  );
}

function useMemoParse(content: string): ParsedSegment[] {
  // Sin memo: re-parsea cada render. El contenido crece incrementalmente,
  // pero las cápsulas ya procesadas conservan su estado interno.
  return parseMessageContent(content);
}

// ============================================================================
// ToolCapsule — cápsula acordeón con bordes redondeados y logo de app
// ============================================================================

function ToolCapsule({ capsule }: { capsule: CapsuleGroup }) {
  const [open, setOpen] = useState(false);
  const hideCapsule = useWeaver((s) => s.hideCapsule);
  const icon = getToolIcon(capsule.toolName);
  const color = getToolColor(capsule.toolName);

  return (
    <div
      className="my-2 rounded-codex border border-border bg-app-elevated overflow-hidden transition-shadow hover:shadow-sm"
      style={{ borderRadius: '10px' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-app-input/40 transition-colors"
      >
        {/* Chevron */}
        <span className="text-text-muted shrink-0">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>

        {/* Logo de la app si existe */}
        {capsule.appId && (
          <AppLogo appId={capsule.appId} size={16} />
        )}

        {/* Icono del tool */}
        <span style={{ color }} className="shrink-0">
          {icon}
        </span>

        {/* Nombre + label */}
        <span className="font-medium text-text-secondary shrink-0">{capsule.toolName}</span>
        <span className="text-text-muted truncate flex-1 text-left">{capsule.label}</span>

        {/* Ocultar */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            hideCapsule(capsule.capsuleId);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              hideCapsule(capsule.capsuleId);
            }
          }}
          className="codex-icon-btn w-5 h-5 opacity-40 hover:opacity-100"
          title="Ocultar cápsula"
        >
          <EyeOff size={11} />
        </span>
      </button>

      {/* Resultado colapsable */}
      {open && capsule.resultText && (
        <div
          className="px-3 py-2 text-xs whitespace-pre-wrap border-t border-border/60"
          style={{
            color: 'var(--text-secondary)',
            opacity: 0.7,
            background: 'var(--bg-app)',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)',
            maxHeight: '320px',
            overflowY: 'auto',
          }}
        >
          {capsule.resultText}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// AppLogo — logos SVG inline para apps y categorías de integraciones
// ============================================================================

const APP_LOGOS: Record<string, { bg: string; fg: string; icon: React.ReactNode }> = {
  firefox: { bg: '#FF7139', fg: '#fff', icon: <Globe size={12} /> },
  chrome: { bg: '#4285F4', fg: '#fff', icon: <Globe size={12} /> },
  edge: { bg: '#0078D7', fg: '#fff', icon: <Globe size={12} /> },
  safari: { bg: '#1E88E5', fg: '#fff', icon: <Globe size={12} /> },
  vscode: { bg: '#007ACC', fg: '#fff', icon: <FileCode size={12} /> },
  'vs-code': { bg: '#007ACC', fg: '#fff', icon: <FileCode size={12} /> },
  gedit: { bg: '#5c6bc0', fg: '#fff', icon: <FileText size={12} /> },
  terminal: { bg: '#1e1e1e', fg: '#4ade80', icon: <Terminal size={12} /> },
  libreoffice: { bg: '#18A303', fg: '#fff', icon: <FileText size={12} /> },
  thunderbird: { bg: '#0a61b8', fg: '#fff', icon: <Mail size={12} /> },
  outlook: { bg: '#0078D4', fg: '#fff', icon: <Mail size={12} /> },
  gmail: { bg: '#EA4335', fg: '#fff', icon: <Mail size={12} /> },
  // MCP / integraciones nativas
  mcp: { bg: '#7c3aed', fg: '#fff', icon: <Puzzle size={12} /> },
  'google-calendar': { bg: '#4285F4', fg: '#fff', icon: <Calendar size={12} /> },
  'apple-calendar': { bg: '#FF3B30', fg: '#fff', icon: <Calendar size={12} /> },
  'outlook-calendar': { bg: '#0078D4', fg: '#fff', icon: <Calendar size={12} /> },
  'google-drive': { bg: '#0F9D58', fg: '#fff', icon: <Cloud size={12} /> },
  onedrive: { bg: '#0078D4', fg: '#fff', icon: <Cloud size={12} /> },
  dropbox: { bg: '#0061FF', fg: '#fff', icon: <Cloud size={12} /> },
  notion: { bg: '#000', fg: '#fff', icon: <StickyNote size={12} /> },
  obsidian: { bg: '#7C3AED', fg: '#fff', icon: <StickyNote size={12} /> },
  evernote: { bg: '#00A82D', fg: '#fff', icon: <StickyNote size={12} /> },
  todoist: { bg: '#E44332', fg: '#fff', icon: <ListTodo size={12} /> },
  ticktick: { bg: '#4772FA', fg: '#fff', icon: <ListTodo size={12} /> },
  things: { bg: '#3A8AF1', fg: '#fff', icon: <ListTodo size={12} /> },
  telegram: { bg: '#0088CC', fg: '#fff', icon: <MessageSquare size={12} /> },
  whatsapp: { bg: '#25D366', fg: '#fff', icon: <MessageSquare size={12} /> },
  slack: { bg: '#4A154B', fg: '#fff', icon: <MessageSquare size={12} /> },
  'google-maps': { bg: '#34A853', fg: '#fff', icon: <MapIcon size={12} /> },
  openstreetmap: { bg: '#7EBC6F', fg: '#fff', icon: <MapIcon size={12} /> },
  'openweather': { bg: '#30A4E6', fg: '#fff', icon: <Cloud size={12} /> },
  'home-assistant': { bg: '#18BCF2', fg: '#fff', icon: <Home size={12} /> },
  'philips-hue': { bg: '#FFC65A', fg: '#000', icon: <Sparkles size={12} /> },
  'google-home': { bg: '#4285F4', fg: '#fff', icon: <Home size={12} /> },
  // ME itself
  me: { bg: '#7aa67a', fg: '#fff', icon: <Calendar size={12} /> },
};

function AppLogo({ appId, size = 16 }: { appId: string; size?: number }) {
  const logo = APP_LOGOS[appId.toLowerCase()];
  if (logo) {
    return (
      <span
        className="rounded-sm flex items-center justify-center shrink-0"
        style={{ background: logo.bg, color: logo.fg, width: size, height: size }}
        title={appId}
      >
        {logo.icon}
      </span>
    );
  }
  // Fallback: ícono genérico de herramienta
  return (
    <span
      className="rounded-sm flex items-center justify-center shrink-0 bg-app-input text-text-muted"
      style={{ width: size, height: size }}
      title={appId}
    >
      <Cog size={size * 0.7} />
    </span>
  );
}

// ============================================================================
// RenderWindowBlock — mini-ventana embebida para HTML/PDF/Word/Excel
// ============================================================================

function RenderWindowBlock({ rw }: { rw: RenderWindow }) {
  const [hidden, setHidden] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 480, h: 320 });
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<{ dx: number; dy: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideCapsule = useWeaver((s) => s.hideCapsule);

  const onRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const onClose = useCallback(() => setHidden(true), []);
  const onOpenExternal = useCallback(() => {
    // Crear blob y abrir
    const mime = rw.type === 'html' ? 'text/html' : rw.type === 'pdf' ? 'application/pdf' : rw.type === 'md' ? 'text/markdown' : 'application/octet-stream';
    const blob = new Blob([rw.content], { type: mime });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [rw]);

  if (hidden) return null;

  // Construir src para iframe
  const srcDoc = useMemo(() => {
    if (rw.type === 'html') return rw.content;
    if (rw.type === 'md') {
      // Renderizar como markdown simple dentro de HTML
      return `<!doctype html><html><body style="font-family: -apple-system, system-ui, sans-serif; padding: 1rem; line-height: 1.5;">${escapeHtml(rw.content).replace(/\n/g, '<br>')}</body></html>`;
    }
    return '';
  }, [rw.content, rw.type]);

  // PDF: blob URL
  const pdfUrl = useMemo(() => {
    if (rw.type !== 'pdf') return null;
    const blob = new Blob([rw.content], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }, [rw.content, rw.type, refreshKey]);

  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging) return;
      setPos({ x: e.clientX - dragging.dx, y: e.clientY - dragging.dy });
    }
    function onMouseUp() { setDragging(null); }
    if (dragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    }
  }, [dragging]);

  const style: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, width: size.w, height: size.h, zIndex: 60 }
    : { position: 'relative', width: size.w, height: size.h };

  return (
    <div
      ref={containerRef}
      className="my-3 rounded-codex border border-border-accent bg-app-bg overflow-hidden shadow-lg flex flex-col"
      style={style}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-2 py-1.5 bg-app-elevated border-b border-border cursor-move select-none"
        onMouseDown={(e) => {
          const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
          setDragging({ dx: e.clientX - rect.left, dy: e.clientY - rect.top });
          setPos({ x: rect.left, y: rect.top });
        }}
      >
        <FileIcon size={12} className="text-accent shrink-0" />
        <span className="text-xs font-medium truncate flex-1">{rw.title}</span>
        <button onClick={onRefresh} className="codex-icon-btn w-5 h-5" title="Refrescar">
          <RefreshCw size={10} />
        </button>
        <button onClick={onOpenExternal} className="codex-icon-btn w-5 h-5" title="Abrir externo">
          <ExternalLink size={10} />
        </button>
        <button
          onClick={() => { hideCapsule(rw.capsuleId); setHidden(true); }}
          className="codex-icon-btn w-5 h-5"
          title="Ocultar"
        >
          <EyeOff size={10} />
        </button>
        <button onClick={onClose} className="codex-icon-btn w-5 h-5" title="Cerrar">
          <X size={10} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-white relative">
        {rw.type === 'html' && (
          <iframe
            key={refreshKey}
            srcDoc={srcDoc}
            title={rw.title}
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            className="w-full h-full border-0"
          />
        )}
        {rw.type === 'md' && (
          <iframe
            key={refreshKey}
            srcDoc={srcDoc}
            title={rw.title}
            className="w-full h-full border-0"
          />
        )}
        {rw.type === 'pdf' && pdfUrl && (
          <iframe
            key={refreshKey}
            src={pdfUrl}
            title={rw.title}
            className="w-full h-full border-0"
          />
        )}
        {rw.type === 'docx' && <DocxPreview key={refreshKey} content={rw.content} title={rw.title} />}
        {rw.type === 'xlsx' && <XlsxPreview key={refreshKey} content={rw.content} title={rw.title} />}
      </div>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize"
        onMouseDown={(e) => {
          e.stopPropagation();
          const startX = e.clientX;
          const startY = e.clientY;
          const startW = size.w;
          const startH = size.h;
          function move(ev: MouseEvent) {
            setSize({ w: Math.max(280, startW + (ev.clientX - startX)), h: Math.max(180, startH + (ev.clientY - startY)) });
          }
          function up() {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
          }
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', up);
        }}
        style={{
          backgroundImage: 'linear-gradient(135deg, transparent 50%, var(--text-muted) 50%, var(--text-muted) 60%, transparent 60%, transparent 70%, var(--text-muted) 70%, var(--text-muted) 80%, transparent 80%)',
          opacity: 0.5,
        }}
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

// Previews simples para docx/xlsx: renderizan el contenido como texto estructurado.
// (Sin dependencias pesadas de mammoth/SheetJS — el agente puede generar HTML directamente.)
function DocxPreview({ content, title }: { content: string; title: string }) {
  // Asumimos que el agente genera HTML válido cuando type=docx (más flexible que XML real).
  return (
    <iframe
      srcDoc={content}
      title={title}
      sandbox="allow-same-origin"
      className="w-full h-full border-0"
    />
  );
}

function XlsxPreview({ content, title }: { content: string; title: string }) {
  // Asumimos CSV o HTML-tabla.
  const isHtml = content.trim().startsWith('<');
  if (isHtml) {
    return <iframe srcDoc={content} title={title} className="w-full h-full border-0" />;
  }
  // CSV → tabla HTML simple
  const rows = content.split('\n').filter((r) => r.trim()).map((r) => r.split(','));
  return (
    <div className="w-full h-full overflow-auto p-2 text-xs">
      <table className="border-collapse">
        <tbody>
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => (
                <td key={j} className="border border-gray-300 px-2 py-0.5">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// FileDownloadBlock — botón de descarga para archivos generados
// ============================================================================

function FileDownloadBlock({
  filename,
  sizeBytes,
  pathOrLabel,
}: {
  filename: string;
  sizeBytes: number;
  pathOrLabel: string;
}) {
  const isPath = pathOrLabel.startsWith('/') || pathOrLabel.includes('\\');
  const sizeLabel = formatFileSize(sizeBytes);

  return (
    <div className="my-2 px-3 py-2.5 rounded-codex bg-app-elevated border border-border-accent flex items-center gap-3" style={{ borderRadius: '10px' }}>
      <div className="flex-shrink-0 w-9 h-9 rounded-codex bg-accent/15 flex items-center justify-center">
        <Download size={16} className="text-accent" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-primary truncate">{filename}</div>
        <div className="text-xs text-text-muted truncate">
          {sizeLabel}
          {isPath && <span className="ml-1">· {pathOrLabel}</span>}
        </div>
      </div>
      {!isPath && (
        <button
          onClick={() => { /* en navegador ya se descargó */ }}
          className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-codex bg-accent text-bg-app text-xs font-medium hover:bg-accent-strong transition-colors"
          title="Archivo descargado"
        >
          <Check size={12} /> Descargado
        </button>
      )}
      {isPath && (
        <span className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-codex bg-success/15 text-success text-xs font-medium">
          <Check size={12} /> Guardado
        </span>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getToolIcon(toolName: string) {
  const size = 14;
  switch (toolName) {
    case 'web_search':
      return <Search size={size} />;
    case 'web_fetch':
      return <Globe size={size} />;
    case 'shell_exec':
      return <Terminal size={size} />;
    case 'file_read':
      return <FileCode size={size} />;
    case 'file_write':
      return <FileCode size={size} />;
    case 'file_list':
      return <FileText size={size} />;
    case 'me_create_event':
    case 'me_list_events':
    case 'me_update_event':
    case 'me_delete_event':
      return <Calendar size={size} />;
    case 'me_create_task':
    case 'me_list_tasks':
    case 'me_complete_task':
      return <ListTodo size={size} />;
    case 'me_create_note':
      return <StickyNote size={size} />;
    case 'me_add_shopping':
      return <ShoppingCart size={size} />;
    case 'me_log_health':
      return <Heart size={size} />;
    default:
      return <Download size={size} />;
  }
}

function getToolColor(toolName: string): string {
  switch (toolName) {
    case 'web_search':
    case 'web_fetch':
      return 'var(--accent)';
    case 'shell_exec':
      return 'var(--success, #4ade80)';
    case 'file_read':
    case 'file_write':
    case 'file_list':
      return 'var(--warning, #fbbf24)';
    case 'me_create_event':
    case 'me_list_events':
    case 'me_update_event':
    case 'me_delete_event':
      return '#7aa67a';
    case 'me_create_task':
    case 'me_list_tasks':
    case 'me_complete_task':
      return '#6b8cff';
    case 'me_create_note':
      return '#c084fc';
    case 'me_add_shopping':
      return '#f59e0b';
    case 'me_log_health':
      return '#ef4444';
    default:
      return 'var(--text-muted)';
  }
}

function MarkdownText({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const isInline = !className;
          return !isInline && match ? (
            <SyntaxHighlighter
              language={match[1]}
              style={vscDarkPlus}
              customStyle={{
                background: 'var(--bg-app)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                fontSize: '0.8125rem',
              }}
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            <code className="px-1 py-0.5 rounded bg-app-elevated text-xs font-mono" {...props}>
              {children}
            </code>
          );
        },
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
        h1: ({ children }) => <h1 className="text-lg font-semibold mb-3 mt-4">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-semibold mb-2 mt-3">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold mb-2 mt-2">{children}</h3>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            {children}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-border-accent pl-3 text-text-secondary italic mb-3">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto mb-3">
            <table className="border-collapse border border-border text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-border p-2 bg-app-elevated">{children}</th>,
        td: ({ children }) => <td className="border border-border p-2">{children}</td>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function PlanCard({ plan }: { plan: { subtasks: Subtask[] } }) {
  const [open, setOpen] = useState(false);
  const done = plan.subtasks.filter((s) => s.status === 'succeeded').length;
  const failed = plan.subtasks.filter((s) => s.status === 'failed').length;
  return (
    <div className="border border-border rounded-codex p-3 bg-app-elevated/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-sm"
      >
        <span className="font-medium text-text-primary">
          Plan ({done}/{plan.subtasks.length} completadas
          {failed > 0 && `, ${failed} fallidas`})
        </span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <ol className="mt-2 space-y-1">
          {plan.subtasks.map((s, i) => (
            <li key={s.id} className="flex items-start gap-2 text-sm">
              <span className="shrink-0 mt-0.5">
                {s.status === 'succeeded' ? (
                  <CheckCircle2 size={14} className="text-success" />
                ) : s.status === 'failed' ? (
                  <XCircle size={14} className="text-danger" />
                ) : s.status === 'in_progress' ? (
                  <Loader2 size={14} className="text-accent animate-spin" />
                ) : (
                  <Circle size={14} className="text-text-muted" />
                )}
              </span>
              <span
                className={cn(
                  'flex-1',
                  s.status === 'succeeded' && 'text-text-secondary line-through',
                  s.status === 'failed' && 'text-danger',
                )}
              >
                <span className="text-text-muted mr-1">{i + 1}.</span>
                {s.description}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function TraceCard({ subtaskId, steps }: { subtaskId: string; steps: TraceStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-codex overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 p-2 text-xs text-text-secondary hover:bg-app-elevated"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-mono">trace/{subtaskId.slice(0, 8)}</span>
        <span className="ml-auto">{steps.length} pasos</span>
      </button>
      {open && (
        <div className="p-2 space-y-1 font-mono text-xs bg-app-bg/50">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-text-muted shrink-0">[{s.kind}]</span>
              <span className="whitespace-pre-wrap break-all text-text-secondary">
                {s.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WeaverMark() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect width="48" height="48" rx="10" fill="var(--bg-elevated)" />
      <path
        d="M10 38L38 10M10 10L38 38"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="24" cy="24" r="5" fill="var(--accent)" />
    </svg>
  );
}
