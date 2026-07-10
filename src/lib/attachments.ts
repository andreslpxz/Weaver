/**
 * Utilidades para manejar archivos adjuntos en el composer.
 *
 * Soporta:
 *   - Archivos de texto (.txt, .md, .json, .js, .ts, .tsx, .py, .rs, .go, .java,
 *     .c, .cpp, .h, .html, .css, .yml, .yaml, .toml, .ini, .sh, .sql, .csv)
 *     → leídos como texto y embebidos en el mensaje al LLM.
 *   - Imágenes (.png, .jpg, .jpeg, .gif, .webp, .bmp)
 *     → leídas como data URL base64 (preparadas para multimodal futuro).
 *     Por ahora se incluyen como nota "[Imagen: name (WxH, size)]".
 *   - Otros → sólo metadata (nombre, tamaño, tipo MIME).
 *
 * Límites:
 *   - Texto: hasta 200 KB embebidos (resto se trunca con aviso).
 *   - Imágenes: hasta 5 MB.
 *   - Otros: hasta 50 MB (sólo metadata, no se envía contenido).
 */

export interface Attachment {
  id: string;
  name: string;
  size: number;
  mime: string;
  kind: 'text' | 'image' | 'binary';
  /** Para kind='text': contenido string. Para kind='image': data URL. */
  content?: string;
  /** ¿Se truncó el contenido por límite de tamaño? */
  truncated?: boolean;
  /** Thumbnail para imágenes (data URL pequeña). */
  thumbnail?: string;
  addedAt: number;
}

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'json5', 'js', 'jsx', 'ts', 'tsx',
  'py', 'rs', 'go', 'java', 'c', 'cpp', 'cc', 'h', 'hpp', 'html', 'htm',
  'css', 'scss', 'sass', 'less', 'yml', 'yaml', 'toml', 'ini', 'cfg',
  'sh', 'bash', 'zsh', 'fish', 'sql', 'csv', 'tsv', 'xml', 'svg',
  'log', 'env', 'gitignore', 'dockerfile', 'makefile',
]);

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

const MAX_TEXT_BYTES = 200 * 1024; // 200 KB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_BINARY_BYTES = 50 * 1024 * 1024; // 50 MB

const MAX_TEXT_CHARS = 50_000; // truncar contenido a 50k caracteres para el LLM

export function detectKind(file: File): Attachment['kind'] {
  const ext = getExt(file.name);
  if (IMAGE_EXTS.has(ext) || file.type.startsWith('image/')) return 'image';
  if (TEXT_EXTS.has(ext) || file.type.startsWith('text/')) return 'text';
  // application/json y similares
  if (file.type === 'application/json' || file.type === 'application/xml') return 'text';
  return 'binary';
}

function getExt(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Lee un File del browser y devuelve un Attachment.
 * Lanza error si el archivo excede el tamaño máximo para su tipo.
 */
export async function fileToAttachment(file: File): Promise<Attachment> {
  const kind = detectKind(file);
  const limit = kind === 'text' ? MAX_TEXT_BYTES : kind === 'image' ? MAX_IMAGE_BYTES : MAX_BINARY_BYTES;
  if (file.size > limit) {
    throw new Error(
      `Archivo "${file.name}" (${formatSize(file.size)}) excede el límite de ${formatSize(limit)} para archivos ${kind}.`,
    );
  }

  const att: Attachment = {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    kind,
    addedAt: Date.now(),
  };

  if (kind === 'text') {
    const text = await file.text();
    if (text.length > MAX_TEXT_CHARS) {
      att.content = text.slice(0, MAX_TEXT_CHARS);
      att.truncated = true;
    } else {
      att.content = text;
    }
  } else if (kind === 'image') {
    // Leer como data URL para thumbnail y para futuro soporte multimodal.
    att.content = await readAsDataURL(file);
    att.thumbnail = await makeThumbnail(file, 64);
  }

  return att;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function makeThumbnail(file: File, maxDim: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(undefined);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(undefined);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
    img.src = url;
  });
}

/**
 * Construye el texto del mensaje de usuario con attachments embebidos.
 * Los archivos de texto se incluyen entre fences con el lenguaje detectado.
 * Las imágenes se mencionan con metadata.
 * Los binarios se mencionan con nombre + tamaño.
 */
export function buildMessageWithAttachments(prompt: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return prompt;

  const parts: string[] = [];
  if (prompt.trim()) parts.push(prompt);

  const textAtts = attachments.filter((a) => a.kind === 'text');
  const imageAtts = attachments.filter((a) => a.kind === 'image');
  const binaryAtts = attachments.filter((a) => a.kind === 'binary');

  if (textAtts.length > 0 || imageAtts.length > 0 || binaryAtts.length > 0) {
    parts.push('');
    parts.push('--- Archivos adjuntos ---');
  }

  for (const a of textAtts) {
    const ext = getExt(a.name);
    const lang = ext === 'md' ? 'markdown' : ext === 'py' ? 'python' : ext;
    parts.push('');
    parts.push(`### ${a.name} (${formatSize(a.size)}${a.truncated ? ', TRUNCADO' : ''})`);
    parts.push('');
    parts.push('```' + lang);
    parts.push(a.content ?? '');
    parts.push('```');
  }

  for (const a of imageAtts) {
    parts.push(`- Imagen: ${a.name} (${formatSize(a.size)})`);
  }

  for (const a of binaryAtts) {
    parts.push(`- Archivo: ${a.name} (${formatSize(a.size)}, ${a.mime})`);
  }

  return parts.join('\n');
}

/**
 * Valida que un drop event contenga archivos y devuelve la lista de Files.
 */
export function getFilesFromDrop(e: React.DragEvent): File[] {
  const dt = e.dataTransfer;
  if (!dt) return [];
  const files: File[] = [];
  if (dt.files && dt.files.length > 0) {
    for (let i = 0; i < dt.files.length; i++) {
      const f = dt.files.item(i);
      if (f) files.push(f);
    }
  }
  if (dt.items && dt.items.length > 0) {
    for (let i = 0; i < dt.items.length; i++) {
      const it = dt.items[i];
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f && !files.find((x) => x.name === f.name && x.size === f.size)) {
          files.push(f);
        }
      }
    }
  }
  return files;
}
