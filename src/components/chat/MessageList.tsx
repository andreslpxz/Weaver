import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
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
  BookMarked,
  Square,
  Pencil,
} from 'lucide-react';
import { formatSize } from '@/lib/attachments';
import { speak, stopSpeaking, isTTSSupported } from '@/lib/voice';
import { runtime } from '@/lib/tauri';

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

// Limpia el contenido de un mensaje asistente para enviarlo a TTS.
// Quita los marcadores tipo [tool ...], [result ...], [render:...],
// [file:...], [app:...] y deja solo el texto natural.
function sanitizeForTTS(content: string): string {
  return content
    .replace(/\[tool \w+: [^\]]+\]/g, '')
    .replace(/\[result \w+\][\s\S]*?\[\/result\]/g, '')
    .replace(/\[file:[^\]]+\]/g, '')
    .replace(/\[render:[a-z]+:[a-f0-9-]+:[^\]]+\]/g, '')
    .replace(/\[render-content:[a-f0-9-]+:[a-z0-9/+.\-]+\]/g, '')
    .replace(/\[\/render-content\]/g, '')
    .replace(/\[app:\w+:[^\]]+\]/g, '')
    .replace(/<<CONTINUE>>|<<END>>/g, '')
    .replace(/```[\s\S]*?```/g, ' (bloque de código) ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Icono SVG de altavoz — estilo línea, consistente con los iconos lucide.
function SpeakerIcon({ size = 11, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M11 5L6 9H2V15H6L11 19V5Z" />
      <path d="M15.54 8.46A5 5 0 0 1 15.54 15.54" />
      <path d="M19.07 4.93A10 10 0 0 1 19.07 19.07" />
    </svg>
  );
}

// Icono SVG de cerebro — estilo línea consistente con SpeakerIcon/lucide,
// con un hemisferio "trazado" y una costura central que sugiere pensamiento.
export function BrainIcon({ size = 13, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9.5 3.5a3 3 0 0 0-3 3 2.7 2.7 0 0 0-2 2.6 2.8 2.8 0 0 0 1 2.15 3 3 0 0 0 .1 3.55A3.1 3.1 0 0 0 5.5 17a3 3 0 0 0 3 3" />
      <path d="M14.5 3.5a3 3 0 0 1 3 3 2.7 2.7 0 0 1 2 2.6 2.8 2.8 0 0 1-1 2.15 3 3 0 0 1-.1 3.55A3.1 3.1 0 0 1 18.5 17a3 3 0 0 1-3 3" />
      <path d="M9.5 3.5v16M9.5 8.2c1.2.5 1.2 1.9 0 2.4M9.5 12.5c1.4.4 1.4 2 0 2.6M14.5 3.5v16M14.5 8.2c-1.2.5-1.2 1.9 0 2.4M14.5 12.5c-1.4.4-1.4 2 0 2.6" />
    </svg>
  );
}

// ============================================================================
// ReasoningAccordion — acordeón del razonamiento del modelo, con logo de
// cerebro propio y animación de "estirado" hacia abajo (grid-template-rows
// 0fr → 1fr, la técnica CSS que anima a altura auto sin medir el DOM).
// ============================================================================

function ReasoningAccordion({
  text,
  open,
  onToggle,
}: {
  text: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mb-2 max-w-xl">
      <button
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full text-xs transition-colors border"
        style={{
          color: open ? 'var(--accent-strong)' : 'var(--text-muted)',
          borderColor: open ? 'var(--accent)' : 'var(--border)',
          background: open ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
        }}
        title="Mostrar/ocultar razonamiento"
      >
        <BrainIcon size={13} className={open ? 'text-accent' : ''} />
        <span className="font-medium">Razonamiento</span>
        <ChevronDown
          size={11}
          className="transition-transform duration-200"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
      </button>

      {/* Contenedor animado: grid-template-rows 0fr → 1fr permite transicionar
          hacia "altura de contenido" sin conocerla de antemano. */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div
            className="mt-1.5 text-xs leading-relaxed px-3 py-2.5 rounded-codex border"
            style={{
              color: 'var(--text-secondary)',
              background: 'var(--bg-app)',
              borderColor: 'var(--border)',
            }}
          >
            <pre className="whitespace-pre-wrap font-sans">{text}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  const isTool = msg.role === 'tool';
  const isAssistant = msg.role === 'assistant';
  const [showReasoning, setShowReasoning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // --- Edición de mensajes del usuario ---
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const regenerate = useWeaver((s) => s.regenerateMessage);
  const editUserMessage = useWeaver((s) => s.editUserMessage);
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

  const handleSpeak = () => {
    if (!isTTSSupported()) return;
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
      return;
    }
    // Detener cualquier TTS en curso (de otro mensaje) antes de empezar.
    stopSpeaking();
    const text = sanitizeForTTS(msg.content ?? '');
    if (!text) return;
    setIsSpeaking(true);
    speak(text, {
      onEnd: () => setIsSpeaking(false),
    });
  };

  // Detener TTS si el componente se desmonta o el mensaje cambia.
  useEffect(() => {
    return () => {
      if (isSpeaking) stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id]);

  // --- Handlers de edición ---
  const startEdit = () => {
    setEditDraft(msg.content ?? '');
    setIsEditing(true);
    // Focus al textarea en el siguiente tick.
    setTimeout(() => {
      editTextareaRef.current?.focus();
      editTextareaRef.current?.select();
    }, 0);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditDraft('');
  };

  const commitEdit = async () => {
    const newContent = editDraft;
    // Solo hacer algo si el texto es diferente.
    if (newContent.trim() === (msg.content ?? '').trim()) {
      setIsEditing(false);
      return;
    }
    setIsEditing(false);
    setEditDraft('');
    if (msg.id) {
      await editUserMessage(msg.id, newContent);
    }
  };

  // Para el botón Actualizar: color de fondo según si el texto cambió.
  const draftChanged = editDraft.trim() !== (msg.content ?? '').trim() && editDraft.trim().length > 0;

  return (
    <div className="group selectable">
      {/* Acordeón de razonamiento (cerebro) — solo si hay reasoning y es assistant */}
      {isAssistant && msg.reasoning && msg.reasoning.trim() && (
        <ReasoningAccordion
          text={msg.reasoning}
          open={showReasoning}
          onToggle={() => setShowReasoning((v) => !v)}
        />
      )}

      {/* Contenido del mensaje */}
      {isUser ? (
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex justify-end w-full">
            {isEditing ? (
              // --- Modo edición: contorno alrededor del texto editable ---
              <div className="max-w-[85%] w-full flex flex-col gap-2">
                <div
                  className="rounded-codex px-3 py-2 bg-app-elevated"
                  style={{
                    border: '1px solid var(--accent)',
                    boxShadow: '0 0 0 1px var(--accent)',
                  }}
                >
                  <textarea
                    ref={editTextareaRef}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sin Shift = enviar (igual que el composer principal).
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void commitEdit();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    rows={Math.max(1, Math.min(12, editDraft.split('\n').length))}
                    className="w-full bg-transparent text-sm whitespace-pre-wrap resize-none outline-none text-text-primary placeholder:text-text-muted"
                    style={{ fieldSizing: 'content' } as React.CSSProperties}
                  />
                </div>
                {/* Botones cancelar / actualizar */}
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={cancelEdit}
                    className="px-3 py-1 rounded-codex text-xs text-text-secondary hover:text-text-primary transition-colors"
                    style={{ background: 'transparent' }}
                    title="Cancelar edición"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void commitEdit()}
                    disabled={!draftChanged}
                    className="px-3 py-1 rounded-codex text-xs font-medium transition-colors disabled:cursor-not-allowed"
                    style={{
                      background: draftChanged ? 'var(--accent)' : 'var(--app-elevated)',
                      color: draftChanged ? '#fff' : 'var(--text-muted)',
                      border: draftChanged ? '1px solid var(--accent)' : '1px solid var(--border)',
                    }}
                    title={draftChanged ? 'Actualizar mensaje y regenerar respuesta' : 'Sin cambios'}
                  >
                    Actualizar
                  </button>
                </div>
              </div>
            ) : (
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
            )}
          </div>

          {/* Botones de acción bajo el mensaje del usuario: copiar + editar */}
          {!isEditing && (msg.content ?? '').trim() !== '' && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                className="codex-icon-btn w-6 h-6"
                title="Copiar mensaje"
              >
                {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              </button>
              <button
                onClick={startEdit}
                disabled={isRunning}
                className="codex-icon-btn w-6 h-6 disabled:opacity-40"
                title="Editar mensaje"
              >
                <Pencil size={11} />
              </button>
            </div>
          )}
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

          {/* Botones de acción bajo el mensaje: copiar + escuchar + regenerar */}
          {(msg.content ?? '').trim() !== '' && (
            <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                className="codex-icon-btn w-6 h-6"
                title="Copiar mensaje"
              >
                {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
              </button>
              {isTTSSupported() && (
                <button
                  onClick={handleSpeak}
                  className="codex-icon-btn w-6 h-6"
                  title={isSpeaking ? 'Detener lectura' : 'Escuchar mensaje'}
                  style={isSpeaking ? { color: 'var(--accent)' } : undefined}
                >
                  {isSpeaking ? <Square size={10} /> : <SpeakerIcon size={11} />}
                </button>
              )}
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
// 2. [result <name>]<text>[/result]
//    Resultado de la herramienta. Se acopla a la última cápsula del mismo
//    tool name dentro del mismo mensaje. Usa un marcador de cierre explícito
//    ([/result]) en vez de terminar en "]" porque el contenido casi siempre
//    trae corchetes propios (JSON, arrays, URLs) que romperían un cierre
//    basado en "]".
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
  type: 'html' | 'pdf' | 'docx' | 'xlsx' | 'md' | 'svg' | 'mermaid';
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
  // Nota: el mime en render-content puede contener /, +, ., números y letras
  // (ej: text/html, application/pdf, application/vnd.ms-excel).
  // result usa [/result] como cierre explícito (ver nota arriba) — jamás "]".
  const pattern = /(\[tool \w+: [^\]]+\]|\[result \w+\][\s\S]*?\[\/result\]|\[file:[^\]]+\]|\[render:[a-z]+:[a-f0-9-]+:[^\]]+\]|\[render-content:[a-f0-9-]+:[a-z0-9/+.\-]+\]|\[\/render-content\]|\[app:\w+:[^\]]+\])/g;
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
    const resultMatch = part.match(/^\[result (\w+)\]([\s\S]*)\[\/result\]$/);
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
    const renderOpenMatch = part.match(/^\[render:(html|pdf|docx|xlsx|md|svg|mermaid):([a-f0-9-]+):([^\]]+)\]$/);
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
    // El mime puede traer "/" y "." (ej: text/html, application/pdf,
    // application/vnd.ms-excel) — el regex debe aceptar ambos o nunca
    // matchea, dejando el contenido como texto plano suelto en el chat en
    // vez de activar la ventana de render.
    const rcOpenMatch = part.match(/^\[render-content:([a-f0-9-]+):([a-z0-9/+.\-]+)\]$/);
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
  const [maximized, setMaximized] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideCapsule = useWeaver((s) => s.hideCapsule);

  // Construir src para iframe — declarado ANTES de onOpenExternal porque éste
  // lo referencia (svg/mermaid abren el srcDoc ya renderizado, no el content
  // crudo). Si se declara después, es un ReferenceError en tiempo de
  // ejecución (temporal dead zone de `const`).
  const srcDoc = useMemo(() => {
    if (rw.type === 'html') return rw.content;
    if (rw.type === 'md') {
      // Renderizar como markdown simple dentro de HTML
      return `<!doctype html><html><body style="font-family: -apple-system, system-ui, sans-serif; padding: 1rem; line-height: 1.5;">${escapeHtml(rw.content).replace(/\n/g, '<br>')}</body></html>`;
    }
    if (rw.type === 'svg') {
      // El SVG se centra y se escala para llenar la ventana sin recortarse.
      return `<!doctype html><html><head><style>
        html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;}
        svg{max-width:100%;max-height:100%;}
      </style></head><body>${rw.content}</body></html>`;
    }
    if (rw.type === 'mermaid') {
      // Carga mermaid.js desde CDN y renderiza el diagrama dentro del iframe.
      // Aislado del resto de la app — si el CDN falla, se ve un mensaje claro
      // en vez de una ventana en blanco.
      return `<!doctype html><html><head><style>
        html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;
          background:#fff;font-family:-apple-system,system-ui,sans-serif;overflow:auto;padding:1rem;box-sizing:border-box;}
        #err{color:#b91c1c;font-size:13px;display:none;}
      </style></head><body>
        <div class="mermaid" id="dgm">${escapeHtml(rw.content)}</div>
        <div id="err">No se pudo cargar el renderizador de diagramas (sin conexión a internet).</div>
        <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js" onerror="document.getElementById('dgm').style.display='none';document.getElementById('err').style.display='block';"></script>
        <script>
          window.addEventListener('load', function() {
            if (window.mermaid) {
              mermaid.initialize({ startOnLoad: true, theme: 'default' });
            }
          });
        </script>
      </body></html>`;
    }
    return '';
  }, [rw.content, rw.type]);

  const onRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const onClose = useCallback(() => setHidden(true), []);
  const onOpenExternal = useCallback(() => {
    // Crear blob y abrir. Para svg/mermaid abrimos el mismo srcDoc renderizado
    // (no el contenido crudo) para que también funcione fuera del chat.
    const isSrcDocType = rw.type === 'svg' || rw.type === 'mermaid';
    const mime = rw.type === 'html' || isSrcDocType
      ? 'text/html'
      : rw.type === 'pdf' ? 'application/pdf' : rw.type === 'md' ? 'text/markdown' : 'application/octet-stream';
    const blob = new Blob([isSrcDocType ? srcDoc : rw.content], { type: mime });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [rw, srcDoc]);

  // Cerrar el modal de maximizado con Escape.
  useEffect(() => {
    if (!maximized) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMaximized(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maximized]);

  // PDF: blob URL
  const pdfUrl = useMemo(() => {
    if (rw.type !== 'pdf') return null;
    const blob = new Blob([rw.content], { type: 'application/pdf' });
    return URL.createObjectURL(blob);
  }, [rw.content, rw.type, refreshKey]);

  useEffect(() => {
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [pdfUrl]);

  // El "return null" temprano va DESPUÉS de todos los hooks (Reglas de los
  // Hooks de React: el número/orden de hooks debe ser el mismo en cada
  // render — un return antes de un useMemo/useEffect posterior hace que
  // React los salte solo quando hidden=true, lo que dispara "Rendered fewer
  // hooks than expected" y puede romper el estado del componente).
  if (hidden) return null;


  const renderContent = (heightOverride?: string) => (
    <div className="flex-1 overflow-hidden bg-white relative" style={heightOverride ? { height: heightOverride } : undefined}>
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
      {rw.type === 'svg' && (
        <iframe
          key={refreshKey}
          srcDoc={srcDoc}
          title={rw.title}
          className="w-full h-full border-0"
        />
      )}
      {rw.type === 'mermaid' && (
        <iframe
          key={refreshKey}
          srcDoc={srcDoc}
          title={rw.title}
          sandbox="allow-scripts"
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
  );

  const titleBar = (isMaximizedBar: boolean) => (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-app-elevated border-b border-border select-none">
      <FileIcon size={12} className="text-accent shrink-0" />
      <span className="text-xs font-medium truncate flex-1">{rw.title}</span>
      <button onClick={onRefresh} className="codex-icon-btn w-6 h-6" title="Refrescar">
        <RefreshCw size={12} />
      </button>
      <button onClick={onOpenExternal} className="codex-icon-btn w-6 h-6" title="Abrir externo">
        <ExternalLink size={12} />
      </button>
      <button
        onClick={() => setMaximized((v) => !v)}
        className="codex-icon-btn w-6 h-6"
        title={isMaximizedBar ? 'Restaurar' : 'Maximizar'}
      >
        <Maximize2 size={12} />
      </button>
      {!isMaximizedBar && (
        <button
          onClick={() => { hideCapsule(rw.capsuleId); setHidden(true); }}
          className="codex-icon-btn w-6 h-6"
          title="Ocultar"
        >
          <EyeOff size={12} />
        </button>
      )}
      <button onClick={onClose} className="codex-icon-btn w-6 h-6" title="Cerrar">
        <X size={12} />
      </button>
    </div>
  );

  return (
    <>
      {/*
        Ventana embebida — vive SIEMPRE dentro del flujo normal del chat
        (position: relative), nunca en position: fixed. Antes se volvía
        fixed en cuanto el usuario arrastraba la barra de título, lo que la
        dejaba flotando pegada al viewport: al hacer scroll "seguía" al
        usuario por toda la pantalla, tapando el resto del chat, y los
        botones de la barra de título quedaban fuera de alcance o debajo de
        otro contenido — por eso "ocultar/maximizar/recargar no servían".
        Ahora el arrastre libre desapareció; para verla en grande existe el
        botón Maximizar, que abre un modal real (fixed + backdrop) separado
        de la tarjeta normal — nunca se mezclan ambos comportamientos.
      */}
      <div
        ref={containerRef}
        className="my-3 rounded-codex border border-border-accent bg-app-bg overflow-hidden shadow-lg flex flex-col relative"
        style={{ width: '100%', maxWidth: size.w, height: size.h }}
      >
        {titleBar(false)}
        {renderContent()}

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

      {/*
        Modal de maximizado — overlay fixed explícito con backdrop, separado
        de la tarjeta de arriba. Se cierra con el botón Restaurar, la X, o
        Escape. No se mueve con el scroll (a propósito: es un modal), pero
        a diferencia del bug anterior, aquí SÍ es la intención — el usuario
        lo abrió deliberadamente con un botón, y siempre tiene forma clara
        de cerrarlo.
      */}
      {maximized && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4"
          style={{ zIndex: 200 }}
          onClick={(e) => { if (e.target === e.currentTarget) setMaximized(false); }}
        >
          <div className="w-full h-full max-w-5xl bg-app-bg rounded-codex border border-border-accent shadow-lg flex flex-col overflow-hidden">
            {titleBar(true)}
            {renderContent('100%')}
          </div>
        </div>
      )}
    </>
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

/** Tipo de media inferido por extensión, para decidir cómo previsualizar el archivo en el chat. */
type MediaKind = 'image' | 'audio' | 'video' | 'other';

function getMediaKind(filename: string): MediaKind {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return 'video';
  return 'other';
}

/**
 * Resuelve una URL reproducible/visualizable en el webview a partir de un
 * path o label devuelto por el tool save_file.
 * - blob:... u otra URL ya navegable (navegador): se usa tal cual.
 * - Ruta local de sistema de archivos (Tauri): se usa el asset protocol
 *   (convertFileSrc) para que <img>/<audio>/<video> puedan leerla.
 * - Cualquier otro caso (label de tamaño, no una ruta real): no hay nada
 *   que previsualizar.
 */
function useMediaSrc(pathOrLabel: string): string | null {
  const isBlobUrl = pathOrLabel.startsWith('blob:') || pathOrLabel.startsWith('http:') || pathOrLabel.startsWith('https:');
  const isFsPath = !isBlobUrl && (pathOrLabel.startsWith('/') || /^[a-zA-Z]:\\/.test(pathOrLabel) || pathOrLabel.includes('\\'));
  const [src, setSrc] = useState<string | null>(isBlobUrl ? pathOrLabel : null);

  useEffect(() => {
    let cancelled = false;
    if (isBlobUrl) {
      setSrc(pathOrLabel);
      return;
    }
    if (!isFsPath || !runtime.isTauri) {
      setSrc(null);
      return;
    }
    import('@tauri-apps/api/core')
      .then(({ convertFileSrc }) => {
        if (!cancelled) setSrc(convertFileSrc(pathOrLabel));
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pathOrLabel, isFsPath, isBlobUrl]);

  return src;
}

function FileDownloadBlock({
  filename,
  sizeBytes,
  pathOrLabel,
}: {
  filename: string;
  sizeBytes: number;
  pathOrLabel: string;
}) {
  const isBlobUrl = pathOrLabel.startsWith('blob:') || pathOrLabel.startsWith('http:') || pathOrLabel.startsWith('https:');
  const isPath = !isBlobUrl && (pathOrLabel.startsWith('/') || /^[a-zA-Z]:\\/.test(pathOrLabel) || pathOrLabel.includes('\\'));
  const sizeLabel = formatFileSize(sizeBytes);
  const mediaKind = getMediaKind(filename);
  const mediaSrc = useMediaSrc(pathOrLabel);

  // Previsualización reproducible: disponible cuando tenemos una URL
  // navegable (blob: en navegador, o asset: vía convertFileSrc en Tauri).
  if (mediaKind !== 'other' && mediaSrc) {
    return (
      <div className="my-2" style={{ maxWidth: '420px' }}>
        {mediaKind === 'image' && (
          <img
            src={mediaSrc}
            alt={filename}
            className="rounded-codex border border-border max-w-full max-h-[360px] object-contain"
            style={{ borderRadius: '10px' }}
          />
        )}
        {mediaKind === 'audio' && (
          <audio src={mediaSrc} controls className="w-full" style={{ height: '38px' }} />
        )}
        {mediaKind === 'video' && (
          <video
            src={mediaSrc}
            controls
            className="rounded-codex border border-border max-w-full max-h-[360px]"
            style={{ borderRadius: '10px' }}
          />
        )}
        <div className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
          <span className="truncate">{filename}</span>
          <span>· {sizeLabel}</span>
          <span className="inline-flex items-center gap-1 text-success ml-auto shrink-0">
            <Check size={11} /> {isBlobUrl ? 'Listo' : 'Guardado'}
          </span>
          {isBlobUrl && (
            <a
              href={mediaSrc}
              download={filename}
              className="inline-flex items-center gap-1 text-accent hover:underline shrink-0"
            >
              <Download size={11} /> Descargar
            </a>
          )}
        </div>
      </div>
    );
  }

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
    case 'memory_save_fact':
    case 'memory_list_facts':
    case 'memory_delete_fact':
      return <BookMarked size={size} />;
    case 'project_memory_save':
    case 'project_memory_list':
    case 'project_memory_delete':
      return <BrainIcon size={size} />;
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
    case 'memory_save_fact':
    case 'memory_list_facts':
    case 'memory_delete_fact':
      return '#22d3ee';
    case 'project_memory_save':
    case 'project_memory_list':
    case 'project_memory_delete':
      return 'var(--accent-strong)';
    default:
      return 'var(--text-muted)';
  }
}

function MarkdownText({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
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
        // Permite HTML crudo del agente (tablas, divs, detalles, estilos inline).
        // rehypeRaw ya parsea el HTML embebido en markdown.
        div: ({ children, ...props }) => <div {...props}>{children}</div>,
        span: ({ children, ...props }) => <span {...props}>{children}</span>,
        details: ({ children, ...props }) => (
          <details className="mb-3 border border-border rounded-codex p-2" {...props}>
            {children}
          </details>
        ),
        summary: ({ children }) => (
          <summary className="cursor-pointer text-sm font-medium text-text-primary">
            {children}
          </summary>
        ),
        button: ({ children, ...props }) => (
          <button
            type="button"
            className="px-2 py-0.5 rounded bg-accent/15 text-accent text-xs hover:bg-accent/25 transition-colors"
            {...props}
          >
            {children}
          </button>
        ),
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
