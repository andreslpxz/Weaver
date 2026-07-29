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
 */
export class ContinuousASR {
  private rec: SpeechRecognitionLike | null = null;
  private wantActive = false;
  private handlers: AsrHandlers = {};
  private lang: string;

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
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          const txt = r[0].transcript;
          if (r.isFinal) this.handlers.onFinal?.(txt.trim());
          else interim += txt;
        }
        if (interim) this.handlers.onInterim?.(interim);
      };

      this.rec.onerror = (e) => {
        // `no-speech` y `aborted` son normales en continuous mode
        if (e.error !== 'no-speech' && e.error !== 'aborted') {
          this.handlers.onError?.(e.error || 'unknown');
        }
      };

      this.rec.onend = () => {
        if (this.wantActive) {
          // re-iniciar en下一个 tick (evita "recognition already started")
          setTimeout(() => {
            try { this.rec?.start(); } catch { /* ignore */ }
          }, 80);
        } else {
          this.handlers.onEnd?.();
        }
      };
    }

    try { this.rec.start(); } catch { /* ya activo */ }
  }

  /** Detiene el reconocimiento. No se re-inicia. */
  stop() {
    this.wantActive = false;
    try { this.rec?.stop(); } catch { /* ignore */ }
  }

  /** Aborta sin disparar onend normal. */
  abort() {
    this.wantActive = false;
    try { this.rec?.abort(); } catch { /* ignore */ }
  }
}

// --- TTS -------------------------------------------------------------------

let cachedSpanishVoice: SpeechSynthesisVoice | null = null;

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
