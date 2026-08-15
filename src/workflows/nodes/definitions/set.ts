/**
 * FASE 4 — Set node definition.
 *
 * Asigna campos al item actual. Soporta expressions.
 * Si replace=true, reemplaza todo el item. Si no, mergea.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const setDefinition: NodeDefinition = {
  type: 'set',
  version: 1,
  displayName: 'Set',
  description: 'Asigna campos al item usando expressions. Por defecto mergea con el item actual; con "replace" reemplaza todo.',
  icon: 'list-plus',
  category: 'data',
  processesItems: 'one',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'fields',
      displayName: 'Fields',
      type: 'array',
      description: 'Lista de campos a asignar. Cada campo tiene key + value (expression).',
      default: [],
      itemSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
        },
      },
    },
    {
      name: 'replace',
      displayName: 'Replace Mode',
      type: 'boolean',
      description: 'Si true, reemplaza todo el item en vez de mergear.',
      default: false,
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as {
      fields?: Array<{ key: string; value: string }>;
      replace?: boolean;
    };
    const fields = config.fields ?? [];

    const outputItems: ExecutionItem[] = ctx.inputItems.map((item, idx) => {
      const base = config.replace ? {} : ((item.json as Record<string, unknown>) ?? {});
      const next: Record<string, unknown> = { ...base };
      for (const f of fields) {
        if (!f.key) continue;
        const value = ctx.resolveExpression(f.value ?? '', item);
        next[f.key] = value;
      }
      return {
        ...item,
        json: next,
        pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
      };
    });

    return { status: 'success', outputs: { default: outputItems } };
  },
};
