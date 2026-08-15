/**
 * FASE 12 — Aggregate node definition.
 *
 * Combina todos los items en un único item con un array.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const aggregateDefinition: NodeDefinition = {
  type: 'aggregate',
  version: 1,
  displayName: 'Aggregate',
  description: 'Combina todos los items en un único item con un array.',
  icon: 'layers',
  category: 'flow',
  processesItems: 'all',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'field',
      displayName: 'Output Field',
      type: 'string',
      default: 'items',
      description: 'Nombre del campo donde poner el array.',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as { field?: string };
    const field = config.field ?? 'items';

    const aggregated: ExecutionItem = {
      json: { [field]: ctx.inputItems.map((i) => i.json) },
      pairedItem: ctx.inputItems.map((_, idx) => ({ nodeId: ctx.node.id, itemIndex: idx })),
      metadata: { count: ctx.inputItems.length },
    };

    return { status: 'success', outputs: { default: [aggregated] } };
  },
};
