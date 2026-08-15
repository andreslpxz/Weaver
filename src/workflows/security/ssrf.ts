/**
 * FASE 23 (anticipada) — SSRF protection para HTTP Request node.
 *
 * Bloquea por defecto IPs privadas/loopback/link-local/metadata.
 * Permite override por configuración del workflow (allowlist).
 */

const PRIVATE_PATTERNS = [
  /^127\./,                            // loopback v4
  /^10\./,                             // private 10/8
  /^172\.(1[6-9]|2\d|3[01])\./,        // private 172.16/12
  /^192\.168\./,                       // private 192.168/16
  /^169\.254\./,                       // link-local
  /^0\./,                              // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64/10
  /^::1$/,                             // loopback v6
  /^fc00:/i,                           // ULA v6
  /^fe80:/i,                           // link-local v6
  /^::ffff:127\./,                     // v4-mapped loopback
  /^::ffff:10\./,
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./,
  /^::ffff:192\.168\./,
];

const HOSTNAME_BLOCKLIST = new Set([
  'localhost',
  'ip-ranges.amazonaws.com',
  'metadata.google.internal',
  '169.254.169.254',
  'metadata.aws.internal',
]);

export interface SsrfOptions {
  /** Si true, permite IPs privadas (para dev/testing). */
  allowPrivate?: boolean;
  /** Hostnames explícitamente permitidos. */
  allowList?: string[];
}

/** Verifica si una URL está bloqueada por SSRF protection. */
export function isSsrfBlocked(url: string, opts: SsrfOptions = {}): boolean {
  if (opts.allowPrivate) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true; // URL inválida → bloquea
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (opts.allowList?.includes(hostname)) return false;
  if (HOSTNAME_BLOCKLIST.has(hostname)) return true;

  // Si es IP literal, validar contra patrones privadas.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
    for (const pattern of PRIVATE_PATTERNS) {
      if (pattern.test(hostname)) return true;
    }
  }

  // Bloquear si el hostname empieza con un nombre sospechoso.
  if (hostname === '0.0.0.0') return true;

  return false;
}

/** Normaliza una URL para logging (sin credenciales). */
export function sanitizeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return '<invalid url>';
  }
}
