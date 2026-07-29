/**
 * Voice Orchestrator — puente entre el Modo Live y los modelos de trabajo.
 *
 * Responsabilidades:
 *   1. Detectar si un comando de voz es conversación (responder directo con
 *      LLM rápido) o delegación a subagentes (tarea pesada en background).
 *   2. Para conversación: usar `streamChat` con el provider/modelo activo,
 *      inyectando el system prompt mínimo de Live (respuestas cortas y
 *      naturales, ideales para TTS).
 *   3. Para delegación: llamar `orchestrate(...)` en background y emitir
 *      eventos de progreso. El usuario puede seguir hablando mientras tanto.
 *   4. Cuando una background task termina, encolar TTS con un resumen corto.
 *
 * Señales de "background":
 *   - Palabras clave: "en segundo plano", "en background", "mientras tanto",
 *     "delega", "delegar", "paralelo", "investiga y avísame", "analiza los
 *     archivos", "busca en la web y avísame", "investiga", "resume los
 *     archivos de X", "ejecuta el flujo".
 *   - Si NO hay esas palabras, es conversación directa.
 */

import type { LLMProvider, Message } from '@/providers/types';
import { streamChat } from '@/lib/chain';
import { orchestrate } from '@/agent/orchestrator';
import { useVoiceStore } from '@/store/voice';
import { useWeaver } from '@/store/weaver';
import { createProvider } from '@/providers';
import { apiKeyStore } from '@/providers/store';
import { speak, stopSpeaking, splitIntoSentences } from '@/lib/voice';
import { runtime } from '@/lib/tauri';

// --- Detección de intención -------------------------------------------------

const BACKGROUND_PATTERNS = [
  /\ben\s+(?:segundo\s+plano|background|paralelo)\b/i,
  /\bmientras\s+(?:tanto|sigues|hablamos)\b/i,
  /\bdelega(?:r|me)?\b/i,
  /\binvestiga\b.*\bavis(?:a|ame|arme)\b/i,
  /\banaliza\b.*\barchivos?\b/i,
  /\bbusca\b.*\bweb\b.*\bavis/i,
  /\bresume\b.*\barchivos?\b/i,
  /\bejecuta\s+(?:el\s+)?flujo\b/i,
  /\bprograma\s+(?:una\s+)?tarea\b/i,
  /\ben\s+cola\b/i,
];

export interface VoiceIntent {
  kind: 'chat' | 'background' | 'stop' | 'cancel_background' | 'clear';
  text: string;
  /** Solo para background: label corto para la UI. */
  taskLabel?: string;
}

export function classifyIntent(text: string): VoiceIntent {
  const t = text.trim().toLowerCase();

  // Comandos de control
  if (/^(para|detente|alto|stop|silencio)\b/i.test(t)) return { kind: 'stop', text };
  if (/^(cancela|cancelar)\s+(la\s+)?(?:tarea|background|en\s+cola)\b/i.test(t))
    return { kind: 'cancel_background', text };
  if (/^(limpia|borra)\s+(la\s+)?(?:conversaci[oó]n|transcripci[oó]n)\b/i.test(t))
    return { kind: 'clear', text };

  // Background
  for (const re of BACKGROUND_PATTERNS) {
    if (re.test(text)) {
      // Generar label corto
      const label = text.length > 60 ? text.slice(0, 57) + '…' : text;
      return { kind: 'background', text, taskLabel: label };
    }
  }

  return { kind: 'chat', text };
}

// --- System prompt para Live ------------------------------------------------

const LIVE_SYSTEM_PROMPT = `Eres Weaver en Modo Live — una conversación de voz bidireccional en español.

REGLAS CRÍTICAS:
- Responde en español, de forma natural y conversacional.
- Respuestas CORTAS: 1-3 frases salvo que el usuario pida detalle.
- NO uses markdown, NO listas con guiones, NO encabezados. Solo texto plano hablado.
- NO mencionas que eres una IA ni "como modelo de lenguaje".
- Si el usuario te interrumpe, para y responde a lo nuevo.
- Si la pregunta requiere análisis profundo, archivos, o web, di brevemente "Voy a delegar eso en segundo plano" y deja que el sistema lo pase al orquestador.
- Tono: cercano, eficiente, sin relleno. Como un colega técnico por audífono.

Contexto del entorno:
- App: Weaver (asistente desktop con agentes, MCP, skills)
- Plataforma: ${runtime.isTauri ? 'Tauri (desktop)' : 'navegador'}
- Modos activos se indican en cada mensaje usuario si procede.`;

// --- Ejecución de intención -------------------------------------------------

