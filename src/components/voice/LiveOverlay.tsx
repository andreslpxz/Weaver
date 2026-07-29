/**
 * LiveOverlay — UI principal del Modo Live de Weaver.
 *
 * Estructura:
 *   - Backdrop fullscreen oscuro
 *   - Panel central con:
 *     · VoiceOrb (animación de estado)
 *     · Transcripción en vivo (interim ASR + turnos)
 *     · Background tasks activas (con status)
 *     · Controles: mute, interrupt, close
 *   - Input de texto fallback si ASR no está soportado
 *
 * State machine del componente:
 *   - Al montar: pide permiso de micrófono + inicializa ASR continuo
 *   - Escucha resultados finales del ASR y los pasa a runVoiceCommand
 *   - Si el usuario habla mientras TTS está activo, interrumpe el TTS
 *   - Al cerrar: detiene ASR + TTS
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Mic, MicOff, Square, Send, Radio, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useVoiceStore } from '@/store/voice';
import { useWeaver } from '@/store/weaver';
import { VoiceOrb } from './VoiceOrb';
import {
  ContinuousASR,
  isASRSupported,
  isTTSSupported,
  primeVoices,
  speak,
  stopSpeaking,
} from '@/lib/voice';
import { runVoiceCommand } from '@/lib/voiceOrchestrator';

export function LiveOverlay() {
  const open = useVoiceStore((s) => s.open);
  const setOpen = useVoiceStore((s) => s.setOpen);
  const state = useVoiceStore((s) => s.state);
  const setState = useVoiceStore((s) => s.setState);
  const setError = useVoiceStore((s) => s.setError);
  const error = useVoiceStore((s) => s.error);
  const turns = useVoiceStore((s) => s.turns);
  const interimText = useVoiceStore((s) => s.interimText);
  const setInterimText = useVoiceStore((s) => s.setInterimText);
  const pushTurn = useVoiceStore((s) => s.pushTurn);
  const backgroundTasks = useVoiceStore((s) => s.backgroundTasks);

  const [muted, setMuted] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [asrSupported] = useState(() => isASRSupported());
  const [ttsSupported] = useState(() => isTTSSupported());

  const asrRef = useRef<ContinuousASR | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const lastSpokeRef = useRef<number>(0);

  // --- Ciclo de vida del overlay ------------------------------------------

  useEffect(() => {
    if (!open) return;

    // Prime TTS voices
    primeVoices();

    // Si TTS no está soportado, advertir pero continuar
    if (!ttsSupported) {
      setError('Tu navegador/webview no soporta síntesis de voz. Las respuestas se mostrarán como texto.');
    }

    // Inicializar ASR si está soportado
    if (asrSupported) {
      const asr = new ContinuousASR('es-ES');
      asrRef.current = asr;
      asr.setHandlers({
        onStart: () => {
          setState('listening');
        },
        onInterim: (text) => {
          setInterimText(text);
          // Si el usuario empieza a hablar durante el speaking, interrumpir TTS
          if (useVoiceStore.getState().state === 'speaking' && Date.now() - lastSpokeRef.current > 400) {
            stopSpeaking();
            setState('listening');
          }
        },
        onFinal: async (text) => {
          if (!text.trim()) return;
          setInterimText('');
          // Cancelar cualquier ejecución en curso y arrancar nueva
          abortRef.current?.abort();
          const ctrl = new AbortController();
          abortRef.current = ctrl;
          try {
            await runVoiceCommand(text, { signal: ctrl.signal });
          } catch (e) {
            console.error('[Live] runVoiceCommand error:', e);
          }
        },
        onError: (err) => {
          console.warn('[Live] ASR error:', err);
          if (err === 'not-allowed' || err === 'service-not-allowed') {
            setError('Permiso de micrófono denegado. Actívalo en el navegador.');
          }
        },
      });
      asr.start();
    } else {
      setState('idle');
      setError('Tu navegador/webview no soporta reconocimiento de voz. Usa el campo de texto inferior.');
    }

    return () => {
      // Cleanup al cerrar
      asrRef.current?.stop();
      asrRef.current = null;
      stopSpeaking();
      abortRef.current?.abort();
      setState('idle');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // --- Auto-scroll al final de la transcripción ----------------------------

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, interimText]);

  // --- Toggle mute ----------------------------------------------------------

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    if (next) {
      asrRef.current?.stop();
      stopSpeaking();
      setState('idle');
    } else {
      asrRef.current?.start();
      setState('listening');
    }
  }, [muted, setState]);

  // --- Interrupción manual --------------------------------------------------

  const handleInterrupt = useCallback(() => {
    stopSpeaking();
    abortRef.current?.abort();
    setState('listening');
    if (!muted && asrSupported) asrRef.current?.start();
  }, [muted, asrSupported, setState]);

  // --- Cerrar ---------------------------------------------------------------

  const handleClose = useCallback(() => {
    asrRef.current?.stop();
    stopSpeaking();
    abortRef.current?.abort();
    setOpen(false);
  }, [setOpen]);

  // --- Enviar texto (fallback) ---------------------------------------------

  const handleSendText = useCallback(async () => {
    const text = textInput.trim();
    if (!text) return;
    setTextInput('');
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await runVoiceCommand(text, { signal: ctrl.signal });
    } catch (e) {
      console.error('[Live] text run error:', e);
    }
  }, [textInput]);

  // --- Atajos de teclado ----------------------------------------------------

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
      else if (e.key === ' ' && e.ctrlKey) {
        e.preventDefault();
        handleInterrupt();
      } else if (e.key === 'm' && e.ctrlKey) {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleClose, handleInterrupt, toggleMute]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-app-bg/95 backdrop-blur-md animate-fade-in">
      {/* Header */}
      <header className="h-12 flex items-center justify-between px-4 shrink-0 border-b border-border">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-accent" />
          <span className="text-sm font-medium text-text-primary">Weaver Live</span>
          {backgroundTasks.length > 0 && (
            <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-app-elevated border border-border">
              {backgroundTasks.filter((t) => t.status === 'running' || t.status === 'pending').length} en background
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleMute}
            title={muted ? 'Activar micrófono (Ctrl+M)' : 'Silenciar micrófono (Ctrl+M)'}
            className={`codex-icon-btn ${muted ? 'text-danger' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {muted ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
          <button
            onClick={handleInterrupt}
            title="Interrumpir (Ctrl+Space)"
            className="codex-icon-btn text-text-secondary hover:text-warning"
            disabled={state === 'idle'}
          >
            <Square size={14} />
          </button>
          <button
            onClick={handleClose}
            title="Cerrar (Esc)"
            className="codex-icon-btn text-text-secondary hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Cuerpo principal */}
      <div className="flex-1 flex min-h-0">
        {/* Columna izquierda: orb + transcripción */}
        <div className="flex-1 flex flex-col items-center justify-start p-6 min-w-0 overflow-y-auto">
          {/* Orb */}
          <div className="shrink-0 mb-8 mt-4">
            <VoiceOrb size={200} />
          </div>

          {/* Error banner */}
          {error && (
            <div className="mb-4 w-full max-w-2xl px-4 py-2.5 rounded-codex bg-warning/10 border border-warning/30 text-xs text-warning">
              {error}
            </div>
          )}

          {/* Transcripción */}
          <div className="w-full max-w-2xl flex-1 min-h-0 flex flex-col gap-3 pb-4">
            {turns.length === 0 && !interimText && (
              <div className="text-center text-text-muted text-sm mt-8 px-4">
                <p className="mb-2">
                  {asrSupported
                    ? 'Habla naturalmente — te escucho. Di "para" para interrumpirme, "limpia" para reiniciar.'
                    : 'Escribe abajo para hablar conmigo.'}
                </p>
                <p className="text-[11px] text-text-muted">
                  Prueba: <em>"investiga en background los últimos avances en Rust y avísame"</em>
                </p>
              </div>
            )}

            {turns.map((t) => (
              <TurnBubble key={t.id} turn={t} />
            ))}

            {/* Interim ASR */}
            {interimText && (
              <div className="flex justify-end">
                <div className="max-w-[80%] px-3.5 py-2 rounded-codex bg-app-input/60 border border-border text-sm text-text-secondary italic">
                  {interimText}…
                </div>
              </div>
            )}

            <div ref={transcriptEndRef} />
          </div>

          {/* Fallback de texto */}
          {!asrSupported && (
            <div className="w-full max-w-2xl shrink-0 flex gap-2 mt-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendText(); } }}
                placeholder="Escribe tu mensaje…"
                className="flex-1 codex-input text-sm"
                autoFocus
              />
              <button
                onClick={handleSendText}
                className="codex-btn-primary px-3 py-1.5 text-sm flex items-center gap-1.5"
              >
                <Send size={12} /> Enviar
              </button>
            </div>
          )}

          {/* Pista de atajos */}
          <div className="mt-4 text-[10px] text-text-muted flex gap-4">
            <span><kbd className="px-1 py-0.5 bg-app-elevated rounded border border-border">Esc</kbd> Cerrar</span>
            <span><kbd className="px-1 py-0.5 bg-app-elevated rounded border border-border">Ctrl+Space</kbd> Interrumpir</span>
            <span><kbd className="px-1 py-0.5 bg-app-elevated rounded border border-border">Ctrl+M</kbd> Mute</span>
          </div>
        </div>

        {/* Columna derecha: background tasks */}
        {backgroundTasks.length > 0 && (
          <aside className="w-72 shrink-0 border-l border-border flex flex-col bg-app-sidebar/50">
            <div className="px-3 py-2 border-b border-border">
              <h3 className="text-[10px] text-text-muted uppercase tracking-wider font-medium">
                Tareas en segundo plano
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {backgroundTasks.map((task) => (
                <BackgroundTaskCard key={task.id} task={task} />
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

// --- Sub-componentes --------------------------------------------------------

function TurnBubble({ turn }: { turn: { role: 'user' | 'assistant' | 'system'; text: string; interim?: boolean; taskId?: string } }) {
  const isUser = turn.role === 'user';
  const isSystem = turn.role === 'system';

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] px-3 py-1.5 rounded-codex bg-accent/10 border border-accent/30 text-xs text-accent flex items-center gap-2">
          <Radio size={10} />
          <span>{turn.text}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] px-3.5 py-2 rounded-codex text-sm leading-relaxed ${
          isUser
            ? 'bg-accent/20 border border-accent/40 text-text-primary'
            : turn.interim
            ? 'bg-app-elevated/50 border border-border text-text-secondary'
            : 'bg-app-elevated border border-border-accent text-text-primary'
        }`}
      >
        {turn.text || (turn.interim ? '…' : '')}
      </div>
    </div>
  );
}

