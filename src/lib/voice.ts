/**
 * Weaver Live — capa de voz basada en Web Speech API.
 *
 * Diseño:
 *  - ASR: `webkitSpeechRecognition` con `continuous=true` + `interimResults=true`.
 *    Soporta español (es-ES, es-419) y re-inicia automáticamente cuando el
 *    navegador cierra el reconocimiento (suele cortar cada ~30s).
 *  - TTS: `speechSynthesis` con selección de voz en español.
 *  - Interrupción: cualquier `onstart` del ASR cancela el TTS en curso,
 *    y cualquier `speak()` cancela el ASR (opcional, configurable).
 *  - Detección de soporte: si el webview no implementa Web Speech API
 *    (caso Linux WebKitGTK), se ofrece fallback por texto.
 *
 * No usa el SDK de ZAI backend-only. Esto vive 100% en el renderer.
 */

// --- Tipos mínimos para Web Speech API (no están en TS DOM lib) -------------
interface SpeechRecognitionAlternativeLike { transcript: string; confidence: number }
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
}
interface SpeechRecognitionResultListLike { length: number; [i: number]: SpeechRecognitionResultLike }
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike { error: string; message: string }

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isASRSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export function isTTSSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// --- ASR -------------------------------------------------------------------

export interface AsrHandlers {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (err: string) => void;
  onEnd?: () => void;
  onStart?: () => void;
}

/**
 * Crea un reconocedor continuo. Re-inicia automáticamente en `onend` si el
 * usuario no lo detuvo explícitamente (los navegadores cortan cada ~30s).
 *
 * BUFFERING + MERGE DE FINALS:
 *   En modo `continuous=true`, el navegador emite resultados `final` por cada
 *   micro-pausa del habla. Además, en muchos navegadores (Chrome/Edge) los
 *   `final` posteriores incluyen el texto ACUMULADO de toda la sesión, no
 *   solo el nuevo chunk. Esto produce síntomas como:
 *
 *     Usuario dice: "Hola qué puedes hacer"
 *     Finals recibidos: "Hola", "Hola Qué", "Hola Qué puedes", "Hola Qué puedes hacer"
 *
 *   Si flushearamos por cada final, tendríamos 4 turnos del usuario. Si
 *   acumulamos sin más, tendríamos "Hola Hola Qué Hola Qué puedes ...".
 *
 *   Solución:
 *     1. Acumulamos finals en `finalBuffer` con `mergeText()` que detecta
 *        si el nuevo final extiende, duplica o es disjunto del buffer.
 *     2. Trackeamos `lastFlushedText` y lo strippeamos del prefijo de
 *        nuevos finals (para no re-incluir texto ya flusheado).
 *     3. Flusheamos tras `FLUSH_DELAY` ms de silencio (2.5s, suficiente
 *        para pausas naturales dentro de una frase sin cortar).
 *     4. Reset `lastFlushedText` en auto-restart (nueva sesión del navegador).
 */
export class ContinuousASR {
  private rec: SpeechRecognitionLike | null = null;
  private wantActive = false;
  private handlers: AsrHandlers = {};
  private lang: string;

  /** Buffer de finales acumulados pendientes de flush. */
  private finalBuffer = '';
  /** Último texto flusheado (para strippear prefijos acumulados). */
  private lastFlushedText = '';
  /** Timer que dispara el flush tras FLUSH_DELAY ms sin nuevos resultados. */
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** ms de silencio tras un final para considerar el turno completo. */
  private readonly FLUSH_DELAY = 2500;
  /** ms máximos de buffer antes de forzar flush (turno muy largo). */
  private readonly FLUSH_MAX = 10000;
  private flushMaxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(lang = 'es-ES') {
    this.lang = lang;
  }

  setLang(lang: string) {
    this.lang = lang;
    if (this.rec) this.rec.lang = lang;
  }

  setHandlers(h: AsrHandlers) {
    this.handlers = h;
  }

  /**
   * Fusiona `newText` en `buffer` detectando overlap:
   *   - Si newText extiende buffer (accumulated transcript) → replace
   *   - Si buffer extiende newText (subset) → keep buffer
   *   - Si overlap por sufijo → keep el más largo
   *   - Si disjuntos → append con espacio
   */
  private mergeText(buffer: string, newText: string): string {
    if (!buffer) return newText;
    const lb = buffer.toLowerCase().trim();
    const ln = newText.toLowerCase().trim();
    if (!ln) return buffer;

    if (ln.startsWith(lb)) return newText;          // newText extiende buffer
    if (lb.startsWith(ln)) return buffer;            // buffer extiende newText
    if (ln.endsWith(lb)) return newText;             // overlap por sufijo
    if (lb.endsWith(ln)) return buffer;              // overlap por prefijo
    return buffer + ' ' + newText;                    // disjuntos
  }

