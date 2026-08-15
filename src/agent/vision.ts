/**
 * vision.ts
 *
 * Jerarquía de visión del agente:
 *
 *   1. AT-SPI/UIA/AX (rápido, determinista, gratis) — siempre primero.
 *   2. OCR local (Tesseract) si el árbol de accesibilidad no da suficiente
 *      info (canvas, nodos vacíos, apps sin soporte a11y). Sin salir de la
 *      máquina.
 *   3. VLM (Vision Language Model) — SÓLO si la tarea requiere entender
 *      contenido visual no textual (diseño, layout, modelo 3D, gráfico).
 *      Es OPT-IN EXPLÍCITO por tarea: el usuario debe aprobar el envío
 *      de imágenes al modelo.
 *
 * Nunca se suben imágenes a un proveedor sin consentimiento explícito.
 * El usuario puede:
 *   - Configurar proveedores con soporte de visión (gemini-1.5-pro,
 *     gpt-4o, claude-3-5-sonnet) en Ajustes → Visión.
 *   - Aprobar/denegar caso a caso mediante un prompt.
 *   - Denegar globalmente (default).
 */

import { runtime, atspi } from '@/lib/tauri';
import { dispatchAdvancedTool } from '@/lib/tools';

// ============================================================================
// Helper local — ejecuta un comando shell y devuelve { ok, output }.
// ============================================================================

async function shellExec(command: string, cwd?: string, timeout = 30000): Promise<{ ok: boolean; output: string; error?: string }> {
  const r = await dispatchAdvancedTool('shell_exec', { command, cwd, timeout });
  return { ok: r.ok, output: r.output, error: r.error };
}

// ============================================================================
// Tipos
// ============================================================================

export type VisionSource = 'atspi' | 'ocr' | 'vlm';

export interface VisionResult {
  source: VisionSource;
  /** Texto extraído (vacío si la fuente es solo estructural). */
  text: string;
  /** Árbol serializado (solo si source === 'atspi'). */
  tree?: string;
  /** Ruta al snapshot temporal (solo si source === 'ocr' o 'vlm'). */
  imagePath?: string;
  /** Metadatos adicionales. */
  meta?: Record<string, string | number>;
  /** Tiempo total en ms. */
  elapsedMs: number;
}

export interface VisionRequest {
  /** Qué queremos ver: 'focused_app', 'window:<title>', 'screen', 'region:x,y,w,h'. */
  target: string;
  /** Profundidad máxima del árbol AT-SPI. */
  maxDepth?: number;
  /** Si true, permite ir a OCR si AT-SPI no basta. */
  allowOcr?: boolean;
  /** Si true, permite ir a VLM si OCR no basta. REQUIERE consentimiento explícito. */
  allowVlm?: boolean;
  /** ProviderId para VLM (ej. 'google', 'openai'). Si null y allowVlm, se usa el activo. */
  vlmProviderId?: string | null;
  /** Prompt para el VLM (qué preguntarle sobre la imagen). */
  vlmPrompt?: string;
}

export type Consent = 'granted' | 'denied' | 'ask';

// ============================================================================
// Función principal — decide en orden jerárquico
// ============================================================================

