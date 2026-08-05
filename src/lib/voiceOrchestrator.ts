/**
 * Voice Orchestrator — puente entre el Modo Live y los modelos de trabajo.
 *
 * Responsabilidades:
 *   1. Detectar si un comando de voz es conversación (responder directo con
 *      LLM rápido) o delegación a background (tarea con tools que corre en
 *      paralelo a la conversación).
 *   2. Para conversación: usar `streamChat` con el provider/modelo activo,
 *      inyectando el system prompt mínimo de Live (respuestas cortas y
 *      naturales, ideales para TTS).
 *   3. Para delegación: arrancar la tarea en BACKGROUND (no se espera). El
 *      usuario puede seguir hablando mientras tanto. La tarea usa las MISMAS
 *      tools que el chat (web_search, shell_exec, file_*, save_file, etc.)
 *      vía `buildAdvancedToolsList` + `streamChat` loop, igual que Composer.
 *   4. Cuando la tarea termina, el AGENTE MISMO genera una notificación
 *      natural en voz (LLM-produced, no hardcoded) resumiendo lo que hizo.
 *
 * Señales de "background":
 *   - Palabras clave: "en segundo plano", "en background", "mientras tanto",
 *     "delega", "delegar", "paralelo", "investiga y avísame", "analiza los
 *     archivos", "busca en la web y avísame", "investiga", "resume los
 *     archivos de X", "ejecuta el flujo".
 *   - Si NO hay esas palabras, es conversación directa.
 */

import type { LLMProvider, Message, Tool } from '@/providers/types';
import { streamChat } from '@/lib/chain';
import { useVoiceStore } from '@/store/voice';
import { useWeaver } from '@/store/weaver';
import { createProvider } from '@/providers';
import { apiKeyStore } from '@/providers/store';
import { speak, stopSpeaking, splitIntoSentences } from '@/lib/voice';
import { runtime } from '@/lib/tauri';

// --- Helpers de sincronización con el chat activo ---------------------------

/**
 * Sincroniza un turno del Live con la conversación activa del chat.
 * Solo se llama cuando el texto del turno es final (no interim).
 * Si no hay conversación activa, no hace nada (el turno sigue vivo solo
 * en el voice store y se ve en el overlay).
 */
function syncToActiveChat(role: 'user' | 'assistant', text: string, opts?: { id?: string; ts?: number }) {
  const weaver = useWeaver.getState();
  if (!weaver.activeConversationId) return;
  if (!text || !text.trim()) return;
  try {
    weaver.appendMessage({
      id: opts?.id,
      role,
      content: text,
      ts: opts?.ts ?? Date.now(),
    });
  } catch (e) {
    console.warn('[Live] syncToActiveChat failed:', e);
  }
}

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
  // Patrones adicionales: "busca en internet", "busca en la web", "investiga X"
  // sin requerir "avísame" — el usuario sobreentiende que es background.
  /\bbusca\b.*\b(?:internet|web|online)\b/i,
  /\binvestiga\b/i,
  /\baver[ií]gua\b/i,
  /\bconsulta\b.*\b(?:internet|web|online|api)\b/i,
];

export interface VoiceIntent {
  kind: 'chat' | 'background' | 'stop' | 'cancel_background' | 'clear' | 'memory_save' | 'memory_query' | 'memory_delete';
  text: string;
  /** Solo para background: label corto para la UI. */
  taskLabel?: string;
  /** Para memory_save: el hecho a guardar (key, value inferidos). */
  memoryFact?: { key: string; value: string };
  /** Para memory_delete: la clave a eliminar. */
  memoryKey?: string;
}

// --- Detección de memoria (save / query / delete) --------------------------
//
// En Modo Live NO tenemos tools disponibles (el LLM no puede llamar
// memory_save_fact directamente), así que interceptamos patrones obvios
// y guardamos/recuperamos/eliminamos directamente desde el orchestrator.
// Esto es best-effort — el LLM sigue siendo quien responde al usuario,
// pero la acción de persistencia la hacemos nosotros por él.

// Patrones para detectar "guarda esto: X" / "recuerda que X" / "anota X"
// donde X es información breve sobre el usuario o un proyecto.
const MEMORY_SAVE_PATTERNS = [
  // "guarda esto: X" / "guárdame X" / "guarda en memoria X"
  /^(?:guarda|guárdame|guardar)\s+(?:esto\s*[:：]?\s*|en\s+memoria\s*[:：]?\s*|que\s+|el\s+siguiente\s*[:：]?\s*)(.+)/i,
  // "recuerda que X" / "recuérdame X" / "recuerda X"
  /^(?:recuerda|recuérdame|recordar)\s+(?:que\s+)?(.+)/i,
  // "anota X" / "apunta X" / "memoriza X"
  /^(?:anota|apunta|memoriza)\s+(?:que\s+|esto\s*[:：]?\s*)?(.+)/i,
  // "no te olvides de X"
  /^no\s+te\s+olvides\s+de\s+(?:que\s+)?(.+)/i,
  // "mi nombre es X" → user:name
  /^mi\s+nombre\s+es\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?)/i,
  // "me llamo X" → user:name
  /^me\s+llamo\s+([A-ZÁÉÍÓÚÑa-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑa-záéíóúñ]+)?)/i,
  // "soy X" (si X parece un nombre propio)
  /^soy\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/i,
];