  /** Dispara el onFinal con el buffer acumulado y lo limpia. */
  private flushFinals() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushMaxTimer) {
      clearTimeout(this.flushMaxTimer);
      this.flushMaxTimer = null;
    }
    const text = this.finalBuffer.trim();
    this.finalBuffer = '';
    if (text) {
      this.lastFlushedText = text;
      this.handlers.onFinal?.(text);
    }
  }

  start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      this.handlers.onError?.('ASR no soportado en este navegador/webview');
      return;
    }
    if (this.wantActive && this.rec) return;
    this.wantActive = true;

    if (!this.rec) {
      this.rec = new Ctor();
      this.rec.lang = this.lang;
      this.rec.continuous = true;
      this.rec.interimResults = true;
      this.rec.maxAlternatives = 1;

      this.rec.onstart = () => this.handlers.onStart?.();

      this.rec.onresult = (e) => {
        let interim = '';
        let hadNewFinal = false;

        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const txt = r[0].transcript;
          if (r.isFinal) {
            let trimmed = txt.trim();
            if (!trimmed) continue;

            // Strippear el texto ya flusheado si el navegador envía
            // transcript acumulado (p.ej. "Hola Qué puedes" cuando ya
            // flusheamos "Hola" en un flush anterior).
            if (this.lastFlushedText) {
              const lfl = this.lastFlushedText.toLowerCase();
              const ltr = trimmed.toLowerCase();
              if (ltr.startsWith(lfl)) {
                trimmed = trimmed.slice(this.lastFlushedText.length).trim();
              } else if (lfl.startsWith(ltr)) {
                // El nuevo final es un subset del ya flusheado → ignorar
                trimmed = '';
              }
            }
            if (trimmed) {
              this.finalBuffer = this.mergeText(this.finalBuffer, trimmed);
              hadNewFinal = true;
            }
          } else {
            interim += txt;
          }
        }

        // Mostrar el buffer + interim actual para que la UI refleje todo lo dicho.
        if (interim) {
          const fullInterim = this.finalBuffer
            ? this.finalBuffer + ' ' + interim
            : interim;
          this.handlers.onInterim?.(fullInterim);
        } else if (hadNewFinal) {
          this.handlers.onInterim?.(this.finalBuffer);
        }

        // Resetear el debounce de flush tras cada resultado (final o interim
        // con buffer pendiente — el usuario sigue hablando).
        if (hadNewFinal || (interim && this.finalBuffer)) {
          if (this.flushTimer) clearTimeout(this.flushTimer);
          this.flushTimer = setTimeout(() => this.flushFinals(), this.FLUSH_DELAY);
          if (!this.flushMaxTimer) {
            this.flushMaxTimer = setTimeout(() => this.flushFinals(), this.FLUSH_MAX);
          }
        }
      };

      this.rec.onerror = (e) => {
        // `no-speech` y `aborted` son normales en continuous mode
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          this.handlers.onError?.(e.error || 'unknown');
        }
      };

      this.rec.onend = () => {
        if (this.wantActive) {
          // Auto-restart: el navegador cortó (~30s o silence timeout).
          // Reset lastFlushedText porque la nueva sesión empieza desde cero
          // (no debe incluir texto de la sesión anterior).
          this.lastFlushedText = '';
          setTimeout(() => {
            try { this.rec?.start(); } catch { /* ignore */ }
          }, 80);
        } else {
          // Detención explícita: flushear antes de notificar onEnd.
          this.flushFinals();
          this.handlers.onEnd?.();
        }
      };
    }

    try { this.rec.start(); } catch { /* ya activo */ }
  }

  /** Detiene el reconocimiento. Flushea el buffer pendiente. No se re-inicia. */
  stop() {
    this.wantActive = false;
    this.flushFinals();
    try { this.rec?.stop(); } catch { /* ignore */ }
  }

  /**
   * Pausa el reconocimiento SIN flushear ni limpiar el buffer.
   * Usado para cancelación de eco en modo altavoces: cuando el agente
   * empieza a hablar (TTS), pausamos el ASR para que no capte la voz
   * del agente por el micrófono. Al reanudar con `start()`, el buffer
   * se conserva (aunque normalmente estará vacío porque el usuario no
   * debería estar hablando durante el eco).
   */
  pause() {
    this.wantActive = false;
    try { this.rec?.abort(); } catch { /* ignore */ }
  }

  /** Aborta sin flushear. Descarta el buffer pendiente. */
  abort() {
    this.wantActive = false;
    this.finalBuffer = '';
    this.lastFlushedText = '';
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushMaxTimer) {
      clearTimeout(this.flushMaxTimer);
      this.flushMaxTimer = null;
    }
    try { this.rec?.abort(); } catch { /* ignore */ }
  }
}

// --- TTS -------------------------------------------------------------------

let cachedSpanishVoice: SpeechSynthesisVoice | null = null;

// --- Echo cancellation priming ---------------------------------------------

