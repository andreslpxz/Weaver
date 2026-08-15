/**
 * FASE 12 — Filter node definition.
 *
 * Descarta los items que no cumplen la expression. Los que sí pasan
 * a la salida 'default'. Los descartados van a 'filtered' (opcional).
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const filterDefinition: NodeDefinition = {
  type: 'filter',
  version: 1,
  displayName: 'Filter',
  description: 'Filtra items según una expression. Los que evalúan a true pasan; los demás se descartan.',
  icon: 'filter',
  category: 'logic',
  processesItems: 'all',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [
    { handle: 'default', displayName: 'Pass' },
    { handle: 'filtered', displayName: 'Filtered out' },
  ],
  parameters: [
    {
      name: 'expression',
      displayName: 'Filter expression',
      type: 'expression',
      description: 'Expression que se evalúa por item. Si da true, el item pasa.',
      default: '',
      placeholder: '{{$json.age >= 18}}',
      required: true,
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as { expression?: string };
    const expr = config.expression ?? '';

    const pass: ExecutionItem[] = [];
    const filtered: ExecutionItem[] = [];

    for (let idx = 0; idx < ctx.inputItems.length; idx++) {
      const item = ctx.inputItems[idx];
      let result = false;
      try {
        const v = ctx.resolveExpression(expr, item);
        result = Boolean(v);
      } catch (e) {
        return {
          status: 'error',
          error: {
            code: 'FILTER_EXPRESSION_ERROR',
            message: e instanceof Error ? e.message : String(e),
            nodeId: ctx.node.id,
            retryable: false,
          },
        };
      }
      const outItem: ExecutionItem = {
        ...item,
        pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
      };
      if (result) pass.push(outItem);
      else filtered.push(outItem);
    }

    return {
      status: 'success',
      outputs: {
        default: pass,
        filtered,
      },
    };
  },
};