// Patrones para detectar "¿qué recuerdas?" / "¿qué tienes en tu memoria?"
const MEMORY_QUERY_PATTERNS = [
  /\b(?:qu[eé]\s+(?:recuerdas|tienes|sabes))\s+(?:de\s+mi|sobre\s+mi|en\s+tu\s+memoria)?\b/i,
  /\b(?:qu[eé]\s+tienes)\s+en\s+(?:tu\s+)?memoria\b/i,
  /\b(?:qu[eé]\s+sabes)\s+(?:de\s+mi|sobre\s+mi)\b/i,
  /\bmi\s+memoria\b/i,
];

// Patrones para detectar "olvida X" / "borra Y de tu memoria"
const MEMORY_DELETE_PATTERNS = [
  /^(?:olvida|borra|elimina)\s+(?:de\s+tu\s+memoria\s+)?(?:todo\s+lo\s+que\s+sabes\s+de\s+)?(?:sobre\s+)?(.+)/i,
];

/**
 * Intenta inferir una clave semántica para un hecho a partir del texto.
 * Ej: "me llamo John" → user:name; "trabajo como ingeniero" → user:job
 */
function inferMemoryKey(text: string): { key: string; value: string } | null {
  const t = text.trim();

  // Nombre
  let m = t.match(/^(?:me\s+llamo|mi\s+nombre\s+es|soy)\s+(.+)$/i);
  if (m) return { key: 'user:name', value: m[1].trim() };

  // Profesión / trabajo
  m = t.match(/^(?:trabajo\s+como|soy)\s+(?:un|una|el|la)?\s*(.+?)(?:\s+en\s+(.+))?$/i);
  if (m) {
    const job = m[2] ? `${m[1]} en ${m[2]}` : m[1];
    return { key: 'user:job', value: job.trim() };
  }

  // Idioma preferido
  m = t.match(/^(?:hablo|prefiero\s+hablar\s+en)\s+(español|inglés|francés|alemán|italiano|portugués|chino|japon[eé]s)/i);
  if (m) return { key: 'user:language', value: m[1].toLowerCase() };

  // Cumpleaños
  m = t.match(/^(?:mi\s+cumple(?:años)?\s+es|nací\s+el)\s+(.+)$/i);
  if (m) return { key: 'user:birthday', value: m[1].trim() };

  // Preferencia genérica: "prefiero X"
  m = t.match(/^prefiero\s+(?:que\s+)?(.+)$/i);
  if (m) return { key: 'user:preference', value: m[1].trim() };

  // Default: genérico
  return { key: `user:fact:${Date.now().toString(36)}`, value: t };
}

export function classifyIntent(text: string): VoiceIntent {
  const t = text.trim().toLowerCase();

  // Comandos de control
  if (/^(para|detente|alto|stop|silencio)\b/i.test(t)) return { kind: 'stop', text };
  if (/^(cancela|cancelar)\s+(la\s+)?(?:tarea|background|en\s+cola)\b/i.test(t))
    return { kind: 'cancel_background', text };
  if (/^(limpia|borra)\s+(la\s+)?(?:conversaci[oó]n|transcripci[oó]n)\b/i.test(t))
    return { kind: 'clear', text };

  // Memoria: query (antes que save para no confundir "¿qué recuerdas?" con "recuerda X")
  for (const re of MEMORY_QUERY_PATTERNS) {
    if (re.test(text)) return { kind: 'memory_query', text };
  }

  // Memoria: delete
  for (const re of MEMORY_DELETE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      return { kind: 'memory_delete', text, memoryKey: m[1].trim() };
    }
  }

  // Memoria: save
  for (const re of MEMORY_SAVE_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const factText = m[1] || m[0];
      const inferred = inferMemoryKey(factText);
      if (inferred) {
        return { kind: 'memory_save', text, memoryFact: inferred };
      }
    }
  }

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
//
// El system prompt se construye dinámicamente con `buildLiveSystemPrompt()`
// para inyectar el contexto de chat memory (hechos recordados del usuario)
// en cada turno. Esto permite que el Modo Live también "recuerde" al usuario
// y proyectos pasados.

