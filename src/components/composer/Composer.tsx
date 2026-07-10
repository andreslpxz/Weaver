import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Plus,
  Mic,
  ArrowUp,
  Square,
  ChevronDown,
  UploadCloud,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Folder,
  Link as LinkIcon,
  Globe,
  AtSign,
  Brain,
} from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import { getProvider, PROVIDERS } from '@/providers/registry';
import { IconButton, Button } from '@/components/common/Button';
import { ModelPickerPopup } from '@/components/model-picker/ModelPickerPopup';
import { AttachmentChips } from '@/components/composer/AttachmentChips';
import { createProvider } from '@/providers';
import { runAgent } from '@/agent/loop';
import { streamChat, streamUntilDone } from '@/lib/chain';
import {
  fileToAttachment,
  buildMessageWithAttachments,
  getFilesFromDrop,
} from '@/lib/attachments';
import { runtime } from '@/lib/tauri';
import type { Message, ImageContent } from '@/providers/types';
import type { Attachment } from '@/lib/attachments';
import { skillsRegistry } from '@/skills/registry';
import type { Skill } from '@/skills/registry';

const newMsgId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function Composer() {
  const [value, setValue] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const plusBtnRef = useRef<HTMLButtonElement>(null);

  const {
    providerId,
    modelId,
    setModelPickerOpen,
    modelPickerOpen,
    appendMessage,
    updateLastAssistantMessage,
    setAgentState,
    handleAgentEvent,
    activeConversationId,
    newConversation,
    draftAttachments,
    addDraftAttachments,
    removeDraftAttachment,
    clearDraftAttachments,
  } = useWeaver();

  // Cargar skills para el menú @
  useEffect(() => {
    skillsRegistry.loadAll().then(setSkills).catch(() => setSkills([]));
  }, []);

  // Autosize textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  // Escuchar sugerencias de la UI
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setValue(text);
      taRef.current?.focus();
    };
    window.addEventListener('weaver:set-composer', handler as EventListener);
    return () => window.removeEventListener('weaver:set-composer', handler as EventListener);
  }, []);

  // Cerrar popup + al hacer click fuera
  useEffect(() => {
    if (!plusOpen) return;
    const handler = (e: MouseEvent) => {
      if (plusBtnRef.current && !plusBtnRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [plusOpen]);

  const provider = getProvider(providerId);
  const modelLabel = provider?.models.find((m) => m.id === modelId)?.label ?? modelId;

  // --- Detección de @ en el texto -------------------------------------------
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const before = value.slice(0, cursor);
    // Buscar último @ que no esté precedido por otro caracter no-espacio
    const atMatch = before.match(/(?:^|\s)@([\w\-/]*)$/);
    if (atMatch) {
      setMentionOpen(true);
      setMentionQuery(atMatch[1]);
      setMentionIndex(0);
      // Construir items
      const q = atMatch[1].toLowerCase();
      const items: MentionItem[] = [];
      // Skills
      for (const s of skills) {
        if (!q || s.name.toLowerCase().includes(q)) {
          items.push({
            type: 'skill',
            label: s.name,
            desc: s.description,
            icon: 'brain',
            insert: `@skill:${s.name}`,
          });
        }
      }
      // Proveedores
      for (const p of PROVIDERS) {
        if (!q || p.label.toLowerCase().includes(q) || p.id.includes(q)) {
          items.push({
            type: 'provider',
            label: p.label,
            desc: p.desc,
            icon: 'globe',
            insert: `@provider:${p.id}`,
          });
        }
      }
      // Adjuntos recientes (referencias)
      for (const a of draftAttachments) {
        if (!q || a.name.toLowerCase().includes(q)) {
          items.push({
            type: 'file',
            label: a.name,
            desc: `${a.kind} · ${a.size} B`,
            icon: a.kind === 'image' ? 'image' : 'file',
            insert: `@file:${a.name}`,
          });
        }
      }
      // Comandos rápidos
      if (!q || 'web'.includes(q)) {
        items.push({ type: 'command', label: 'Buscar en internet', desc: 'web_search', icon: 'globe', insert: 'busca en internet ' });
      }
      if (!q || 'shell'.includes(q) || 'terminal'.includes(q)) {
        items.push({ type: 'command', label: 'Ejecutar comando shell', desc: 'shell_exec (Tauri)', icon: 'file', insert: 'ejecuta en la terminal: ' });
      }
      setMentionItems(items.slice(0, 12));
    } else {
      setMentionOpen(false);
    }
  }, [value, skills, draftAttachments]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setAttachmentError(null);
      const newAtts: Attachment[] = [];
      const errors: string[] = [];
      for (const f of files) {
        try {
          const att = await fileToAttachment(f);
          newAtts.push(att);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (newAtts.length > 0) addDraftAttachments(newAtts);
      if (errors.length > 0) setAttachmentError(errors.join('\n'));
    },
    [addDraftAttachments],
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    addFiles(files);
    e.target.value = '';
    setPlusOpen(false);
  };

  // --- Drag & Drop ----------------------------------------------------------
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounterRef.current += 1;
      setIsDragOver(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = getFilesFromDrop(e);
    addFiles(files);
  };

  // --- Envío ---------------------------------------------------------------
  async function handleSend() {
    if ((!value.trim() && draftAttachments.length === 0) || isRunning) return;
    let convId = activeConversationId;
    if (!convId) convId = newConversation();

    const built = buildMessageWithAttachments(value, draftAttachments);
    // Construir lista de imágenes (data URLs) para multimodal real.
    const images: ImageContent[] = draftAttachments
      .filter((a) => a.kind === 'image' && a.content)
      .map((a) => ({
        dataUrl: a.content!,
        mime: a.mime.startsWith('image/') ? a.mime : 'image/png',
        name: a.name,
      }));

    const userMsg: Message = {
      id: newMsgId(),
      ts: Date.now(),
      role: 'user',
      content: built.toUI,
      attachments: draftAttachments.map((a) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        size: a.size,
        mime: a.mime,
        truncated: a.truncated,
      })),
      images: images.length > 0 ? images : undefined,
    };
    appendMessage(userMsg);
    const objectiveText = built.toLLM;
    setValue('');
    clearDraftAttachments();
    setIsRunning(true);
    setAgentState('planning');

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const llm = await createProvider(providerId);
      const agentive = /\b(abre|escribe en|copia|pega|transfiere|envía|completa|rellena|sube|baja|ejecuta|instala|busca en internet|lee el archivo|crea el archivo)\b/i.test(
        objectiveText,
      );

      if (agentive && runtime.isTauri) {
        appendMessage({ role: 'assistant', content: '' });
        for await (const _event of runAgent(llm, modelId, objectiveText, {
          signal: ac.signal,
          onEvent: handleAgentEvent,
        })) {
          void _event;
        }
      } else if (agentive && runtime.isBrowser) {
        await runChatWithTools(llm, objectiveText, images, ac.signal);
      } else {
        appendMessage({ role: 'assistant', content: '', id: newMsgId(), ts: Date.now() });
        const messages: Message[] = [
          {
            role: 'system',
            content:
              'Eres Weaver, un asistente de escritorio amable y conciso. Si tu respuesta se acerca al límite de tokens, termina con la línea exacta <<CONTINUE>>. Al terminar del todo, emite <<END>>.',
          },
          { role: 'user', content: objectiveText, images: images.length > 0 ? images : undefined },
        ];
        await streamUntilDone(llm, modelId, messages, {
          maxChains: 5,
          signal: ac.signal,
          onDelta: (delta) => updateLastAssistantMessage(delta),
        });
      }
    } catch (e) {
      appendMessage({
        role: 'assistant',
        content: `❌ Error: ${e instanceof Error ? e.message : String(e)}`,
      });
      setAgentState('error');
    } finally {
      setIsRunning(false);
      abortRef.current = null;
      setAgentState('idle');
    }
  }

  async function runChatWithTools(
    llm: import('@/providers/types').LLMProvider,
    userText: string,
    images: ImageContent[],
    signal: AbortSignal,
  ) {
    const { buildAdvancedToolsList, dispatchAdvancedTool } = await import('@/lib/tools');
    const { streamChat } = await import('@/lib/chain');

    appendMessage({ role: 'assistant', content: '', id: newMsgId(), ts: Date.now() });
    const messages: Message[] = [
      {
        role: 'system',
        content:
          'Eres Weaver, un asistente de escritorio. Tienes acceso a tools para buscar en internet, ejecutar comandos shell y leer/escribir archivos. ' +
          'Si el usuario pide algo que requiere una tool, úsala. Si no, responde normal.\n' +
          'Si tu respuesta se acerca al límite de tokens, termina con <<CONTINUE>>. Al terminar del todo, emite <<END>>.',
      },
      { role: 'user', content: userText, images: images.length > 0 ? images : undefined },
    ];

    const tools = buildAdvancedToolsList();
    const MAX_TOOL_ROUNDS = 6;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await streamChat(llm, modelId, messages, {
        tools,
        signal,
        onDelta: (delta) => updateLastAssistantMessage(delta),
      });

      if (result.toolCalls.length === 0) {
        return;
      }

      messages.push({
        role: 'assistant',
        content: result.text || '',
        tool_calls: result.toolCalls,
      });

      for (const tc of result.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || '{}');
        } catch {
          // ignore
        }
        const toolResult = await dispatchAdvancedTool(tc.function.name, args);
        const summary = toolResult.ok
          ? toolResult.output.slice(0, 4000)
          : `ERROR: ${toolResult.error ?? 'unknown'}`;
        updateLastAssistantMessage(`\n\n[tool ${tc.function.name}: ${summary.slice(0, 200)}…]\n`);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: summary,
        });
      }
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setIsRunning(false);
  }

  // --- Mención seleccionada -------------------------------------------------
  function applyMention(item: MentionItem) {
    const ta = taRef.current;
    if (!ta) return;
    const cursor = ta.selectionStart;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    // Reemplazar el último @query con el insert del item
    const atIdx = before.search(/(?:^|\s)@[\w\-/]*$/);
    if (atIdx < 0) return;
    const prefix = before.slice(0, atIdx).trimEnd();
    const newValue = (prefix ? prefix + ' ' : '') + item.insert + ' ' + after;
    setValue(newValue);
    setMentionOpen(false);
    // Posicionar cursor después del insert
    setTimeout(() => {
      if (taRef.current) {
        const pos = (prefix ? prefix.length + 1 : 0) + item.insert.length + 1;
        taRef.current.selectionStart = pos;
        taRef.current.selectionEnd = pos;
        taRef.current.focus();
      }
    }, 0);
  }

  // --- Render ---------------------------------------------------------------
  const placeholder =
    draftAttachments.length > 0
      ? 'Añade contexto o instrucciones sobre los archivos…'
      : 'Dime lo que quieres hacer… (usa @ para mencionar skills, proveedores, archivos)';

  return (
    <div className="px-4 pb-4 pt-2 relative">
      <div className="max-w-3xl mx-auto relative">
        {/* Drag overlay */}
        {isDragOver && (
          <div
            className="absolute inset-0 z-20 rounded-codex border-2 border-dashed border-accent bg-accent/10 flex items-center justify-center pointer-events-none"
            style={{ margin: '-4px' }}
          >
            <div className="flex items-center gap-2 text-accent-strong">
              <UploadCloud size={20} />
              <span className="font-medium text-sm">
                Suelta para adjuntar {dragCounterRef.current > 1 ? `${dragCounterRef.current} archivos` : 'el archivo'}
              </span>
            </div>
          </div>
        )}

        <div
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`codex-input rounded-codex border p-2 flex flex-col gap-2 transition-colors ${
            isDragOver ? 'border-accent bg-accent/5' : 'border-border-accent'
          }`}
        >
          {/* Attachment chips (si hay) */}
          {draftAttachments.length > 0 && (
            <div className="px-1 pt-1">
              <AttachmentChips
                attachments={draftAttachments}
                onRemove={removeDraftAttachment}
              />
            </div>
          )}

          {/* Error de adjuntos */}
          {attachmentError && (
            <div className="mx-1 px-2 py-1.5 rounded-codex bg-danger/10 border border-danger/30 text-danger text-xs whitespace-pre-wrap">
              {attachmentError}
            </div>
          )}

          {/* Top row: botón + con popup (estilo Codex) */}
          <div className="flex items-center gap-2 px-1 relative">
            <button
              ref={plusBtnRef}
              onClick={() => setPlusOpen((v) => !v)}
              className="codex-icon-btn w-7 h-7"
              title="Añadir (archivo, carpeta, URL…)"
            >
              <Plus size={16} />
            </button>

            {plusOpen && (
              <div className="absolute top-9 left-1 z-30 w-64 bg-app-elevated border border-border-accent rounded-codex shadow-2xl animate-slide-up overflow-hidden">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                >
                  <FileText size={14} className="text-accent" />
                  <div>
                    <div className="font-medium">Subir archivo</div>
                    <div className="text-[10px] text-text-muted">Texto, imagen o binario</div>
                  </div>
                </button>
                <button
                  onClick={() => {
                    // Carpeta: usar input con webkitdirectory
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.setAttribute('webkitdirectory', '');
                    input.setAttribute('directory', '');
                    input.multiple = true;
                    input.onchange = (e) => {
                      const files = Array.from((e.target as HTMLInputElement).files ?? []);
                      addFiles(files);
                      setPlusOpen(false);
                    };
                    input.click();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                >
                  <Folder size={14} className="text-accent" />
                  <div>
                    <div className="font-medium">Subir carpeta</div>
                    <div className="text-[10px] text-text-muted">Todos los archivos recursivamente</div>
                  </div>
                </button>
                <button
                  onClick={async () => {
                    const url = prompt('URL del archivo a descargar:');
                    if (!url) return;
                    setPlusOpen(false);
                    try {
                      const resp = await fetch(url);
                      const blob = await resp.blob();
                      const name = url.split('/').pop()?.split('?')[0] ?? 'download';
                      const file = new File([blob], name, { type: blob.type });
                      await addFiles([file]);
                    } catch (e) {
                      setAttachmentError(`No se pudo descargar: ${e instanceof Error ? e.message : String(e)}`);
                    }
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-app-input transition-colors text-left"
                >
                  <LinkIcon size={14} className="text-accent" />
                  <div>
                    <div className="font-medium">Añadir desde URL</div>
                    <div className="text-[10px] text-text-muted">Descarga y adjunta</div>
                  </div>
                </button>
                <div className="border-t border-border" />
                <div className="px-3 py-1.5 text-[10px] text-text-muted uppercase tracking-wider">
                  También puedes arrastrar archivos
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
              accept=".txt,.md,.markdown,.json,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.html,.htm,.css,.scss,.yml,.yaml,.toml,.ini,.cfg,.sh,.bash,.zsh,.sql,.csv,.tsv,.xml,.svg,.log,.env,.png,.jpg,.jpeg,.gif,.webp,.bmp"
            />

            <div className="flex-1" />
          </div>

          {/* Textarea con overlay de menciones @ */}
          <div className="relative">
            <textarea
              ref={taRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                // Navegación del menú @
                if (mentionOpen && mentionItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex((i) => (i + 1) % mentionItems.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    applyMention(mentionItems[mentionIndex]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    setMentionOpen(false);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onPaste={(e) => {
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                  e.preventDefault();
                  const arr: File[] = [];
                  for (let i = 0; i < files.length; i++) {
                    const f = files.item(i);
                    if (f) arr.push(f);
                  }
                  addFiles(arr);
                }
              }}
              placeholder={placeholder}
              className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none resize-none px-1 py-1 min-h-[28px] max-h-[200px]"
              rows={1}
            />

            {/* Menú @ flotante */}
            {mentionOpen && mentionItems.length > 0 && (
              <div className="absolute bottom-full left-1 mb-1 z-30 w-80 max-h-64 overflow-y-auto bg-app-elevated border border-border-accent rounded-codex shadow-2xl animate-slide-up">
                <div className="px-2 py-1 text-[10px] text-text-muted uppercase tracking-wider border-b border-border">
                  Menciones — skills, proveedores, archivos
                </div>
                {mentionItems.map((item, i) => (
                  <button
                    key={i}
                    onMouseEnter={() => setMentionIndex(i)}
                    onClick={() => applyMention(item)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                      i === mentionIndex ? 'bg-app-input' : 'hover:bg-app-input'
                    }`}
                  >
                    <MentionIcon icon={item.icon} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{item.label}</div>
                      <div className="text-[10px] text-text-muted truncate">{item.desc}</div>
                    </div>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-app-bg text-text-muted uppercase">
                      {item.type}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bottom row: model picker + clip + mic + send */}
          <div className="flex items-center gap-2 px-1">
            <button
              onClick={() => setModelPickerOpen(!modelPickerOpen)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-codex border border-border-accent text-xs text-text-primary hover:bg-app-elevated transition-colors cursor-pointer"
              title="Cambiar modelo"
            >
              <span className="opacity-70">{provider?.label.split(' ')[0]}</span>
              <span className="font-medium">{modelLabel}</span>
              <ChevronDown size={12} className="opacity-60" />
            </button>

            <div className="flex-1" />

            {/* Botón 📎 (clip) a la derecha */}
            <IconButton
              title="Adjuntar archivos"
              className="w-7 h-7"
              onClick={() => setPlusOpen((v) => !v)}
            >
              <Paperclip size={14} />
            </IconButton>

            <IconButton title="Voz" className="w-7 h-7">
              <Mic size={14} />
            </IconButton>

            {isRunning ? (
              <Button variant="danger" onClick={handleStop} className="!p-1.5">
                <Square size={14} fill="currentColor" />
              </Button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!value.trim() && draftAttachments.length === 0}
                className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-accent text-app-bg hover:bg-accent-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Enviar (Enter)"
              >
                <ArrowUp size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>

        {modelPickerOpen && <ModelPickerPopup onClose={() => setModelPickerOpen(false)} />}

        <div className="text-center mt-2">
          <span className="text-xs text-text-muted">
            {draftAttachments.length > 0
              ? `${draftAttachments.length} adjunto(s) · arrastrar más o pulsar + para añadir`
              : 'Weaver puede equivocarse. Verifica acciones críticas.'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tipos y helpers para menciones @
// ============================================================================

interface MentionItem {
  type: 'skill' | 'provider' | 'file' | 'command';
  label: string;
  desc: string;
  icon: 'brain' | 'globe' | 'file' | 'image';
  insert: string;
}

function MentionIcon({ icon }: { icon: MentionItem['icon'] }) {
  const props = { size: 14, className: 'text-accent shrink-0' };
  switch (icon) {
    case 'brain':
      return <Brain {...props} />;
    case 'globe':
      return <Globe {...props} />;
    case 'image':
      return <ImageIcon {...props} />;
    case 'file':
    default:
      return <FileText {...props} />;
  }
}

// Evitar import no usado
void AtSign;
