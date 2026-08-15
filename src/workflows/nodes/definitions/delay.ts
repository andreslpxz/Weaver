/**
 * FASE 4 — Delay node definition.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const delayDefinition: NodeDefinition = {
  type: 'delay',
  version: 1,
  displayName: 'Delay',
  description: 'Espera N milisegundos antes de continuar.',
  icon: 'timer',
  category: 'flow',
  processesItems: 'all',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'ms',
      displayName: 'Milliseconds',
      type: 'number',
      default: 1000,
      description: 'Tiempo de espera en milisegundos (máx 5 min).',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as { ms?: number };
    const ms = Math.min(Math.max(config.ms ?? 1000, 0), 5 * 60_000);

    // Sleep respetando abort signal.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Delay cancelled'));
      }, { once: true });
    });

    const outputItems: ExecutionItem[] = ctx.inputItems.map((item, idx) => ({
      ...item,
      pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
      metadata: { ...item.metadata, delayedMs: ms },
    }));

    return { status: 'success', outputs: { default: outputItems } };
  },
};