async function buildLiveSystemPrompt(): Promise<string> {
  // Cargar hechos de chat memory para inyectarlos en el contexto.
  let memoryBlock = '(memoria vacía)';
  try {
    const { memory } = await import('@/agent/memory');
    const facts = await memory.listFacts();
    if (facts.length > 0) {
      const recent = facts.slice(-20);
      memoryBlock = recent.map((f) => `- ${f.key}: ${f.value}`).join('\n');
    }
  } catch (e) {
    console.warn('[Live] No se pudo cargar memoria:', e);
  }

  const chatMemoryMode = useWeaver.getState().chatMemoryMode;

  return `Eres Weaver en Modo Live — una conversación de voz bidireccional en español.

REGLAS CRÍTICAS:
- Responde en español, de forma natural y conversacional.
- Respuestas CORTAS: 1-3 frases salvo que el usuario pida detalle.
- NO uses markdown, NO listas con guiones, NO encabezados. Solo texto plano hablado.
- NO menciones que eres una IA ni "como modelo de lenguaje".
- Si el usuario te interrumpe, para y responde a lo nuevo.
- Tono: cercano, eficiente, sin relleno. Como un colega técnico por audífono.

IMPORTANTE SOBRE HERRAMIENTAS:
- En este modo NO tienes acceso a herramientas (web search, archivos, etc).
- Si el usuario pide buscar en internet, analizar archivos, o cualquier tarea
  que requiera herramientas, delega en background diciendo brevemente "Lo investigo
  en segundo plano y te aviso". El usuario puede seguir hablando mientras tanto.
- NUNCA devuelvas una respuesta vacía. Siempre di algo, aunque sea
  "Déjame pensar..." o "No tengo herramientas en modo voz, pero puedo...".
- Si la pregunta es sobre conocimiento general, responde directamente con
  lo que sepas, sin buscar en web.

MEMORIA DEL AGENTE:
- Tienes una memoria semántica con hechos guardados de conversaciones anteriores.
- Cuando el usuario te pida "guarda X" / "recuerda Y" / "anota Z" / "memoriza W",
  dile brevemente que lo vas a recordar y se guardará automáticamente.
- Si chatMemoryMode está activo, también guardas proactivamente info personal
  (nombre, profesión, gustos, proyectos) que el usuario mencione.
- NUNCA digas "según mi memoria" — simplemente usa la info naturalmente.

CONTEXTO RECUPERADO DE TU MEMORIA:
${memoryBlock}

${chatMemoryMode
  ? 'MODO MEMORIA CHAT ACTIVO: guardarás automáticamente hechos clave (nombre, profesión, preferencias, proyectos) que notes en la conversación.'
  : 'Memoria chat desactivada — sólo guardas hechos cuando el usuario te lo pida explícitamente.'}

Contexto del entorno:
- App: Weaver (asistente desktop con agentes, MCP, skills)
- Plataforma: ${runtime.isTauri ? 'Tauri (desktop)' : 'navegador'}`;
}

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
 *
 * IMPORTANTE: Para background, la tarea se arranca PERO NO SE ESPERA.
 * El usuario puede seguir hablando inmediatamente. La notificación de
 * finalización se dispara cuando la tarea termina (asíncrono).
 */