export async function see(
  req: VisionRequest,
  opts: {
    /** Devuelve si el usuario consiente enviar la imagen a un VLM. */
    onVlmConsent?: () => Promise<boolean>;
  } = {},
): Promise<VisionResult> {
  const start = Date.now();

  // 1. AT-SPI / UIA / AX primero.
  try {
    const tree = await readAccessibilityTree(req.target, req.maxDepth ?? 4);
    if (tree && treeHasEnoughInfo(tree)) {
      return {
        source: 'atspi',
        text: extractTextFromTree(tree),
        tree,
        elapsedMs: Date.now() - start,
      };
    }
    // Si AT-SPI devolvió algo pero sin info útil, seguimos al paso 2.
  } catch {
    // AT-SPI falló (posiblemente en navegador) — seguimos al paso 2.
  }

  // 2. OCR local (Tesseract) si está permitido.
  if (req.allowOcr && runtime.isTauri) {
    try {
      const ocrResult = await captureAndOcr(req.target);
      if (ocrResult.text && ocrResult.text.trim().length > 20) {
        return {
          source: 'ocr',
          text: ocrResult.text,
          imagePath: ocrResult.imagePath,
          meta: { engine: 'tesseract', lang: 'spa+eng' },
          elapsedMs: Date.now() - start,
        };
      }
    } catch {
      // OCR falló (tesseract no instalado) — seguir al paso 3.
    }
  }

  // 3. VLM — SÓLO si está permitido Y el usuario consiente.
  if (req.allowVlm) {
    const consent = opts.onVlmConsent ? await opts.onVlmConsent() : false;
    if (!consent) {
      return {
        source: 'vlm',
        text: '[VLM denegado por el usuario — no se envió la imagen]',
        elapsedMs: Date.now() - start,
      };
    }
    try {
      const vlmResult = await captureAndAskVlm(req.target, req.vlmPrompt ?? 'Describe lo que ves.', req.vlmProviderId);
      return {
        source: 'vlm',
        text: vlmResult.text,
        imagePath: vlmResult.imagePath,
        meta: { provider: vlmResult.provider, model: vlmResult.model },
        elapsedMs: Date.now() - start,
      };
    } catch (e) {
      return {
        source: 'vlm',
        text: `[VLM error: ${e instanceof Error ? e.message : String(e)}]`,
        elapsedMs: Date.now() - start,
      };
    }
  }

  // Ninguna fuente disponible.
  return {
    source: 'atspi',
    text: '[Sin información visual disponible — AT-SPI vacío, OCR deshabilitado, VLM deshabilitado]',
    elapsedMs: Date.now() - start,
  };
}

// ============================================================================
// Paso 1: árbol de accesibilidad
// ============================================================================

async function readAccessibilityTree(target: string, maxDepth: number): Promise<string | null> {
  if (!runtime.isTauri) return null;

  // focused_app, screen, window:<title>
  if (target === 'focused_app' || target === 'screen') {
    const apps = await atspi.listApplications();
    // Heurística: devolver la primera app con nombre no vacío.
    if (apps.length === 0) return null;
    const app = apps[0];
    const tree = await atspi.queryTree(app.bus_name, app.root_path, maxDepth);
    return typeof tree === 'string' ? tree : JSON.stringify(tree);
  }
  if (target.startsWith('window:')) {
    const title = target.slice(7).toLowerCase();
    const apps = await atspi.listApplications();
    const app = apps.find((a) => a.name.toLowerCase().includes(title)) ?? apps[0];
    if (!app) return null;
    const tree = await atspi.queryTree(app.bus_name, app.root_path, maxDepth);
    return typeof tree === 'string' ? tree : JSON.stringify(tree);
  }
  return null;
}

