/**
 * FASE 4 — Manual trigger node definition.
 */

import type { NodeDefinition } from '../../types/node_definition';

export const manualDefinition: NodeDefinition = {
  type: 'manual',
  version: 1,
  displayName: 'Manual Trigger',
  description: 'Dispara el workflow manualmente desde la UI (botón Ejecutar).',
  icon: 'hand',
  category: 'trigger',
  isTrigger: true,
  processesItems: 'all',
  inputs: [],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [],
  execute: async (ctx) => ({
    status: 'success',
    outputs: {
      default: ctx.inputItems.length > 0 ? ctx.inputItems : [
        { json: { triggeredAt: new Date().toISOString(), source: 'manual' }, source: 'manual' },
      ],
    },
  }),
};
