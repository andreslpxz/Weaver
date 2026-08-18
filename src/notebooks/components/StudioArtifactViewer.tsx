/**
 * Renderiza un StudioArtifact ya generado, según su outputFormat:
 *  - markdown → prosa renderizada (resumen, informe, guía de estudio, infografía)
 *  - mermaid  → diagrama vía iframe + CDN de mermaid.js (mismo patrón que
 *               ya usa el chat principal de Weaver en MessageList.tsx)
 *  - json     → interpretado según kind: flashcards interactivas, quiz
 *               interactivo, o tabla de datos
 */

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronLeft, ChevronRight, RotateCw, Check, X as XIcon, AlertCircle } from 'lucide-react';
import type { StudioArtifact } from '../types';
import { cn } from '@/components/common/Button';

export function StudioArtifactViewer({ artifact }: { artifact: StudioArtifact }) {
  if (artifact.outputFormat === 'markdown') return <MarkdownArtifact content={artifact.content} />;
  if (artifact.outputFormat === 'mermaid') return <MermaidArtifact content={artifact.content} />;
  if (artifact.kind === 'flashcards') return <FlashcardsArtifact content={artifact.content} />;
  if (artifact.kind === 'quiz') return <QuizArtifact content={artifact.content} />;
  if (artifact.kind === 'data_table') return <DataTableArtifact content={artifact.content} />;
  return <MarkdownArtifact content={artifact.content} />;
}

function MarkdownArtifact({ content }: { content: string }) {
  return (
    <div className="prose prose-sm prose-invert max-w-none p-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function MermaidArtifact({ content }: { content: string }) {
  const srcDoc = useMemo(
    () => `<!doctype html><html><head><style>
      html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;
        background:#fff;font-family:-apple-system,system-ui,sans-serif;overflow:auto;padding:1rem;box-sizing:border-box;}
      #err{color:#b91c1c;font-size:13px;display:none;}
    </style></head><body>
      <div class="mermaid" id="dgm">${escapeHtml(content)}</div>
      <div id="err">No se pudo cargar el renderizador de diagramas (sin conexión a internet).</div>
      <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js" onerror="document.getElementById('dgm').style.display='none';document.getElementById('err').style.display='block';"></script>
      <script>
        window.addEventListener('load', function() {
          if (window.mermaid) { mermaid.initialize({ startOnLoad: true, theme: 'default' }); }
        });
      </script>
    </body></html>`,
    [content],
  );
  return <iframe title="Mapa mental" srcDoc={srcDoc} className="h-[500px] w-full rounded-b-xl border-0" sandbox="allow-scripts" />;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tryParseJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function FlashcardsArtifact({ content }: { content: string }) {
  const data = tryParseJson<{ cards: Array<{ front: string; back: string }> }>(content);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  if (!data?.cards?.length) return <ParseErrorNotice raw={content} />;
  const card = data.cards[index];

  return (
    <div className="flex flex-col items-center p-4">
      <button
        onClick={() => setFlipped((f) => !f)}
        className="flex h-48 w-full max-w-md items-center justify-center rounded-xl border border-border bg-app-panel px-6 text-center text-sm hover:border-accent/50"
      >
        {flipped ? card.back : card.front}
      </button>
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => {
            setIndex((i) => Math.max(0, i - 1));
            setFlipped(false);
          }}
          disabled={index === 0}
          className="rounded-full p-2 text-text-secondary hover:bg-app-elevated disabled:opacity-30"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-xs text-text-tertiary">
          {index + 1} / {data.cards.length}
        </span>
        <button
          onClick={() => setFlipped((f) => !f)}
          className="rounded-full p-2 text-text-secondary hover:bg-app-elevated"
          title="Voltear"
        >
          <RotateCw size={14} />
        </button>
        <button
          onClick={() => {
            setIndex((i) => Math.min(data.cards.length - 1, i + 1));
            setFlipped(false);
          }}
          disabled={index === data.cards.length - 1}
          className="rounded-full p-2 text-text-secondary hover:bg-app-elevated disabled:opacity-30"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

function QuizArtifact({ content }: { content: string }) {
  const data = tryParseJson<{
    questions: Array<{ question: string; options: string[]; correctIndex: number; explanation?: string }>;
  }>(content);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  if (!data?.questions?.length) return <ParseErrorNotice raw={content} />;

  return (
    <div className="space-y-4 p-4">
      {data.questions.map((q, qi) => {
        const chosen = answers[qi];
        return (
          <div key={qi} className="rounded-xl border border-border bg-app-panel p-3">
            <div className="mb-2 text-sm font-medium text-text-primary">
              {qi + 1}. {q.question}
            </div>
            <div className="space-y-1.5">
              {q.options.map((opt, oi) => {
                const isChosen = chosen === oi;
                const isCorrect = oi === q.correctIndex;
                const revealed = chosen !== undefined;
                return (
                  <button
                    key={oi}
                    onClick={() => setAnswers((prev) => ({ ...prev, [qi]: oi }))}
                    disabled={revealed}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      !revealed && 'border-border hover:border-accent/50',
                      revealed && isCorrect && 'border-success/40 bg-success/10 text-success',
                      revealed && isChosen && !isCorrect && 'border-danger/40 bg-danger/10 text-danger',
                      revealed && !isChosen && !isCorrect && 'border-border opacity-50',
                    )}
                  >
                    {revealed && isCorrect && <Check size={13} />}
                    {revealed && isChosen && !isCorrect && <XIcon size={13} />}
                    {opt}
                  </button>
                );
              })}
            </div>
            {chosen !== undefined && q.explanation && (
              <div className="mt-2 text-xs text-text-tertiary">{q.explanation}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DataTableArtifact({ content }: { content: string }) {
  const data = tryParseJson<{ columns: string[]; rows: string[][] }>(content);
  if (!data || data.columns.length === 0) return <ParseErrorNotice raw={content} empty />;

  return (
    <div className="overflow-x-auto p-4">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {data.columns.map((c, i) => (
              <th key={i} className="px-3 py-2 font-medium text-text-secondary">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/50">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-text-primary">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ParseErrorNotice({ raw, empty }: { raw: string; empty?: boolean }) {
  return (
    <div className="p-4">
      <div className="mb-2 flex items-center gap-2 text-sm text-warning">
        <AlertCircle size={14} />
        {empty ? 'El modelo no encontró datos tabulables en las fuentes.' : 'No se pudo interpretar la respuesta del modelo como datos estructurados.'}
      </div>
      {!empty && (
        <pre className="max-h-64 overflow-auto rounded-lg bg-app-panel p-3 text-xs text-text-tertiary whitespace-pre-wrap">
          {raw}
        </pre>
      )}
    </div>
  );
}
