/**
 * Pestaña Chat del Notebook. Visualmente similar al chat principal de
 * Weaver, pero con su propio motor (chatEngine.ts) y el menú "+" propio con
 * herramientas de búsqueda y carga de fuentes. El selector de modelo es
 * intencionalmente el mismo componente y el mismo estado global que usa el
 * chat principal de Weaver (un solo modelo activo para toda la app).
 */

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, ChevronDown, Loader2, Search, BookOpen, Square } from 'lucide-react';
import type { Notebook, NotebookChatMessage, NotebookToolMode } from '../types';
import { NotebookComposerMenu } from './NotebookComposerMenu';
import { fileToSource, urlToSource } from '../sources';
import { runNotebookChat, toProviderMessages } from '../chatEngine';
import * as store from '../store';
import { cn } from '@/components/common/Button';
import { useWeaver } from '@/store/weaver';
import { getProvider } from '@/providers/registry';
import { ModelPickerPopup } from '@/components/model-picker/ModelPickerPopup';

export function NotebookChatPanel({ notebook }: { notebook: Notebook }) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeTool, setActiveTool] = useState<NotebookToolMode | null>(null);
  const [liveTrace, setLiveTrace] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Mismo modelo global que el chat principal de Weaver (no hay override
  // por notebook): mismos modelos, mismo popup, misma posición relativa.
  const providerId = useWeaver((s) => s.providerId);
  const modelId = useWeaver((s) => s.modelId);
  const modelPickerOpen = useWeaver((s) => s.modelPickerOpen);
  const setModelPickerOpen = useWeaver((s) => s.setModelPickerOpen);
  const provider = getProvider(providerId);
  const modelLabel = provider?.models.find((m) => m.id === modelId)?.label ?? modelId;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [notebook.chat.length, streamingText]);

  async function handleAddFiles(files: FileList) {
    for (const file of Array.from(files)) {
      const source = await fileToSource(file);
      store.addSource(notebook.id, source);
    }
  }

  async function handleAddUrl(url: string) {
    const source = await urlToSource(url);
    store.addSource(notebook.id, source);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    setLiveTrace([]);
    setStreamingText('');

    const userMsg: NotebookChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      toolUsed: activeTool ?? undefined,
      createdAt: Date.now(),
    };
    store.appendChatMessage(notebook.id, userMsg);

    const history = toProviderMessages(
      notebook.chat.map((m) => ({ role: m.role, content: m.content, isError: m.isError })),
    );

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await runNotebookChat({
        notebook,
        userMessage: text,
        history,
        toolMode: activeTool,
        providerId,
        modelId,
        signal: controller.signal,
        onChunk: (chunk) => {
          if (chunk.type === 'delta') setStreamingText((prev) => prev + chunk.content);
        },
        onToolTrace: (trace) => setLiveTrace(trace),
      });

      const assistantMsg: NotebookChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.content,
        toolUsed: activeTool ?? undefined,
        toolTrace: result.toolTrace.length > 0 ? result.toolTrace : undefined,
        citedSourceIds: result.usedSourceIds.length > 0 ? result.usedSourceIds : undefined,
        excludedSourceIds: result.excludedSourceIds.length > 0 ? result.excludedSourceIds : undefined,
        createdAt: Date.now(),
      };
      store.appendChatMessage(notebook.id, assistantMsg);
    } catch (e) {
      const errMsg: NotebookChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `⚠️ Error al generar la respuesta: ${e instanceof Error ? e.message : String(e)}`,
        isError: true,
        createdAt: Date.now(),
      };
      store.appendChatMessage(notebook.id, errMsg);
    } finally {
      setSending(false);
      setStreamingText('');
      setLiveTrace([]);
      setActiveTool(null);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full flex-col">
      {/* Barra superior: mismo selector de modelo que el chat principal, centrado */}
      <div className="relative flex items-center justify-center border-b border-border py-3">
        <button
          onClick={() => setModelPickerOpen(!modelPickerOpen)}
          className="composer-model-picker inline-flex items-center gap-1.5 px-3 py-1.5 rounded-codex border border-border-accent text-xs text-text-primary hover:bg-app-elevated transition-colors cursor-pointer"
          title="Cambiar modelo"
        >
          <span className="opacity-70">{provider?.label.split(' ')[0]}</span>
          <span className="font-medium">{modelLabel}</span>
          <ChevronDown size={12} className="opacity-60" />
        </button>
        {modelPickerOpen && <ModelPickerPopup onClose={() => setModelPickerOpen(false)} />}
      </div>

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        {notebook.chat.length === 0 && !sending && <WelcomeMessage hasSources={notebook.sources.length > 0} />}

        <div className="mx-auto max-w-2xl space-y-4">
          {notebook.chat.map((m) => (
            <ChatBubble key={m.id} message={m} sources={notebook.sources} />
          ))}

          {sending && (
            <div className="flex flex-col gap-1.5">
              {liveTrace.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg bg-app-elevated/60 px-3 py-2 text-xs text-text-tertiary">
                  {liveTrace.map((t, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Search size={12} />
                      {t}
                    </div>
                  ))}
                </div>
              )}
              <div className="rounded-2xl bg-app-elevated px-4 py-3 text-sm">
                {streamingText ? (
                  <MarkdownBody text={streamingText} />
                ) : (
                  <Loader2 size={16} className="animate-spin text-text-tertiary" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border border-border bg-app-elevated p-2">
          <NotebookComposerMenu
            activeTool={activeTool}
            onSelectTool={setActiveTool}
            onAddFiles={handleAddFiles}
            onAddUrl={handleAddUrl}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              activeTool === 'deep_research'
                ? 'Investigación profunda: escribe tu pregunta...'
                : activeTool === 'quick_search'
                  ? 'Búsqueda rápida: escribe tu pregunta...'
                  : 'Pregunta sobre tus fuentes...'
            }
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-text-tertiary"
          />
          {sending ? (
            <button
              onClick={handleStop}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger hover:bg-danger/25"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-30"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        {activeTool && (
          <div className="mx-auto mt-1.5 max-w-2xl px-1 text-xs text-accent">
            {activeTool === 'deep_research' ? 'Investigación profunda activa' : 'Búsqueda rápida activa'} para el próximo mensaje
          </div>
        )}
      </div>
    </div>
  );
}

function WelcomeMessage({ hasSources }: { hasSources: boolean }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <BookOpen size={14} />
        </span>
        <div className="max-w-[85%] rounded-2xl bg-app-elevated px-4 py-3 text-sm text-text-primary">
          <MarkdownBody
            text={
              hasSources
                ? `¡Hola! Soy tu guía en este notebook.\n\nYa tienes fuentes cargadas: cuando me preguntes algo, respondo basándome en ellas y te digo de cuál viene cada dato. También puedo cruzar información entre varias fuentes para encontrar patrones o contradicciones.\n\nSi necesitas información que no está en tus fuentes, usa el botón **"+"** para activar **búsqueda rápida** (una consulta, respuesta inmediata) o **investigación profunda** (varias búsquedas y lectura completa de las mejores fuentes) antes de preguntar.\n\n¿Qué quieres saber?`
                : `¡Hola! Soy tu guía en este notebook.\n\nMi función principal es trabajar directamente con **tus fuentes**: una vez que cargues documentos (PDFs, Markdown, DOCX o URLs) en la pestaña **Fuentes**, respondo basándome en ellos y te indico de cuál fuente viene cada dato.\n\nSi todavía no tienes archivos a mano, ve a la pestaña **Fuentes** y usa el buscador integrado (Fast Research o Deep Research) para encontrar e importar fuentes confiables de la web.\n\nTambién puedes usar el botón **"+"** aquí en el chat para hacer una búsqueda puntual sin necesidad de importarla como fuente.\n\n¿Sobre qué tema quieres investigar?`
            }
          />
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message, sources }: { message: NotebookChatMessage; sources: Notebook['sources'] }) {
  const isUser = message.role === 'user';
  const citedNames = (message.citedSourceIds ?? [])
    .map((id) => sources.find((s) => s.id === id)?.name)
    .filter((n): n is string => Boolean(n));
  const excludedCount = message.excludedSourceIds?.length ?? 0;

  return (
    <div className={cn('flex flex-col', isUser ? 'items-end' : 'items-start')}>
      {message.toolTrace && message.toolTrace.length > 0 && (
        <div className="mb-1 flex flex-col gap-1 rounded-lg bg-app-elevated/60 px-3 py-2 text-xs text-text-tertiary max-w-[85%]">
          {message.toolTrace.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Search size={12} />
              {t}
            </div>
          ))}
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
          isUser ? 'bg-accent text-white' : message.isError ? 'bg-danger/10 text-danger' : 'bg-app-elevated text-text-primary',
        )}
      >
        {isUser ? <span className="whitespace-pre-wrap">{message.content}</span> : <MarkdownBody text={message.content} />}
      </div>
      {!isUser && (citedNames.length > 0 || excludedCount > 0) && (
        <div className="mt-1.5 flex max-w-[85%] flex-wrap gap-1.5">
          {citedNames.map((name, i) => (
            <span
              key={i}
              className="rounded-full border border-border bg-app-elevated/60 px-2 py-0.5 text-[11px] text-text-tertiary"
              title="Fuente usada para esta respuesta"
            >
              📄 {name}
            </span>
          ))}
          {excludedCount > 0 && (
            <span
              className="rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] text-warning"
              title="No cupieron en el contexto del modelo para este turno"
            >
              +{excludedCount} fuente{excludedCount !== 1 ? 's' : ''} no incluida{excludedCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function MarkdownBody({ text }: { text: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none prose-p:my-1.5 prose-headings:my-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