function BackgroundTaskCard({ task }: {
  task: {
    id: string;
    label: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
    startedAt: number;
    finishedAt?: number;
    result?: string;
    error?: string;
  };
}) {
  const elapsed = task.finishedAt
    ? Math.round((task.finishedAt - task.startedAt) / 1000)
    : Math.round((Date.now() - task.startedAt) / 1000);

  return (
    <div className="px-2.5 py-2 rounded-codex bg-app-elevated border border-border text-xs">
      <div className="flex items-start gap-2 mb-1">
        {task.status === 'running' && <Loader2 size={12} className="text-accent animate-spin shrink-0 mt-0.5" />}
        {task.status === 'pending' && <Clock size={12} className="text-text-muted shrink-0 mt-0.5" />}
        {task.status === 'done' && <CheckCircle2 size={12} className="text-success shrink-0 mt-0.5" />}
        {task.status === 'failed' && <XCircle size={12} className="text-danger shrink-0 mt-0.5" />}
        {task.status === 'cancelled' && <XCircle size={12} className="text-text-muted shrink-0 mt-0.5" />}
        <span className="flex-1 text-text-primary leading-snug break-words">{task.label}</span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <span>
          {task.status === 'running' && 'Trabajando…'}
          {task.status === 'pending' && 'En cola'}
          {task.status === 'done' && 'Completado'}
          {task.status === 'failed' && 'Falló'}
          {task.status === 'cancelled' && 'Cancelado'}
        </span>
        <span>{elapsed}s</span>
      </div>
      {task.result && (
        <div className="mt-1.5 pt-1.5 border-t border-border text-[10px] text-text-secondary leading-snug line-clamp-3">
          {task.result}
        </div>
      )}
      {task.error && (
        <div className="mt-1.5 pt-1.5 border-t border-danger/30 text-[10px] text-danger leading-snug">
          {task.error}
        </div>
      )}
    </div>
  );
}
