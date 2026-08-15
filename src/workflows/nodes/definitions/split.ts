/**
 * FASE 12 — Split node definition.
 *
 * Toma un array de un campo del item y lo divide en items individuales.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const splitDefinition: NodeDefinition = {
  type: 'split',
  version: 1,
  displayName: 'Split',
  description: 'Toma un array de un campo y produce un item por elemento.',
  icon: 'split-square-horizontal',
  category: 'flow',
  processesItems: 'one',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'field',
      displayName: 'Array Field',
      type: 'string',
      default: 'items',
      description: 'Nombre del campo que contiene el array a dividir.',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as { field?: string };
    const field = config.field ?? 'items';

    const outputItems: ExecutionItem[] = [];
    for (let idx = 0; idx < ctx.inputItems.length; idx++) {
      const item = ctx.inputItems[idx];
      const arr = (item.json as Record<string, unknown>)?.[field];
      if (!Array.isArray(arr)) {
        // No es array, pasa el item original.
        outputItems.push({
          ...item,
          pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
        });
        continue;
      }
      for (let j = 0; j < arr.length; j++) {
        outputItems.push({
          json: arr[j],
          pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
          metadata: { ...item.metadata, splitIndex: j, splitFrom: field },
        });
      }
    }

    return { status: 'success', outputs: { default: outputItems } };
  },
};