export interface VoiceRunOpts {
  signal: AbortSignal;
  onAssistantDelta?: (delta: string) => void;
  onAssistantTurnDone?: (fullText: string) => void;
  onBackgroundQueued?: (taskId: string, label: string) => void;
  onBackgroundProgress?: (taskId: string, msg: string) => void;
  onBackgroundDone?: (taskId: string, summary: string, ok: boolean) => void;
}

/**
 * Procesa un comando de voz (texto final del ASR).
 * Decide si es chat o background y lo ejecuta.
 */
export async function runVoiceCommand(
  userText: string,
  opts: VoiceRunOpts,
): Promise<void> {
  const intent = classifyIntent(userText);
  const voiceStore = useVoiceStore.getState();
  const weaver = useWeaver.getState();

  // Registrar el turno del usuario en la store de voz
  voiceStore.pushTurn({ role: 'user', text: userText });

  switch (intent.kind) {
    case 'stop':
      stopSpeaking();
      voiceStore.setState('listening');
      return;

    case 'cancel_background': {
      const running = voiceStore.backgroundTasks.filter((t) => t.status === 'running' || t.status === 'pending');
      if (running.length === 0) {
        const id = voiceStore.pushTurn({ role: 'assistant', text: 'No hay tareas en segundo plano activas.' });
        opts.onAssistantTurnDone?.('No hay tareas en segundo plano activas.');
        speak('No hay tareas en segundo plano activas.');
      } else {
        for (const t of running) {
          voiceStore.setBackgroundTaskStatus(t.id, 'cancelled');
        }
        const msg = `Canceladas ${running.length} tarea(s) en segundo plano.`;
        voiceStore.pushTurn({ role: 'assistant', text: msg });
        opts.onAssistantTurnDone?.(msg);
        speak(msg);
      }
      voiceStore.setState('listening');
      return;
    }

    case 'clear':
      voiceStore.clearTurns();
      voiceStore.setState('listening');
      return;

    case 'background':
      await runBackgroundTask(intent.text, intent.taskLabel ?? intent.text, opts);
      // Tras delegar, volver a listening inmediatamente
      voiceStore.setState('listening');
      return;

    case 'chat':
      await runChatTurn(userText, opts);
      return;
  }
}

// --- Conversación directa ---------------------------------------------------

async function runChatTurn(userText: string, opts: VoiceRunOpts): Promise<void> {
  const voiceStore = useVoiceStore.getState();
  const weaver = useWeaver.getState();
  const { providerId, modelId, activeMemberId, members, planMode, pursueObjective, cognitiveMode } = weaver;

  // Provider/modelo del miembro activo si lo hay, si no global
  const activeMember = members.find((m) => m.id === activeMemberId);
  const effProviderId = (activeMember?.providerId as typeof providerId | null) ?? providerId;
  const effModelId = activeMember?.modelId ?? modelId;

  const apiKey = await apiKeyStore.get(effProviderId);
  if (!apiKey) {
    const msg = `No tengo API key para ${effProviderId}. Configúrala en Ajustes.`;
    voiceStore.pushTurn({ role: 'assistant', text: msg });
    opts.onAssistantTurnDone?.(msg);
    speak(msg);
    voiceStore.setState('listening');
    return;
  }

  let llm: LLMProvider;
  try {
    llm = await createProvider(effProviderId, { apiKeyOverride: apiKey });
  } catch (e) {
    const msg = `No pude crear el provider: ${e instanceof Error ? e.message : String(e)}`;
    voiceStore.pushTurn({ role: 'assistant', text: msg });
    speak(msg);
    voiceStore.setState('listening');
    return;
  }

  voiceStore.setState('thinking');

  // Construir historial de la conversación de voz (últimos 8 turnos)
  const recentTurns = voiceStore.turns.slice(-8);
  const msgs: Message[] = [
    { role: 'system', content: LIVE_SYSTEM_PROMPT },
    ...recentTurns.map((t): Message => ({
      role: t.role === 'user' ? 'user' : 'assistant',
      content: t.text,
    })),
    { role: 'user', content: userText },
  ];

  // Suffix de modos activos
  const modeTags: string[] = [];
  if (planMode) modeTags.push('[MODO PLAN]');
  if (pursueObjective) modeTags.push('[PERSEGUIR OBJETIVO]');
  if (cognitiveMode) modeTags.push('[MODO COGNITIVO]');
  if (modeTags.length) {
    msgs.push({ role: 'system', content: `Modos activos: ${modeTags.join(', ')}` });
  }

  // Stream + speak en paralelo por frases
  let fullText = '';
  let sentenceBuffer = '';
  let spokenUpTo = 0;
  const turnId = voiceStore.pushTurn({ role: 'assistant', text: '', interim: true });

  try {
    voiceStore.setState('speaking');
    const result = await streamChat(llm, effModelId, msgs, {
      signal: opts.signal,
      onDelta: (delta) => {
        fullText += delta;
        sentenceBuffer += delta;
        opts.onAssistantDelta?.(delta);

        // Si tenemos una frase completa, hablarla
        const sentences = splitIntoSentences(sentenceBuffer);
        if (sentences.length > 1) {
          // La última puede ser parcial, hablar todas menos la última
          for (let i = 0; i < sentences.length - 1; i++) {
            speak(sentences[i]);
            spokenUpTo += sentences[i].length + 1;
          }
          sentenceBuffer = sentences[sentences.length - 1];
        }

        // Actualizar el turno en la store
        voiceStore.updateTurn(turnId, { text: fullText, interim: false });
      },
    });

    // Hablar el resto del buffer final
    if (sentenceBuffer.trim()) {
      speak(sentenceBuffer.trim());
    }

    voiceStore.updateTurn(turnId, { text: result.text || fullText, interim: false });
    opts.onAssistantTurnDone?.(result.text || fullText);

    // Métricas
    try {
      const { metrics } = await import('@/lib/metrics');
      metrics.recordUsage({
        providerId: llm.info.id,
        model: effModelId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        source: 'voice',
        success: true,
        taskKind: 'voice-chat',
      });
    } catch { /* ignore */ }

    // Esperar a que termine de hablar antes de volver a listening
    await waitForSpeechEnd();
    voiceStore.setState('listening');
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      stopSpeaking();
      voiceStore.updateTurn(turnId, { text: fullText + ' [interrumpido]', interim: false });
      voiceStore.setState('listening');
      return;
    }
    const msg = `Error: ${e instanceof Error ? e.message : String(e)}`;
    voiceStore.updateTurn(turnId, { text: msg, interim: false });
    voiceStore.setError(msg);
    speak('Ocurrió un error. Revisa la consola.');
  }
}

