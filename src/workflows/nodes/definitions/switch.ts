/**
 * FASE 12 — Switch node definition.
 *
 * IF con N salidas. Cada case tiene una expression. El primer case
 * que evalúa a true se lleva el item. Si ninguno match, va a 'default'.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const switchDefinition: NodeDefinition = {
  type: 'switch',
  version: 1,
  displayName: 'Switch',
  description: 'Dirige cada item al primer case cuya expression sea true. Si ninguno match, va a default.',
  icon: 'shuffle',
  category: 'logic',
  processesItems: 'one',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [
    { handle: 'default', displayName: 'Default (no match)' },
    // Casos dinámicos: el UI agrega outputs según config.cases.
  ],
  parameters: [
    {
      name: 'cases',
      displayName: 'Cases',
      type: 'array',
      description: 'Lista de casos. Cada caso tiene id, label y expression.',
      default: [],
      itemSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          expression: { type: 'string' },
        },
      },
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as {
      cases?: Array<{ id: string; label: string; expression: string }>;
    };
    const cases = config.cases ?? [];

    const outputs: Record<string, ExecutionItem[]> = { default: [] };
    for (const c of cases) {
      outputs[c.id] = [];
    }

    for (let idx = 0; idx < ctx.inputItems.length; idx++) {
      const item = ctx.inputItems[idx];
      let matched = false;
      for (const c of cases) {
        try {
          const v = ctx.resolveExpression(c.expression, item);
          if (Boolean(v)) {
            outputs[c.id].push({
              ...item,
              pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
            });
            matched = true;
            break;
          }
        } catch (e) {
          ctx.log.warn(`Switch case "${c.label}" expression error`, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (!matched) {
        outputs.default.push({
          ...item,
          pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
        });
      }
    }

    return { status: 'success', outputs };
  },
};