/**
 * Pide permiso de micrófono con echo cancellation + noise suppression
 * activados ANTES de iniciar el SpeechRecognition. Aunque Web Speech API
 * usa su propio pipeline de audio, en muchos navegadores (Chrome/Edge)
 * los constraints del getUserMedia se aplican globalmente a la sesión
 * de audio del tab, mejorando la cancelación de eco.
 *
 * El stream se libera inmediatamente — solo queremos "activar" los
 * constraints del browser. Es un best-effort: si falla, no es crítico.
 */
export async function primeMicAEC(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      } as MediaTrackConstraints,
    });
    // Liberar inmediatamente — los constraints quedan "sticky" para la
    // sesión de audio del tab en muchos navegadores.
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    // Ignorar — no es crítico. El SpeechRecognition puede funcionar sin esto.
  }
}

function pickSpanishVoice(): SpeechSynthesisVoice | null {
  if (!isTTSSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  // Preferencia: es-ES > es-MX > es-419 > es-* > cualquier "es"
  const prefs = ['es-ES', 'es-MX', 'es-419', 'es-US', 'es-AR', 'es-CO', 'es'];
  for (const p of prefs) {
    const v = voices.find((v) => v.lang === p || v.lang.startsWith(p));
    if (v) return v;
  }
  return voices.find((v) => v.lang.toLowerCase().startsWith('es')) ?? null;
}

export function primeVoices(): Promise<void> {
  return new Promise((resolve) => {
    if (!isTTSSupported()) return resolve();
    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      cachedSpanishVoice = pickSpanishVoice();
      return resolve();
    }
    let resolved = false;
    const handler = () => {
      if (resolved) return;
      resolved = true;
      cachedSpanishVoice = pickSpanishVoice();
      resolve();
    };
    window.speechSynthesis.onvoiceschanged = handler;
    // Fallback: forzar después de 800ms
    setTimeout(handler, 800);
  });
}

export interface SpeakOpts {
  lang?: string;
  rate?: number;     // 0.5 – 2.0, default 1.05
  pitch?: number;    // 0 – 2, default 1
  volume?: number;   // 0 – 1, default 1
  onEnd?: () => void;
  onStart?: () => void;
  onBoundary?: (charIndex: number) => void;
}

/**
 * Sintetiza texto a voz. Interrumpe cualquier síntesis en curso.
 * Soporta streaming sentence-by-sentence: si llamas speak() mientras ya
 * está hablando, encola el nuevo fragmente (max 4 en cola, los demás se descartan).
 */
export function speak(text: string, opts: SpeakOpts = {}) {
  if (!isTTSSupported() || !text.trim()) {
    opts.onEnd?.();
    return;
  }
  // Cancelar cola actual si está llena
  if (window.speechSynthesis.speaking && window.speechSynthesis.pending) {
    // ya hay cosas en cola, dejamos que termine la actual y reemplazamos cola
  }

  const u = new SpeechSynthesisUtterance(text);
  u.lang = opts.lang ?? 'es-ES';
  u.rate = opts.rate ?? 1.05;
  u.pitch = opts.pitch ?? 1;
  u.volume = opts.volume ?? 1;

  const v = cachedSpanishVoice ?? pickSpanishVoice();
  if (v) u.voice = v;

  if (opts.onEnd) u.onend = opts.onEnd;
  if (opts.onStart) u.onstart = opts.onStart;
  if (opts.onBoundary) u.onboundary = (e) => opts.onBoundary?.(e.charIndex);

  window.speechSynthesis.speak(u);
}

/** Cancela todo TTS en curso y en cola. */
export function stopSpeaking() {
  if (!isTTSSupported()) return;
  window.speechSynthesis.cancel();
}

/** Pausa la síntesis (no cancela). */
export function pauseSpeaking() {
  if (!isTTSSupported()) return;
  window.speechSynthesis.pause();
}

/** Reanuda la síntesis pausada. */
export function resumeSpeaking() {
  if (!isTTSSupported()) return;
  window.speechSynthesis.resume();
}

export function isSpeaking(): boolean {
  if (!isTTSSupported()) return false;
  return window.speechSynthesis.speaking;
}

// --- Utilidades ------------------------------------------------------------

/**
 * Divide un texto en fragmentos aptos para TTS: por frases (.,!?;), con
 * longitud máxima ~180 chars. Permite hablar en streaming a medida que el
 * LLM genera texto, sin esperar a tener todo el mensaje.
 */
export function splitIntoSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?;:…]+[.!?;:…]+["'”»)\]]*\s*/g;
  let rest = text;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    out.push(m[0].trim());
  }
  rest = rest.slice(re.lastIndex);
  if (rest.trim()) out.push(rest.trim());

  // Fusionar fragmentos muy cortos (<30 chars) con el siguiente
  const merged: string[] = [];
  for (const s of out) {
    if (merged.length && merged[merged.length - 1].length < 30) {
      merged[merged.length - 1] += ' ' + s;
    } else {
      merged.push(s);
    }
  }
  return merged.filter(Boolean);
}