export async function runVoiceCommand(
  userText: string,
  opts: VoiceRunOpts,
): Promise<void> {
  const intent = classifyIntent(userText);
  const voiceStore = useVoiceStore.getState();

  // Registrar el turno del usuario en la store de voz y en el chat activo
  voiceStore.pushTurn({ role: 'user', text: userText });
  syncToActiveChat('user', userText);

  switch (intent.kind) {
    case 'stop':
      stopSpeaking();
      voiceStore.setState('listening');
      return;

    case 'cancel_background': {
      const running = voiceStore.backgroundTasks.filter((t) => t.status === 'running' || t.status === 'pending');
      if (running.length === 0) {
        const msg = 'No hay tareas en segundo plano activas.';
        voiceStore.pushTurn({ role: 'assistant', text: msg });
        opts.onAssistantTurnDone?.(msg);
        syncToActiveChat('assistant', msg);
        speak(msg);
      } else {
        for (const t of running) {
          voiceStore.setBackgroundTaskStatus(t.id, 'cancelled');
        }
        const msg = `Canceladas ${running.length} tarea(s) en segundo plano.`;
        voiceStore.pushTurn({ role: 'assistant', text: msg });
        opts.onAssistantTurnDone?.(msg);
        syncToActiveChat('assistant', msg);
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
      // NO await — la tarea corre en background. runBackgroundTask se
      // encarga de encolar el mensaje "Delegando..." y devolver el control.
      // El usuario puede seguir hablando inmediatamente.
      void runBackgroundTask(intent.text, intent.taskLabel ?? intent.text, opts);
      // Volver a listening inmediatamente (la confirmación "Delegando..."
      // la hace runBackgroundTask por dentro, pero sin bloquear el return).
      // Damos un microtask para que el mensaje "Delegando..." se hable
      // antes de ceder el turno, pero sin esperar a que termine la tarea.
      voiceStore.setState('listening');
      return;

    case 'memory_save': {
      // Guardar el hecho directamente (Live Mode no tiene tools disponibles).
      // El LLM ya verá el contexto de memoria en el system prompt.
      if (intent.memoryFact) {
        try {
          const { memory } = await import('@/agent/memory');
          await memory.setFact(intent.memoryFact.key, intent.memoryFact.value, 'user');
          const confirmMsg = `Hecho guardado. ${intent.memoryFact.key.split(':').slice(1).join(':') || 'recuerdo'}: ${intent.memoryFact.value}.`;
          voiceStore.pushTurn({ role: 'assistant', text: confirmMsg });
          syncToActiveChat('assistant', confirmMsg);
          speak(confirmMsg);
        } catch (e) {
          const errMsg = `No pude guardarlo en memoria: ${e instanceof Error ? e.message : String(e)}`;
          voiceStore.pushTurn({ role: 'assistant', text: errMsg });
          syncToActiveChat('assistant', errMsg);
          speak(errMsg);
        }
      }
      voiceStore.setState('listening');
      return;
    }

    case 'memory_query': {
      // Listar hechos y hablarlos. Limitamos a los 5 más recientes para
      // no hacer la respuesta demasiado larga en voz.
      try {
        const { memory } = await import('@/agent/memory');
        const facts = await memory.listFacts();
        let msg: string;
        if (facts.length === 0) {
          msg = 'Mi memoria está vacía por ahora. Si me dices tu nombre o algo que quieras que recuerde, lo guardo.';
        } else {
          const recent = facts.slice(-5);
          const userFacts = recent.filter((f) => f.key.startsWith('user:'));
          const otherFacts = recent.filter((f) => !f.key.startsWith('user:'));
          const parts: string[] = [];
          if (userFacts.length) {
            parts.push('Sobre ti: ' + userFacts.map((f) => f.value).join('; '));
          }
          if (otherFacts.length) {
            parts.push('Otros recuerdos: ' + otherFacts.map((f) => `${f.key} = ${f.value}`).join('; '));
          }
          msg = `Recuerdo ${facts.length} cosas. ${parts.join('. ')}.`;
        }
        voiceStore.pushTurn({ role: 'assistant', text: msg });
        syncToActiveChat('assistant', msg);
        speak(msg);
      } catch (e) {
        const errMsg = `No pude leer la memoria: ${e instanceof Error ? e.message : String(e)}`;
        voiceStore.pushTurn({ role: 'assistant', text: errMsg });
        syncToActiveChat('assistant', errMsg);
        speak(errMsg);
      }
      voiceStore.setState('listening');
      return;
    }

    case 'memory_delete': {
      if (intent.memoryKey) {
        try {
          const { memory } = await import('@/agent/memory');
          // Intentar match exacto primero, luego por substring.
          let keyToDelete: string | null = intent.memoryKey;
          const existing = await memory.getFact(intent.memoryKey);
          if (!existing) {
            // Buscar por substring en las claves existentes.
            const allFacts = await memory.listFacts();
            const match = allFacts.find((f) =>
              f.key.toLowerCase().includes(intent.memoryKey!.toLowerCase()) ||
              f.value.toLowerCase().includes(intent.memoryKey!.toLowerCase()),
            );
            if (match) {
              keyToDelete = match.key;
            }
          }
          if (keyToDelete) {
            await memory.deleteFact(keyToDelete);
            const msg = `Hecho eliminado de mi memoria: ${keyToDelete}.`;
            voiceStore.pushTurn({ role: 'assistant', text: msg });
            syncToActiveChat('assistant', msg);
            speak(msg);
          } else {
            const msg = `No encontré nada en mi memoria que coincida con "${intent.memoryKey}".`;
            voiceStore.pushTurn({ role: 'assistant', text: msg });
            syncToActiveChat('assistant', msg);
            speak(msg);
          }
        } catch (e) {
          const errMsg = `No pude borrarlo de memoria: ${e instanceof Error ? e.message : String(e)}`;
          voiceStore.pushTurn({ role: 'assistant', text: errMsg });
          syncToActiveChat('assistant', errMsg);
          speak(errMsg);
        }
      }
      voiceStore.setState('listening');
      return;
    }

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
    syncToActiveChat('assistant', msg);
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
    syncToActiveChat('assistant', msg);
    speak(msg);
    voiceStore.setState('listening');
    return;
  }

  voiceStore.setState('thinking');

  // Construir historial de la conversación de voz (últimos 12 turnos).
  //
  // NOTA: `runVoiceCommand` ya hizo `pushTurn({ role: 'user', text: userText })`
  // antes de llamar a `runChatTurn`, por lo que `voiceStore.turns` ya INCLUYE
  // el turno del usuario actual. No debemos añadirlo otra vez al final del
  // array `msgs` o el LLM vería el mensaje duplicado.
  //
  // Además, filtramos turnos vacíos (interim que nunca se completaron,
  // notificaciones de background sin texto) — OpenRouter y otros providers
  // devuelven 400 si un mensaje assistant tiene content "".
  const recentTurns = voiceStore.turns
    .slice(-12)
    .filter((t) => t.text && t.text.trim().length > 0);

  // Mapear a Message, fusionando turnos consecutivos del mismo rol.
  // Esto es una red de seguridad: si por cualquier motivo hay dos user
  // turnos seguidos (p.ej. un interim que se coló), se fusionan en uno
  // para no violar la regla de alternancia user/assistant de OpenRouter.
  const historyMsgs: Message[] = [];
  for (const t of recentTurns) {
    const role: 'user' | 'assistant' = t.role === 'user' ? 'user' : 'assistant';
    const last = historyMsgs[historyMsgs.length - 1];
    if (last && last.role === role) {
      last.content += '\n' + t.text;
    } else {
      historyMsgs.push({ role, content: t.text });
    }
  }

  // System prompt con modos activos inline (NO como mensaje system separado
  // después del user — OpenRouter rechaza system messages intercalados).
  // Se construye dinámicamente para inyectar el contexto de chat memory.
  let systemPrompt = await buildLiveSystemPrompt();
  const modeTags: string[] = [];
  if (planMode) modeTags.push('[MODO PLAN]');
  if (pursueObjective) modeTags.push('[PERSEGUIR OBJETIVO]');
  if (cognitiveMode) modeTags.push('[MODO COGNITIVO]');
  if (modeTags.length) {
    systemPrompt += `\n\nModos activos: ${modeTags.join(', ')}`;
  }

  const msgs: Message[] = [
    { role: 'system', content: systemPrompt },
    ...historyMsgs,
  ];

  // Stream + speak en paralelo por frases
  let fullText = '';
  let sentenceBuffer = '';
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

    const finalText = result.text || fullText;

    // Fallback: si la respuesta está vacía, el modelo probablemente quiso
    // usar tools pero no puede en modo voz. Mostrar un mensaje útil.
    if (!finalText.trim()) {
      const fallback = 'No pude procesar eso en modo voz. Si necesitas buscar información o usar herramientas, abre el chat completo y pídelo allí.';
      voiceStore.updateTurn(turnId, { text: fallback, interim: false });
      opts.onAssistantTurnDone?.(fallback);
      syncToActiveChat('assistant', fallback);
      speak(fallback);
    } else {
      voiceStore.updateTurn(turnId, { text: finalText, interim: false });
      opts.onAssistantTurnDone?.(finalText);
      syncToActiveChat('assistant', finalText);
    }

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
      // Si el turno interim nunca recibió texto, eliminarlo en vez de dejar
      // un "[interrumpido]" vacío que rompería el history del próximo turno.
      if (fullText.trim()) {
        voiceStore.updateTurn(turnId, { text: fullText + ' [interrumpido]', interim: false });
      } else {
        // Eliminar el turno interim vacío
        useVoiceStore.setState((s) => ({ turns: s.turns.filter((t) => t.id !== turnId) }));
      }
      voiceStore.setState('listening');
      return;
    }
    const msg = `Error: ${e instanceof Error ? e.message : String(e)}`;
    if (fullText.trim()) {
      voiceStore.updateTurn(turnId, { text: fullText + '\n\n' + msg, interim: false });
    } else {
      // Sin texto parcial: reemplazar el turno interim vacío por el mensaje de error
      voiceStore.updateTurn(turnId, { text: msg, interim: false });
    }
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

// --- Delegación a background (con tools, igual que Composer) ----------------
//
// Esta función es NO-BLOQUEANTE desde el punto de vista del llamador
// (runVoiceCommand). Hace dos cosas:
//
//   FASE 1 (síncrona rápida, ~50ms): encola la tarea en el store, emite el
//   mensaje "Delegando en segundo plano...", lo habla por TTS y retorna.
//   El usuario recupera el turno inmediatamente y puede seguir hablando.
//
//   FASE 2 (asíncrona, fire-and-forget): arranca la tarea real con tools
//   (web_search, shell_exec, file_*, etc.) en un IIFE no awaited. Cuando
//   termina, genera una NOTIFICACIÓN NATURAL vía LLM (no hardcoded) y la
//   habla por voz. Si el usuario está en medio de otra conversación, la
//   notificación se encola en la cola de speechSynthesis y se reproduce
//   cuando el TTS actual termine.

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
    syncToActiveChat('assistant', msg);
    speak(msg);
    return;
  }

  // --- FASE 1: encolar + confirmar (rápido) --------------------------------
  const taskId = voiceStore.addBackgroundTask(label);
  const delegateMsg = `Delegando en segundo plano: ${label}. Te aviso cuando termine.`;
  voiceStore.pushTurn({
    role: 'assistant',
    text: delegateMsg,
    taskId,
  });
  syncToActiveChat('assistant', delegateMsg);
  speak(delegateMsg);
  opts.onBackgroundQueued?.(taskId, label);

  voiceStore.setBackgroundTaskStatus(taskId, 'running');
  opts.onBackgroundProgress?.(taskId, 'Iniciando tarea con herramientas…');

  // --- FASE 2: ejecutar la tarea en background (fire-and-forget) ----------
  // NO se hace await aquí — el llamador (runVoiceCommand) retorna inmediatamente
  // después de la FASE 1, permitiendo al usuario seguir hablando.
  void (async () => {
    try {
      const llm = await createProvider(effProviderId, { apiKeyOverride: apiKey });
      const { buildAdvancedToolsList, dispatchAdvancedTool } = await import('@/lib/tools');
      const { parseTextToolCalls, maybeHasTextToolCall } = await import('@/lib/textToolParser');

      const taskResult = await runTaskWithTools(llm, effModelId, objective, {
        tools: buildAdvancedToolsList(),
        dispatch: dispatchAdvancedTool,
        parseTextToolCalls,
        maybeHasTextToolCall,
        onProgress: (msg) => {
          opts.onBackgroundProgress?.(taskId, msg);
        },
      });

      const ok = taskResult.ok;
      voiceStore.setBackgroundTaskStatus(taskId, ok ? 'done' : 'failed', taskResult.summary);

      // Generar notificación natural con LLM (no hardcoded)
      const notification = await generateNaturalNotification(
        llm,
        effModelId,
        objective,
        taskResult.summary,
        ok,
      );

      // Notificar al usuario — el AGENTE responde naturalmente.
      // Si el usuario está en medio de una conversación, speechSynthesis
      // encola la notificación y se reproduce cuando termine el TTS actual.
      voiceStore.pushTurn({ role: 'assistant', text: notification, taskId });
      syncToActiveChat('assistant', notification);

      // Reproducir la notificación por voz. NO cambiamos el state a
      // 'speaking' si el usuario está en 'thinking' o 'speaking' (en medio
      // de un chat turn) — eso interrumpiría visualmente la conversación.
      // El poller anti-eco del LiveOverlay detecta `speechSynthesis.speaking`
      // directamente y pausa el ASR independientemente del state.
      await playNotificationTTS(notification);

      opts.onBackgroundDone?.(taskId, taskResult.summary, ok);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      voiceStore.setBackgroundTaskStatus(taskId, 'failed', undefined, errMsg);
      const errorMsg = `Error en background: ${errMsg}`;
      voiceStore.pushTurn({ role: 'assistant', text: errorMsg, taskId });
      syncToActiveChat('assistant', errorMsg);

      await playNotificationTTS(`Hubo un error en la tarea: ${errMsg.slice(0, 120)}`);

      opts.onBackgroundDone?.(taskId, errMsg, false);
    }
  })();
}