function waitForSpeechEnd(): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    const check = () => {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
        resolve();
      } else {
        setTimeout(check, 120);
      }
    };
    setTimeout(check, 120);
  });
}

// --- Delegación a subagentes (background) ----------------------------------

async function runBackgroundTask(
  objective: string,
  label: string,
  opts: VoiceRunOpts,
): Promise<void> {
  const voiceStore = useVoiceStore.getState();
  const weaver = useWeaver.getState();
  const { providerId, modelId, activeMemberId, members } = weaver;

  const activeMember = members.find((m) => m.id === activeMemberId);
  const effProviderId = (activeMember?.providerId as typeof providerId | null) ?? providerId;
  const effModelId = activeMember?.modelId ?? modelId;

  const apiKey = await apiKeyStore.get(effProviderId);
  if (!apiKey) {
    const msg = `No tengo API key para ${effProviderId} para delegar la tarea.`;
    voiceStore.pushTurn({ role: 'assistant', text: msg });
    speak(msg);
    return;
  }

  const taskId = voiceStore.addBackgroundTask(label);
  voiceStore.pushTurn({
    role: 'assistant',
    text: `Delegando en segundo plano: ${label}. Te aviso cuando termine.`,
    taskId,
  });
  speak(`Delegando en segundo plano: ${label}. Te aviso cuando termine.`);
  opts.onBackgroundQueued?.(taskId, label);

  voiceStore.setBackgroundTaskStatus(taskId, 'running');
  opts.onBackgroundProgress?.(taskId, 'Iniciando orquestador de subagentes…');

  try {
    const llm = await createProvider(effProviderId, { apiKeyOverride: apiKey });
    const result = await orchestrate(
      {
        objective,
        context: `Weaver Live — tarea delegada por voz. Plataforma: ${runtime.isTauri ? 'Tauri' : 'navegador'}.`,
        totalBudget: { maxSteps: 8, maxTokens: 12000, maxTimeMs: 120_000 },
        allowRetry: true,
        allowEscalation: false,
      },
      { provider: llm, model: effModelId },
    );

    const ok = result.status === 'succeeded';
    const summary = result.finalResult.slice(0, 600);
    voiceStore.setBackgroundTaskStatus(taskId, ok ? 'done' : 'failed', summary);

    // Notificar por voz cuando termine
    const shortSummary = summary.length > 200 ? summary.slice(0, 197) + '…' : summary;
    const notifyMsg = ok
      ? `Tarea completada: ${shortSummary}`
      : `La tarea falló: ${shortSummary}`;
    voiceStore.pushTurn({ role: 'system', text: notifyMsg, taskId });
    speak(notifyMsg);
    opts.onBackgroundDone?.(taskId, shortSummary, ok);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    voiceStore.setBackgroundTaskStatus(taskId, 'failed', undefined, errMsg);
    voiceStore.pushTurn({ role: 'system', text: `Error en background: ${errMsg}`, taskId });
    speak(`Error en la tarea delegada: ${errMsg}`);
    opts.onBackgroundDone?.(taskId, errMsg, false);
  }
}
