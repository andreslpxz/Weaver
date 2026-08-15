/**
 * FASE 12 — Sort node definition.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const sortDefinition: NodeDefinition = {
  type: 'sort',
  version: 1,
  displayName: 'Sort',
  description: 'Ordena los items por una clave (expression).',
  icon: 'arrow-down-up',
  category: 'data',
  processesItems: 'all',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'keyExpression',
      displayName: 'Key Expression',
      type: 'expression',
      description: 'Expression que devuelve el valor clave para ordenar.',
      default: '',
      placeholder: '{{$json.createdAt}}',
    },
    {
      name: 'order',
      displayName: 'Order',
      type: 'options',
      options: [
        { value: 'asc', label: 'Ascending' },
        { value: 'desc', label: 'Descending' },
      ],
      default: 'asc',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as { keyExpression?: string; order?: 'asc' | 'desc' };
    const expr = config.keyExpression ?? '';
    const order = config.order ?? 'asc';

    const itemsWithKeys = ctx.inputItems.map((item, idx) => {
      let key: unknown;
      try {
        key = expr ? ctx.resolveExpression(expr, item) : item.json;
      } catch {
        key = undefined;
      }
      return { item, idx, key };
    });

    itemsWithKeys.sort((a, b) => {
      const ka = a.key;
      const kb = b.key;
      if (ka === kb) return 0;
      if (ka === undefined || ka === null) return 1;
      if (kb === undefined || kb === null) return -1;
      if (typeof ka === 'number' && typeof kb === 'number') return order === 'asc' ? ka - kb : kb - ka;
      const sa = String(ka);
      const sb = String(kb);
      return order === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });

    const outputItems: ExecutionItem[] = itemsWithKeys.map(({ item, idx }) => ({
      ...item,
      pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
    }));

    return { status: 'success', outputs: { default: outputItems } };
  },
};
