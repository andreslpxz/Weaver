/**
 * FASE 4 — Webhook node definition.
 *
 * Trigger node: arranca el workflow cuando llega un request HTTP.
 * El runtime real del webhook server vive en Rust (FASE 9). Aquí sólo
 * definimos la metadata y el execute (que es esencialmente un passthrough
 * de los items iniciales).
 */

import type { NodeDefinition } from '../../types/node_definition';

export const webhookDefinition: NodeDefinition = {
  type: 'webhook',
  version: 1,
  displayName: 'Webhook',
  description: 'Dispara el workflow cuando llega un request HTTP a /webhook/{workflowId}/{path}.',
  icon: 'webhook',
  category: 'trigger',
  isTrigger: true,
  processesItems: 'all',
  inputs: [],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'path',
      displayName: 'Path',
      type: 'string',
      description: 'Subpath del webhook (se concatena a /webhook/{workflowId}/).',
      default: '/webhook',
      placeholder: '/order',
    },
    {
      name: 'method',
      displayName: 'HTTP Method',
      type: 'options',
      options: [
        { value: 'GET', label: 'GET' },
        { value: 'POST', label: 'POST' },
        { value: 'PUT', label: 'PUT' },
        { value: 'DELETE', label: 'DELETE' },
      ],
      default: 'POST',
    },
    {
      name: 'responseMode',
      displayName: 'Response Mode',
      type: 'options',
      options: [
        { value: 'sync', label: 'Sync (espera ejecución)' },
        { value: 'async', label: 'Async (devuelve 202)' },
      ],
      default: 'async',
    },
    {
      name: 'authCredentialId',
      displayName: 'Auth Credential (optional)',
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
      credentialIdField: 'authCredentialId',
    },
  ],
  execute: async (ctx) => {
    // El webhook runtime (Rust) inyecta los items iniciales en la Execution.
    // Aquí sólo los pasamos a la salida.
    return {
      status: 'success',
      outputs: { default: ctx.inputItems },
    };
  },
  validate: (config) => {
    const errors = [];
    const path = config.path as string | undefined;
    if (path && !path.startsWith('/')) {
      errors.push({
        code: 'INVALID_NODE_CONFIG',
        message: 'Webhook path debe empezar con /',
        severity: 'error' as const,
        path: 'config.path',
      });
    }
    return errors;
  },
};
