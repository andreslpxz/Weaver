/**
 * Wake Lock helper — evita que el sistema operativo / WebView reduzca la
 * prioridad de la app (y por tanto ralentice el streaming del agente)
 * mientras hay una tarea en curso, incluso si la ventana está minimizada
 * o en segundo plano.
 *
 * Contexto: cuando una ventana de Tauri (WebKitGTK / WebView2 / WKWebView)
 * pierde visibilidad, el sistema puede bajarle prioridad de CPU y el motor
 * JS puede reducir la frecuencia de ciertos trabajos en segundo plano. La
 * Screen Wake Lock API (soportada en los motores modernos que usan estos
 * WebViews) le pide al SO que no entre en modo de ahorro de energía
 * agresivo mientras el lock esté activo — ayuda a que el agente siga
 * procesando a velocidad normal aunque el usuario minimice la app.
 *
 * Es best-effort: en plataformas/versiones donde no está disponible,
 * simplemente no hace nada (no rompe el flujo del agente).
 *
 * Límite conocido: el Wake Lock evita que el SO apague pantalla/suspenda,
 * pero en algunos WebViews (notablemente WebView2 minimizado en Windows)
 * el throttling de JS en segundo plano puede persistir a pesar del lock.
 * La única forma 100% robusta de evitarlo del todo es correr el streaming
 * HTTP en el proceso nativo de Rust en vez del WebView — hoy el proyecto
 * solo hace eso para Bedrock (por la firma SigV4). Si el problema persiste
 * tras este fix, ese sería el siguiente paso (mover fetch+SSE de los
 * adapters de providers/adapters/*.ts a un comando Tauri en src-tauri/).
 */

let currentLock: WakeLockSentinel | null = null;
let refCount = 0;

/**
 * Adquiere el wake lock (si aún no estaba adquirido) y suma una referencia.
 * Llamar una vez por cada tarea del agente que arranca.
 */
export async function acquireAgentWakeLock(): Promise<void> {
  refCount++;
  if (currentLock) return; // ya adquirido por una tarea anterior aún en curso
  try {
    if ('wakeLock' in navigator) {
      currentLock = await navigator.wakeLock.request('screen');
      // Si el SO libera el lock por su cuenta (p.ej. cambio de foco extremo),
      // lo re-adquirimos cuando la ventana vuelva a estar visible.
      currentLock.addEventListener('release', () => {
        currentLock = null;
      });
    }
  } catch {
    // No soportado o denegado — seguimos sin wake lock, no es crítico.
    currentLock = null;
  }
}

/**
 * Libera una referencia; cuando llega a 0, suelta el wake lock real.
 * Llamar en el finally de cada tarea del agente (éxito, error o cancelación).
 */
export async function releaseAgentWakeLock(): Promise<void> {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  try {
    await currentLock?.release();
  } catch {
    // ignore
  } finally {
    currentLock = null;
  }
}

// Re-adquirir automáticamente si la pestaña/ventana vuelve a visibilidad
// mientras aún hay tareas en curso (algunos navegadores sueltan el lock
// al perder visibilidad y no lo devuelven solos).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && refCount > 0 && !currentLock) {
      acquireAgentWakeLock().catch(() => {});
    }
  });
}