function treeHasEnoughInfo(tree: string): boolean {
  // Heurística: si el árbol tiene al menos 5 nodos con texto, basta.
  const textNodes = (tree.match(/"text":\s*"[^"]+"/g) || []).length;
  return textNodes >= 5;
}

function extractTextFromTree(tree: string): string {
  try {
    const obj = JSON.parse(tree);
    const texts: string[] = [];
    function walk(node: any) {
      if (node?.text && typeof node.text === 'string' && node.text.trim()) {
        texts.push(node.text.trim());
      }
      if (node?.children && Array.isArray(node.children)) {
        for (const c of node.children) walk(c);
      }
    }
    walk(obj);
    return texts.slice(0, 200).join('\n');
  } catch {
    return '';
  }
}

// ============================================================================
// Paso 2: captura + OCR local (Tesseract)
// ============================================================================

async function captureAndOcr(target: string): Promise<{ text: string; imagePath: string }> {
  // Capturar pantalla con grim (Wayland) o scrot/import (X11).
  const tmpImg = `/tmp/weaver_vision_${Date.now()}.png`;
  const isWayland = !!process.env.WAYLAND_DISPLAY || await isCommandAvailable('wlr-randr');
  const captureCmd = isWayland
    ? `grim -t png "${tmpImg}" 2>/dev/null || scrot "${tmpImg}" 2>/dev/null`
    : `scrot "${tmpImg}" 2>/dev/null || import -window root "${tmpImg}" 2>/dev/null`;

  const capResult = await shellExec(captureCmd, undefined, 10_000);
  if (!capResult.ok) throw new Error('No se pudo capturar la pantalla');

  // OCR con tesseract.
  const ocrResult = await shellExec(
    `tesseract "${tmpImg}" - -l spa+eng 2>/dev/null`,
    undefined,
    30_000,
  );
  if (!ocrResult.ok) throw new Error('tesseract no disponible o falló');

  return { text: ocrResult.output, imagePath: tmpImg };
}

async function isCommandAvailable(cmd: string): Promise<boolean> {
  const r = await shellExec(`command -v ${cmd} 2>/dev/null && echo yes || echo no`, undefined, 3000);
  return r.output.includes('yes');
}

// ============================================================================
// Paso 3: captura + VLM (Vision Language Model)
// ============================================================================

async function captureAndAskVlm(
  target: string,
  prompt: string,
  providerId?: string | null,
): Promise<{ text: string; imagePath: string; provider: string; model: string }> {
  // Capturar.
  const tmpImg = `/tmp/weaver_vision_${Date.now()}.png`;
  const isWayland = !!process.env.WAYLAND_DISPLAY;
  const captureCmd = isWayland
    ? `grim -t png "${tmpImg}" 2>/dev/null || scrot "${tmpImg}" 2>/dev/null`
    : `scrot "${tmpImg}" 2>/dev/null || import -window root "${tmpImg}" 2>/dev/null`;
  await shellExec(captureCmd, undefined, 10_000);

  // Codificar a base64.
  const b64Result = await shellExec(`base64 -w 0 "${tmpImg}"`, undefined, 10_000);
  const b64 = b64Result.output.trim();

  // Llamar al VLM. Por ahora, soporte nativo para Gemini y OpenAI (gpt-4o).
  const provider = providerId ?? 'google';
  if (provider === 'google') {
    const text = await askGeminiVlm(b64, prompt);
    return { text, imagePath: tmpImg, provider: 'google', model: 'gemini-1.5-pro' };
  }
  if (provider === 'openai' || provider === 'openrouter') {
    const text = await askOpenAIVlm(b64, prompt, provider);
    return { text, imagePath: tmpImg, provider, model: 'gpt-4o' };
  }
  if (provider === 'anthropic') {
    const text = await askAnthropicVlm(b64, prompt);
    return { text, imagePath: tmpImg, provider: 'anthropic', model: 'claude-3-5-sonnet' };
  }
  throw new Error(`VLM no soportado para proveedor: ${provider}`);
}

async function askGeminiVlm(b64: string, prompt: string): Promise<string> {
  // Cargar dinámicamente para evitar circular deps.
  const { createProvider } = await import('@/providers');
  const { apiKeyStore } = await import('@/providers/store');
  const apiKey = await apiKeyStore.get('google');
  if (!apiKey) throw new Error('Falta API key de Google para VLM');

  // Llamada directa a la API de Gemini con inline_data.
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/png', data: b64 } },
          ],
        }],
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini VLM ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '[respuesta vacía]';
}

async function askOpenAIVlm(b64: string, prompt: string, provider: string): Promise<string> {
  const { apiKeyStore } = await import('@/providers/store');
  const apiKey = await apiKeyStore.get(provider as any);
  if (!apiKey) throw new Error(`Falta API key de ${provider} para VLM`);

  const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
  const model = provider === 'openrouter' ? 'openai/gpt-4o' : 'gpt-4o';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
      max_tokens: 1000,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI VLM ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? '[respuesta vacía]';
}

async function askAnthropicVlm(b64: string, prompt: string): Promise<string> {
  const { apiKeyStore } = await import('@/providers/store');
  const apiKey = await apiKeyStore.get('anthropic');
  if (!apiKey) throw new Error('Falta API key de Anthropic para VLM');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic VLM ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json?.content?.[0]?.text ?? '[respuesta vacía]';
}

// ============================================================================
// Preferencias de visión (persistidas en localStorage)
// ============================================================================

const PREFS_KEY = 'weaver:vision_prefs';

export interface VisionPrefs {
  /** 'granted' = el usuario ya consintió VLM globalmente. 'ask' = pedir caso a caso. 'denied' = nunca. */
  vlmConsent: Consent;
  /** Proveedor preferido para VLM. */
  preferredProvider: string | null;
  /** Si true, OCR local está habilitado (requiere tesseract). */
  ocrEnabled: boolean;
  /** Idiomas para Tesseract. */
  ocrLangs: string;
}

const DEFAULT_PREFS: VisionPrefs = {
  vlmConsent: 'ask',
  preferredProvider: 'google',
  ocrEnabled: true,
  ocrLangs: 'spa+eng',
};

export function getVisionPrefs(): VisionPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setVisionPrefs(prefs: Partial<VisionPrefs>): void {
  const cur = getVisionPrefs();
  const next = { ...cur, ...prefs };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
}