/**
 * Reproduce una notificación TTS respetando el estado actual del usuario:
 *   - Si state es 'listening' o 'idle': transicionar a 'speaking', hablar,
 *     y volver a 'listening' al terminar.
 *   - Si state es 'thinking' o 'speaking' (usuario en medio de un chat turn):
 *     NO cambiar state — sólo encolar el TTS. Se reproducirá después del
 *     TTS actual. El poller anti-eco pausará el ASR automáticamente.
 *
 * Esto permite que la notificación "Ya terminé" se sienta natural sin
 * interrumpir una conversación en curso.
 */
async function playNotificationTTS(text: string): Promise<void> {
  const cur = useVoiceStore.getState().state;
  const shouldManageState = cur === 'listening' || cur === 'idle';

  if (shouldManageState) {
    useVoiceStore.getState().setState('speaking');
  }
  speak(text);
  await waitForSpeechEnd();
  if (shouldManageState) {
    useVoiceStore.getState().setState('listening');
  }
}

// --- runTaskWithTools: igual que Composer.runChatWithTools pero简化 ----------
//
// Ejecuta un loop de hasta N rondas: streamChat → si hay tool_calls, los
// ejecuta y vuelve a llamar. Devuelve el texto final + un resumen corto.

interface TaskWithToolsOpts {
  tools: Tool[];
  dispatch: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; output: string; error?: string }>;
  parseTextToolCalls: (text: string) => { found: boolean; toolCalls: import('@/providers/types').ToolCall[]; cleanedText: string };
  maybeHasTextToolCall: (text: string) => boolean;
  onProgress?: (msg: string) => void;
}

