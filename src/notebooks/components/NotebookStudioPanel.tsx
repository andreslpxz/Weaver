/**
 * Pestaña Studio (Fase 4).
 *
 * Genera artefactos reales llamando al modelo activo (mismo modelo global
 * que el chat, ver studioEngine.ts) con prompts especializados por tipo,
 * usando las fuentes del notebook como contexto grounded. Persisten en el
 * notebook (store.ts) y se listan; al seleccionar uno se renderiza con
 * StudioArtifactViewer.
 *
 * Limitación documentada: "Resumen en audio" y "Presentación narrada"
 * quedan deshabilitados porque requieren un servicio de texto a voz
 * multi-voz / generación de diapositivas que no existe en este proyecto.
 * No se simulan para no entregar algo que parezca funcionar y no lo haga.
 */

import { useEffect, useState } from 'react';
import {
  FileAudio,
  Presentation,
  Network,
  FileEdit,
  Layers,
  HelpCircle,
  Table2,
  Sparkles,
  FileText,
  Loader2,
  ArrowLeft,
  Trash2,
  AlertCircle,
} from 'lucide-react';
import type { Notebook, StudioArtifact, StudioArtifactKind } from '../types';
import { generateStudioArtifact, getArtifactSpec } from '../studioEngine';
import { StudioArtifactViewer } from './StudioArtifactViewer';
import * as store from '../store';
import { useWeaver } from '@/store/weaver';

const STUDIO_ITEMS: Array<{ kind: StudioArtifactKind; icon: typeof FileAudio; label: string }> = [
  { kind: 'mindmap', icon: Network, label: 'Mapa mental' },
  { kind: 'report', icon: FileEdit, label: 'Informe' },
  { kind: 'summary', icon: FileText, label: 'Resumen' },
  { kind: 'flashcards', icon: Layers, label: 'Tarjetas didácticas' },
  { kind: 'quiz', icon: HelpCircle, label: 'Cuestionario' },
  { kind: 'data_table', icon: Table2, label: 'Tabla de datos' },
  { kind: 'infographic', icon: Sparkles, label: 'Infografía' },
  { kind: 'study_guide', icon: FileText, label: 'Guía de estudio' },
];

const DISABLED_ITEMS = [
  { icon: FileAudio, label: 'Resumen en audio', note: 'Requiere un servicio de texto a voz multi-voz que este proyecto no integra todavía' },
  { icon: Presentation, label: 'Presentación narrada', note: 'Requiere generación de diapositivas + narración, no integrado todavía' },
];

export function NotebookStudioPanel({ notebook }: { notebook: Notebook }) {
  const [generating, setGenerating] = useState<StudioArtifactKind | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null);
  const providerId = useWeaver((s) => s.providerId);
  const modelId = useWeaver((s) => s.modelId);

  const readySources = notebook.sources.filter((s) => s.status === 'ready');
  const openArtifact = notebook.artifacts.find((a) => a.id === openArtifactId) ?? null;

  useEffect(() => {
    // Si el artefacto abierto fue borrado desde otra vista, cierra el visor.
    if (openArtifactId && !notebook.artifacts.some((a) => a.id === openArtifactId)) {
      setOpenArtifactId(null);
    }
  }, [notebook.artifacts, openArtifactId]);

  async function handleGenerate(kind: StudioArtifactKind) {
    if (readySources.length === 0 || generating) return;
    setGenerating(kind);
    setGenError(null);
    try {
      const result = await generateStudioArtifact({
        kind,
        sources: notebook.sources,
        providerId,
        modelId,
      });
      const artifact: StudioArtifact = {
        id: crypto.randomUUID(),
        kind,
        title: getArtifactSpec(kind).title,
        content: result.content,
        outputFormat: result.outputFormat,
        createdAt: Date.now(),
      };
      store.addArtifact(notebook.id, artifact);
      setOpenArtifactId(artifact.id);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(null);
    }
  }

  if (openArtifact) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <button
            onClick={() => setOpenArtifactId(null)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-app-elevated"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="text-sm font-medium text-text-primary">{openArtifact.title}</span>
          <button
            onClick={() => {
              store.removeArtifact(notebook.id, openArtifact.id);
              setOpenArtifactId(null);
            }}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary hover:bg-danger/10 hover:text-danger"
            title="Eliminar artefacto"
          >
            <Trash2 size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <StudioArtifactViewer artifact={openArtifact} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-4">
      {readySources.length === 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-warning/10 px-3 py-2.5 text-sm text-warning">
          <AlertCircle size={14} className="shrink-0" />
          Agrega fuentes en la pestaña Fuentes antes de generar artefactos.
        </div>
      )}

      {genError && (
        <div className="mb-4 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-danger">
          Error al generar: {genError}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3">
        {STUDIO_ITEMS.map((item) => (
          <button
            key={item.kind}
            disabled={readySources.length === 0 || generating !== null}
            onClick={() => handleGenerate(item.kind)}
            className="flex items-center gap-2 rounded-xl border border-border bg-app-elevated px-3 py-3 text-left text-sm text-text-secondary hover:border-accent/50 hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {generating === item.kind ? (
              <Loader2 size={18} className="shrink-0 animate-spin text-accent" />
            ) : (
              <item.icon size={18} className="shrink-0 text-text-tertiary" />
            )}
            {item.label}
          </button>
        ))}
        {DISABLED_ITEMS.map((item) => (
          <button
            key={item.label}
            disabled
            title={item.note}
            className="flex items-center gap-2 rounded-xl border border-border bg-app-elevated px-3 py-3 text-left text-sm text-text-secondary opacity-40 cursor-not-allowed"
          >
            <item.icon size={18} className="shrink-0 text-text-tertiary" />
            {item.label}
          </button>
        ))}
      </div>

      {notebook.artifacts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-text-tertiary">
          <Sparkles size={32} className="mb-3 opacity-50" />
          <p className="text-sm">Los artefactos que generes aparecerán aquí.</p>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto">
          {notebook.artifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => setOpenArtifactId(a.id)}
              className="flex w-full items-center gap-3 rounded-xl border border-border bg-app-elevated px-3 py-2.5 text-left hover:border-accent/50"
            >
              <ArtifactKindIcon kind={a.kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-text-primary">{a.title}</span>
                <span className="block text-xs text-text-tertiary">{new Date(a.createdAt).toLocaleString()}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactKindIcon({ kind }: { kind: StudioArtifactKind }) {
  const item = STUDIO_ITEMS.find((i) => i.kind === kind);
  const Icon = item?.icon ?? Sparkles;
  return <Icon size={16} className="shrink-0 text-text-tertiary" />;
}
