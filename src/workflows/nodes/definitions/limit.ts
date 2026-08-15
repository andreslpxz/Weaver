/**
 * FASE 12 — Limit node definition.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const limitDefinition: NodeDefinition = {
  type: 'limit',
  version: 1,
  displayName: 'Limit',
  description: 'Toma los primeros (o últimos) N items.',
  icon: 'crop',
  category: 'data',
  processesItems: 'all',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'limit',
      displayName: 'Limit',
      type: 'number',
      default: 10,
      description: 'Número máximo de items a mantener.',
    },
    {
      name: 'fromEnd',
      displayName: 'From End',
      type: 'boolean',
      default: false,
      description: 'Si true, mantiene los últimos N items en vez de los primeros.',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as { limit?: number; fromEnd?: boolean };
    const limit = Math.max(0, config.limit ?? 10);
    const fromEnd = config.fromEnd ?? false;

    const sliced = fromEnd
      ? ctx.inputItems.slice(-limit)
      : ctx.inputItems.slice(0, limit);

    const outputItems: ExecutionItem[] = sliced.map((item, idx) => ({
      ...item,
      pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
    }));

    return { status: 'success', outputs: { default: outputItems } };
  },
};
