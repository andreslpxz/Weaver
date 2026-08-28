/**
 * Utilidades de importar / exportar / compartir para Notebooks y Workflows.
 *
 * Formato de archivo: JSON con envoltorio versionado:
 *   { type: 'weaver.workflow' | 'weaver.notebook', version: 1, data: {...} }
 *   { type: 'weaver.workflow.collection' | 'weaver.notebook.collection', version: 1, items: [...] }
 *
 * El importador acepta el envoltorio O el objeto crudo (más permisivo).
 */

export type TransferType = 'workflow' | 'notebook';

const MIME = 'application/json';

/** Descarga un objeto JSON como archivo. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: MIME });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'export';
}

/**
 * Comparte un JSON: usa la Web Share API (con archivo) si está disponible
 * — p. ej. Chrome Android — y si no, copia al portapapeles.
 * Devuelve 'shared' | 'copied' | 'downloaded'.
 */
export async function shareJson(baseName: string, data: unknown): Promise<'shared' | 'copied' | 'downloaded'> {
  const json = JSON.stringify(data, null, 2);
  const filename = `${safeName(baseName)}.json`;

  // 1) Web Share con archivo (móvil).
  try {
    if (typeof navigator !== 'undefined' && 'canShare' in navigator) {
      const file = new File([json], filename, { type: MIME });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: baseName });
        return 'shared';
      }
    }
  } catch (e) {
    // El usuario canceló el share → no hacer fallback ruidoso.
    if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
  }

  // 2) Portapapeles.
  try {
    await navigator.clipboard.writeText(json);
    return 'copied';
  } catch {
    // 3) Último recurso: descarga.
    downloadJson(filename, data);
    return 'downloaded';
  }
}

export function buildTransfer(type: TransferType, items: Array<Record<string, unknown>>): Record<string, unknown> {
  if (items.length === 1) {
    return { type: `weaver.${type}`, version: 1, exportedAt: Date.now(), data: items[0] };
  }
  return { type: `weaver.${type}.collection`, version: 1, exportedAt: Date.now(), items };
}

/** Extrae los items de un JSON de transferencia (acepta envoltorio o crudo). */
export function parseTransfer(type: TransferType, raw: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(raw) as unknown;
  const singleType = `weaver.${type}`;
  const collType = `weaver.${type}.collection`;

  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (obj.type === collType && Array.isArray(obj.items)) return obj.items as Array<Record<string, unknown>>;
    if (obj.type === singleType && obj.data && typeof obj.data === 'object') return [obj.data as Record<string, unknown>];
    // Objeto crudo: asumir que es el recurso directamente si tiene forma válida.
    if (type === 'workflow' && Array.isArray(obj.nodes)) return [obj];
    if (type === 'notebook' && Array.isArray(obj.sources)) return [obj];
  }
  throw new Error(`El archivo no parece un ${type} de Weaver válido.`);
}

/** Abre el file picker y lee todos los archivos JSON seleccionados. */
export function pickJsonFiles(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return resolve([]);
      try {
        const contents = await Promise.all(files.map((f) => f.text()));
        resolve(contents);
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}
