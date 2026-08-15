/**
 * FASE 4 — HTTP Request node definition.
 *
 * v1: fetch real con soporte de:
 *   - expressions en url, body, headers
 *   - method configurable
 *   - timeout por nodo
 *   - parseJson (si true, intenta parsear response como JSON)
 *   - credentialId (httpHeaderAuth / httpBasicAuth / httpQueryAuth)
 *
 * SSRF protection en FASE 23 (security hardening). Aquí dejamos el hook.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem, StructuredError } from '../../types/execution';
import { isSsrfBlocked } from '../../security/ssrf';

export const httpRequestDefinition: NodeDefinition = {
  type: 'http_request',
  version: 1,
  displayName: 'HTTP Request',
  description: 'Hace una petición HTTP. Soporta expressions en URL, body y headers.',
  icon: 'globe',
  category: 'network',
  processesItems: 'one',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [
    { handle: 'default', displayName: 'Output' },
    { handle: 'error', displayName: 'Error' },
  ],
  parameters: [
    {
      name: 'url',
      displayName: 'URL',
      type: 'expression',
      description: 'URL destino. Soporta expressions.',
      default: '',
      placeholder: 'https://api.example.com/orders/{{$json.orderId}}',
      required: true,
    },
    {
      name: 'method',
      displayName: 'Method',
      type: 'options',
      options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
        { value: 'PATCH', label: 'PATCH' },
        { value: 'DELETE', label: 'DELETE' },
      ],
      default: 'GET',
    },
    {
      name: 'headers',
      displayName: 'Headers (JSON)',
      type: 'object',
      description: 'Headers HTTP como objeto JSON. Valores soportan expressions.',
      default: {},
    },
    {
      name: 'body',
      displayName: 'Body',
      type: 'expression',
      description: 'Cuerpo del request (para POST/PUT/PATCH).',
      default: '',
    },
    {
      name: 'parseJson',
      displayName: 'Parse Response as JSON',
      type: 'boolean',
      default: true,
    },
    {
      name: 'timeoutMs',
      displayName: 'Timeout (ms)',
      type: 'number',
      default: 30_000,
    },
    {
      name: 'credentialId',
      displayName: 'Credential',
      type: 'credential',
      credentialType: 'httpHeaderAuth',
      required: false,
    },
  ],
  credentials: [
    {
      name: 'auth',
      credentialType: 'httpHeaderAuth',
      required: false,
      credentialIdField: 'credentialId',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      parseJson?: boolean;
      timeoutMs?: number;
    };

    const successItems: ExecutionItem[] = [];
    const errorItems: ExecutionItem[] = [];

    for (let idx = 0; idx < ctx.inputItems.length; idx++) {
      const item = ctx.inputItems[idx];
      const url = String(ctx.resolveExpression(config.url ?? '', item) ?? '');

      if (!url) {
        errorItems.push({
          ...item,
          json: { error: 'HTTP Request: URL vacía', nodeId: ctx.node.id },
          pairedItem: [{ nodeId: ctx.node.id, itemIndex: idx }],
        });
        continue;
      }

      // SSRF protection
      if (isSsrfBlocked(url)) {
        errorItems.push({
          ...item,
          json: { error: `SSRF blocked: ${url} resolves to a private/loopback address`, nodeId: ctx.node.id, code: 'SSRF_BLOCKED' },
          pairedItem: [{ nodeId: ctx.node.id, itemIndex: idx }],
        });
        continue;
      }

      const method = config.method ?? 'GET';
      const timeoutMs = Math.min(config.timeoutMs ?? 30_000, 5 * 60_000);

      // Headers: interpolar values.
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(config.headers ?? {})) {
        headers[k] = String(ctx.resolveExpression(v, item));
      }
      // Aplicar credential si está resuelta.
      const cred = ctx.credentials?.auth;
      if (cred && typeof cred === 'object') {
        if ('name' in cred && 'value' in cred) {
          headers[String(cred.name)] = String(cred.value);
        }
      }

      // Body: interpolar si no es GET.
      let body: string | undefined;
      if (method !== 'GET' && config.body) {
        body = String(ctx.resolveExpression(config.body, item));
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        ctx.signal.addEventListener('abort', () => controller.abort(), { once: true });

        const res = await fetch(url, {
          method,
          headers,
          body: body ?? undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await res.text();
        let parsed: unknown = text;
        if (config.parseJson !== false) {
          try { parsed = JSON.parse(text); } catch { /* no JSON */ }
        }

        const outItem: ExecutionItem = {
          ...item,
          json: {
            statusCode: res.status,
            ok: res.ok,
            headers: Object.fromEntries(res.headers.entries()),
            body: parsed,
          },
          pairedItem: [{ nodeId: ctx.node.id, itemIndex: idx }],
        };

        if (res.ok) {
          successItems.push(outItem);
        } else {
          errorItems.push({
            ...outItem,
            json: { ...((outItem.json as Record<string, unknown>) ?? {}), error: `HTTP ${res.status}` },
          });
        }
      } catch (e) {
        const err: StructuredError = {
          code: 'HTTP_REQUEST_ERROR',
          message: e instanceof Error ? e.message : String(e),
          nodeId: ctx.node.id,
          retryable: e instanceof Error && (e.name === 'AbortError' || e.message.includes('network')),
        };
        errorItems.push({
          ...item,
          json: { error: err.message, code: err.code, nodeId: ctx.node.id },
          pairedItem: [{ nodeId: ctx.node.id, itemIndex: idx }],
        });
      }
    }

    // Si hay items en error, los mandamos por la salida 'error' pero no marcamos el nodo como error.
    // El workflow puede continuar con un branch de error.
    if (errorItems.length > 0 && successItems.length === 0) {
      // Todos fallaron → marcamos como error del nodo (para que retry mechanism funcione).
      return {
        status: 'error',
        error: {
          code: 'HTTP_ALL_FAILED',
          message: `Todos los ${errorItems.length} requests fallaron`,
          nodeId: ctx.node.id,
          retryable: true,
        },
        outputs: { error: errorItems },
      };
    }

    return {
      status: 'success',
      outputs: {
        default: successItems,
        error: errorItems.length > 0 ? errorItems : undefined,
      },
    };
  },
};
