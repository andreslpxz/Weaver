import { useEffect, useRef, useState, useCallback } from 'react';
import { Plus, Mic, ArrowUp, Square, ChevronDown, Settings2, Paperclip, UploadCloud } from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import { getProvider } from '@/providers/registry';
import { IconButton, Button } from '@/components/common/Button';
import { ModelPickerPopup } from '@/components/model-picker/ModelPickerPopup';
import { AttachmentChips } from '@/components/composer/AttachmentChips';
import { createProvider } from '@/providers';
import { runAgent } from '@/agent/loop';
import { streamChat } from '@/lib/chain';
import {
  fileToAttachment,
  buildMessageWithAttachments,
  getFilesFromDrop,
  formatSize,
} from '@/lib/attachments';
import { runtime } from '@/lib/tauri';
import type { Message } from '@/providers/types';
import type { Attachment } from '@/lib/attachments';

export function Composer() {
  const [value, setValue] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

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

  // Autosize textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [value]);

  // Escuchar sugerencias de la UI (click en chips del empty state).
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setValue(text);
      taRef.current?.focus();
    };
    window.addEventListener('weaver:set-composer', handler as EventListener);
    return () => window.removeEventListener('weaver:set-composer', handler as EventListener);
  }, []);

  const provider = getProvider(providerId);
  const modelLabel = provider?.models.find((m) => m.id === modelId)?.label ?? modelId;

  // --- Manejo de archivos ----------------------------------------------------

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
    // Reset para permitir seleccionar el mismo archivo otra vez.
    e.target.value = '';
  };

  // --- Drag & Drop global sobre el composer ---------------------------------

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

    const finalText = buildMessageWithAttachments(value, draftAttachments);
    const userMsg: Message = { role: 'user', content: finalText || '(adjuntos sin texto)' };
    appendMessage(userMsg);
    const objectiveText = finalText;
    setValue('');
    clearDraftAttachments();
    setIsRunning(true);
    setAgentState('planning');

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const llm = await createProvider(providerId);
      // Detectar si es una tarea agéntica o un chat simple.
      const agentive = /\b(abre|escribe en|copia|pega|transfiere|envía|completa|rellena|sube|baja)\b/i.test(
        objectiveText,
      );

      if (agentive && runtime.isTauri) {
        appendMessage({ role: 'assistant', content: '' });
        for await (const _event of runAgent(llm, modelId, objectiveText, {
          signal: ac.signal,
          onEvent: handleAgentEvent,
        })) {
          // los eventos se manejan via handleAgentEvent
        }
      } else if (agentive && runtime.isBrowser) {
        appendMessage({
          role: 'assistant',
          content:
            '⚠️ Las tareas agénticas (abre, escribe en, copia, etc.) requieren el backend de Tauri.\n\n' +
            'Para ejecutarlas:\n' +
            '1. Instala las dependencias del sistema:\n' +
            '   `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev xdotool wmctrl`\n' +
            '2. Habilita accesibilidad AT-SPI:\n' +
            '   `gsettings set org.gnome.desktop.interface toolkit-accessibility true`\n' +
            '3. Ejecuta en modo Tauri: `npm run tauri:dev`\n\n' +
            'Mientras tanto puedo responder como chat normal si reformulas la petición.',
        });
      } else {
        // Chat simple con streaming y encadenamiento.
        appendMessage({ role: 'assistant', content: '' });
        const messages: Message[] = [
          {
            role: 'system',
            content:
              'Eres Weaver, un asistente de escritorio amable y conciso. Si tu respuesta se acerca al límite de tokens, termina con la línea exacta <<CONTINUE>>. Al terminar del todo, emite <<END>>.',
          },
          { role: 'user', content: objectiveText },
        ];
        const { text } = await streamChat(llm, modelId, messages, {
          signal: ac.signal,
          onDelta: (delta) => updateLastAssistantMessage(delta),
        });
        if (text.includes('<<CONTINUE>>')) {
          const { streamUntilDone } = await import('@/lib/chain');
          const full = await streamUntilDone(llm, modelId, messages, {
            maxChains: 5,
            signal: ac.signal,
            onDelta: (delta) => updateLastAssistantMessage(delta),
          });
          updateLastAssistantMessage(full.slice(text.length));
        }
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

  function handleStop() {
    abortRef.current?.abort();
    setIsRunning(false);
  }

  // --- Render --------------------------------------------------------------

  const placeholder =
    draftAttachments.length > 0
      ? 'Añade contexto o instrucciones sobre los archivos…'
      : 'Dime lo que quieres hacer…';

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

          {/* Top row: + adjuntar (file picker) */}
          <div className="flex items-center gap-2 px-1">
            <IconButton
              title="Adjuntar archivos"
              className="w-6 h-6"
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus size={14} />
            </IconButton>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            >
              {draftAttachments.length > 0
                ? `Adjuntar más (${draftAttachments.length})`
                : 'Seleccionar archivo'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
              accept=".txt,.md,.markdown,.json,.js,.jsx,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.hpp,.html,.htm,.css,.scss,.yml,.yaml,.toml,.ini,.cfg,.sh,.bash,.zsh,.sql,.csv,.tsv,.xml,.svg,.log,.env,.png,.jpg,.jpeg,.gif,.webp,.bmp"
            />

            {/* Indicador de modo runtime */}
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                runtime.isTauri
                  ? 'bg-success/15 text-success'
                  : 'bg-warning/15 text-warning'
              }`}
              title={runtime.describe()}
            >
              {runtime.isTauri ? 'Tauri' : 'Navegador'}
            </span>

            <div className="flex-1" />
            <IconButton
              title="Adjuntar (alternativa)"
              className="w-6 h-6"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={12} />
            </IconButton>
          </div>

          {/* Textarea */}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
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

          {/* Bottom row: model picker + mic + send */}
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

            <IconButton
              title="Configurar API key"
              className="w-6 h-6"
              onClick={() => setModelPickerOpen(true)}
            >
              <Settings2 size={12} />
            </IconButton>

            <div className="flex-1" />

            <IconButton title="Voz" className="w-6 h-6">
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