interface TaskResult {
  ok: boolean;
  summary: string;
}

async function runTaskWithTools(
  llm: LLMProvider,
  modelId: string,
  objective: string,
  opts: TaskWithToolsOpts,
): Promise<TaskResult> {
  const isWindows = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
  const osName = isWindows ? 'Windows' : runtime.isTauri ? 'Linux/macOS' : 'navegador';
  const shellHint = isWindows
    ? 'El shell es PowerShell/CMD en Windows. Usa "dir" (no "ls"), "type" (no "cat"), rutas con "C:\\\\".'
    : 'El shell es bash en Linux. Usa "ls", "cat", rutas con "/home/".';

  const messages: Message[] = [
    {
      role: 'system',
      content:
        `Eres Weaver, un agente de escritorio PROACTIVO ejecutándose en ${osName}. ` +
        (runtime.isTauri
          ? 'Tienes acceso al sistema de archivos real y puedes ejecutar comandos shell. '
          : 'Estás en modo navegador (sin acceso al filesystem real). ') +
        shellHint + '\n\n' +
        'TIENES ACCESO A HERRAMIENTAS REALES para:\n' +
        '- Ejecutar comandos shell (shell_exec)\n' +
        '- Leer y escribir archivos (file_read, file_write, file_list)\n' +
        '- Buscar en internet (web_search)\n' +
        '- Descargar contenido de URLs (web_fetch)\n' +
        '- Generar archivos descargables (save_file)\n' +
        '- Renderizar HTML o PDF dentro del chat (render_html, render_pdf)\n' +
        '- Ejecutar código Python/Node/Bash en un sandbox efímero (sandbox_run)\n' +
        '- Recordar hechos clave (memory_save_fact, memory_list_facts, memory_delete_fact)\n' +
        '- Delegar a subagentes especializados (delegate_to_subagent)\n\n' +
        '═══ REGLAS DE TOOLS ═══\n' +
        '- web_search ya devuelve un resumen. Úsalo directamente.\n' +
        '- Si web_fetch falla, no insistas. Usa web_search.\n' +
        '- Para crear archivos que el usuario descargue, usa save_file (no file_write).\n' +
        '- RENDERIZAR EN EL CHAT: Si el usuario pide renderizar/mostrar/previsualizar HTML en el\n' +
        '  chat, usa render_html — NO uses file_write ni save_file.\n' +
        '- RESULTADOS DE TOOLS: Si una tool devuelve datos, REPÓRTELLOS. NUNCA digas "no se encontró\n' +
        '  información" si la tool devolvió contenido. Los resultados de las tools son VERDAD.\n\n' +
        '═══ COMPORTAMIENTO PROACTIVO ═══\n' +
        '1. NUNCA te rindas al primer error. Si algo falla, intenta una alternativa.\n' +
        '2. Si no conoces algo, DESCÚBRELO primero con shell_exec.\n' +
        '3. No pidas confirmación para cada paso. Solo actúa y reporta al final.\n' +
        '4. Cuando termines, escribe una RESPUESTA FINAL clara al usuario con:\n' +
        '   a) Resumen breve de lo que hiciste.\n' +
        '   b) Resultados principales.\n' +
        '   c) Una pregunta de seguimiento opcional.\n\n' +
        'Esta tarea se ejecuta en SEGUNDO PLANO. El usuario puede estar hablando\n' +
        'de otras cosas mientras tanto. Tu respuesta final será leída por voz\n' +
        'cuando termines, así que hazla CONCISA y NATURAL (máx 3-4 frases).\n' +
        'No uses markdown. Texto plano hablado.',
    },
    { role: 'user', content: objective },
  ];

  const MAX_TOOL_ROUNDS = 8;
  let producedFinalText = '';
  let producedOk = true;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let roundText = '';
    const result = await streamChat(llm, modelId, messages, {
      tools: opts.tools,
      onDelta: (delta) => { roundText += delta; },
    });

    // Registrar uso
    try {
      const { metrics } = await import('@/lib/metrics');
      metrics.recordUsage({
        providerId: llm.info.id,
        model: modelId,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        source: 'voice-bg',
        success: result.toolCalls.length === 0 || result.text.trim().length > 0,
        taskKind: 'voice-background',
      });
    } catch { /* ignore */ }

    // Detectar tool calls emitidos como texto (modelos que no usan function calling nativo)
    let effectiveToolCalls = result.toolCalls;
    let effectiveText = result.text;
    if (effectiveToolCalls.length === 0 && opts.maybeHasTextToolCall(result.text)) {
      const parsed = opts.parseTextToolCalls(result.text);
      if (parsed.found) {
        effectiveToolCalls = parsed.toolCalls;
        effectiveText = parsed.cleanedText;
      }
    }

    // Si no hay tool calls, el LLM ya respondió → terminamos
    if (effectiveToolCalls.length === 0) {
      if (effectiveText && effectiveText.trim().length > 0) {
        producedFinalText = effectiveText;
      }
      break;
    }

    // Agregar el mensaje del asistente con tool_calls al historial
    messages.push({
      role: 'assistant',
      content: effectiveText || null,
      tool_calls: effectiveToolCalls,
    });

    // Ejecutar cada tool call y agregar resultados
    for (const tc of effectiveToolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch { /* ignore parse errors */ }

      const toolLabel = formatToolLabel(tc.function.name, args);
      opts.onProgress?.(`${tc.function.name}: ${toolLabel}`);

      const toolResult = await opts.dispatch(tc.function.name, args);
      const llmResult = toolResult.ok
        ? toolResult.output.slice(0, 4000)
        : `ERROR: ${toolResult.error ?? 'unknown'}`;

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: llmResult,
      });
    }

    // Pequeña pausa para que el UI se actualice
    await new Promise((r) => setTimeout(r, 50));
  }

  // Si el LLM nunca produjo texto final (sólo llamó tools), forzar respuesta
  if (!producedFinalText.trim()) {
    messages.push({
      role: 'user',
      content:
        'Ya usaste las herramientas necesarias. Ahora DEBES responderme en texto plano:\n' +
        '1) Un resumen breve de lo que hiciste.\n' +
        '2) Los resultados principales.\n' +
        'No intentes usar más herramientas. Responde directamente.',
    });
    try {
      const finalResult = await streamChat(llm, modelId, messages, {
        onDelta: (delta) => { producedFinalText += delta; },
      });
      producedFinalText = finalResult.text || producedFinalText;

      // Limpiar tool calls text-based residuales
      if (opts.maybeHasTextToolCall(producedFinalText)) {
        const parsed = opts.parseTextToolCalls(producedFinalText);
        if (parsed.found) {
          producedFinalText = parsed.cleanedText;
        }
      }
    } catch (e) {
      producedOk = false;
      producedFinalText = `Error generando respuesta final: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Si todo falló y no hay texto, fallback
  if (!producedFinalText.trim()) {
    producedFinalText = 'La tarea terminó pero no pude generar un resumen. Revisa el chat para más detalles.';
    producedOk = false;
  }

  return {
    ok: producedOk,
    summary: producedFinalText.slice(0, 800),
  };
}

function formatToolLabel(toolName: string, args: Record<string, unknown>): string {
  switch (toolName) {
    case 'web_search':
      return `buscando: "${args.query ?? args.q ?? ''}"`;
    case 'web_fetch':
      return `descargando: ${args.url ?? ''}`;
    case 'sandbox_run':
      return `ejecutando ${args.language ?? 'python'}: ${(String(args.code ?? '').split('\n')[0] ?? '').slice(0, 60)}`;
    case 'shell_exec':
      return `ejecutando: ${(args.command ?? '').toString().slice(0, 60)}`;
    case 'file_read':
      return `leyendo: ${args.path ?? ''}`;
    case 'file_write':
      return `escribiendo: ${args.path ?? ''}`;
    case 'file_list':
      return `listando: ${args.path ?? ''}`;
    case 'save_file':
      return `generando: ${args.filename ?? 'archivo'}`;
    default:
      if (toolName.startsWith('mcp__')) {
        const parts = toolName.split('__');
        return `MCP · ${parts[parts.length - 1]}`;
      }
      return toolName;
  }
}

// --- Notificación natural (LLM-generated) -----------------------------------
//
// En lugar de hardcodear "Tarea completada: X", pedimos al LLM que genere
// una notificación natural, conversacional, breve (1-3 frases), adecuada
// para voz. El agente "responde" al usuario como lo haría un colega que
// acaba de terminar una tarea.

async function generateNaturalNotification(
  llm: LLMProvider,
  modelId: string,
  originalObjective: string,
  taskSummary: string,
  ok: boolean,
): Promise<string> {
  // Si el taskSummary ya es conversacional y breve, usarlo directamente.
  // Esto evita gastar tokens innecesariamente cuando la propia respuesta
  // del task loop ya es adecuada.
  if (ok && taskSummary.length > 0 && taskSummary.length < 220) {
    // Heurística simple: si starts con "Ya", "Listo", "He ", "Terminé",
    // "Encontré", asumimos que ya es una notificación natural.
    const conversationalStarters = /^(ya|listo|he |terminé|encontré|aquí|hice|busqué|investigué|resumí|creé|generé|guardé|escribí|actualicé|eliminé|abr[ií]|ejecut[eé])/i;
    if (conversationalStarters.test(taskSummary.trim())) {
      return taskSummary;
    }
  }

  const statusHint = ok
    ? 'La tarea se completó con éxito.'
    : 'La tarea falló o no se pudo completar totalmente.';

  const messages: Message[] = [
    {
      role: 'system',
      content:
        'Eres Weaver en modo voz. Acabas de terminar una tarea en segundo plano ' +
        'mientras conversabas con el usuario. Ahora debes AVISARLE que terminaste, ' +
        'de forma NATURAL y BREVE (1-3 frases máx), como un colega que levanta la ' +
        'voz para decir "ya terminé lo que me pediste".\n\n' +
        'REGLAS:\n' +
        '- No uses markdown. Texto plano hablado.\n' +
        '- Empieza DIRECTAMENTE con la notificación (no digas "Notificación:").\n' +
        '- Si la tarea tuvo éxito, menciona brevemente QUÉ encontraste/hiciste.\n' +
        '- Si falló, di qué pasó y qué podría intentar el usuario.\n' +
        '- No superes las 3 frases. Sé conciso.\n' +
        '- Tono cercano, no robótico.',
    },
    {
      role: 'user',
      content:
        `Tarea original que pedí: "${originalObjective.slice(0, 300)}"\n\n` +
        `${statusHint}\n\n` +
        `Resumen de lo que hice/encontré:\n${taskSummary.slice(0, 600)}\n\n` +
        `Avisaeme naturalmente que terminaste.`,
    },
  ];

  try {
    const result = await streamChat(llm, modelId, messages, {});
    const text = result.text.trim();
    if (text) return text;
  } catch (e) {
    console.warn('[Live] generateNaturalNotification failed, falling back:', e);
  }

  // Fallback final (sólo si el LLM falló) — still better than hardcoded
  return ok
    ? `Listo, ya terminé. ${taskSummary.slice(0, 150)}`
    : `No pude completar la tarea. ${taskSummary.slice(0, 150)}`;
}
