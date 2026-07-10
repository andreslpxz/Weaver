import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/components/common/Button';
import type { Message } from '@/providers/types';
import { useWeaver } from '@/store/weaver';
import type { Subtask, TraceStep } from '@/agent/types';
import { CheckCircle2, Circle, Loader2, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

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
          <MessageBubble key={i} msg={msg} />
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
        <Suggestion
          text="Abre gedit y escribe 'Hola desde Weaver', luego guárdalo en ~/weaver-test.txt"
        />
        <Suggestion text="Copia el contenido de la ventana activa y pégalo en un nuevo correo" />
        <Suggestion text="Lee los títulos de las pestañas abiertas en Firefox" />
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
  return (
    <div
      className={cn(
        'selectable',
        isUser && 'flex justify-end',
        isTool && 'text-xs text-text-muted font-mono',
      )}
    >
      {isUser ? (
        <div className="bg-app-elevated border border-border rounded-codex px-3 py-2 max-w-[80%]">
          <div className="text-sm whitespace-pre-wrap">{msg.content}</div>
        </div>
      ) : isTool ? (
        <div className="border-l-2 border-border-accent pl-2 py-1">
          <div className="text-xs opacity-70 mb-1">tool result</div>
          <div className="whitespace-pre-wrap">{msg.content}</div>
        </div>
      ) : (
        <div className="max-w-none text-sm leading-relaxed">
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
                  <code
                    className="px-1 py-0.5 rounded bg-app-elevated text-xs font-mono"
                    {...props}
                  >
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
            }}
          >
            {msg.content}
          </ReactMarkdown>
        </div>
      )}
    </div>
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
