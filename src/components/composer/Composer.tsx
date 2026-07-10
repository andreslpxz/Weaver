import { useEffect, useRef, useState } from 'react';
import { Plus, Mic, ArrowUp, Square, ChevronDown, Settings2 } from 'lucide-react';
import { useWeaver } from '@/store/weaver';
import { getProvider } from '@/providers/registry';
import { IconButton, Button } from '@/components/common/Button';
import { ModelPickerPopup } from '@/components/model-picker/ModelPickerPopup';
import { createProvider } from '@/providers';
import { runAgent } from '@/agent/loop';
import { streamChat } from '@/lib/chain';
import type { Message } from '@/providers/types';

export function Composer() {
  const [value, setValue] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

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

  async function handleSend() {
    if (!value.trim() || isRunning) return;
    let convId = activeConversationId;
    if (!convId) convId = newConversation();

    const userMsg: Message = { role: 'user', content: value };
    appendMessage(userMsg);
    const objectiveText = value;
    setValue('');
    setIsRunning(true);
    setAgentState('planning');

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const llm = await createProvider(providerId);
      // Detectar si es una tarea agéntica o un chat simple.
      // Heurística: si menciona "abre", "escribe en", "copia", "pega", "transfiere" → agéntico.
      const agentive = /\b(abre|escribe en|copia|pega|transfiere|envía|completa|rellena|sube|baja)\b/i.test(
        objectiveText,
      );

      if (agentive) {
        appendMessage({ role: 'assistant', content: '' });
        for await (const event of runAgent(llm, modelId, objectiveText, {
          signal: ac.signal,
          onEvent: handleAgentEvent,
        })) {
          // los eventos se manejan via handleAgentEvent
        }
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
        // Si trae marcador CONTINUE, seguir encadenando.
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

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        <div className="codex-input rounded-codex border border-border-accent p-2 flex flex-col gap-2">
          {/* Top row: + adjuntar (placeholder) */}
          <div className="flex items-center gap-2 px-1">
            <IconButton title="Adjuntar" className="w-6 h-6">
              <Plus size={14} />
            </IconButton>
            <span className="text-xs text-text-muted">Seleccionar archivo</span>
          </div>

          {/* Textarea */}
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Dime lo que quieres hacer…"
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

            <IconButton title="Configurar API key" className="w-6 h-6" onClick={() => setModelPickerOpen(true)}>
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
                disabled={!value.trim()}
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
            Weaver puede equivocarse. Verifica acciones críticas.
          </span>
        </div>
      </div>
    </div>
  );
}
