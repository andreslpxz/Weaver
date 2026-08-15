/**
 * FASE 12 — Merge node definition.
 *
 * Combina items de múltiples entradas en un único stream de salida.
 *
 * Modos:
 *   - 'append'   (default): concatena todos los inputs en orden.
 *   - 'combine':  empareja items por índice (zip).
 *   - 'wait_all': espera a que todas las entradas tengan al menos un item
 *                 antes de emitir, luego append.
 *
 * El engine v2 debe asegurarse de que todas las entradas hayan llegado
 * antes de invocar execute (los inputs se acumulan por sourceHandle).
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const mergeDefinition: NodeDefinition = {
  type: 'merge',
  version: 1,
  displayName: 'Merge',
  description: 'Combina items de múltiples ramas en un único stream.',
  icon: 'merge',
  category: 'flow',
  processesItems: 'all',
  inputs: [
    { handle: 'input_0', displayName: 'Input 0', multiple: true },
    { handle: 'input_1', displayName: 'Input 1', multiple: true },
    { handle: 'input_2', displayName: 'Input 2 (optional)', multiple: true },
    { handle: 'input_3', displayName: 'Input 3 (optional)', multiple: true },
  ],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'mode',
      displayName: 'Mode',
      type: 'options',
      options: [
        { value: 'append', label: 'Append (concatena)' },
        { value: 'combine', label: 'Combine (zip por índice)' },
        { value: 'wait_all', label: 'Wait all (espera todas)' },
      ],
      default: 'append',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as { mode?: 'append' | 'combine' | 'wait_all' };
    const mode = config.mode ?? 'append';

    if (mode === 'append' || mode === 'wait_all') {
      const outputItems: ExecutionItem[] = ctx.inputItems.map((item, idx) => ({
        ...item,
        pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
      }));
      return { status: 'success', outputs: { default: outputItems } };
    }

    // mode === 'combine': zip por índice.
    // Los items vienen agrupados por pairedItem.sourceHandle (no disponible
    // directamente en el ExecutionItem, pero el engine agrupa los inputs
    // en orden). Aquí simplemente emparejamos por índice del array.
    const max = Math.max(...ctx.inputItems.map((i) => Array.isArray(i.json) ? i.json.length : 1));
    const outputItems: ExecutionItem[] = [];
    for (let idx = 0; idx < max; idx++) {
      const combined: Record<string, unknown> = {};
      for (let j = 0; j < ctx.inputItems.length; j++) {
        const item = ctx.inputItems[j];
        const arr = Array.isArray(item.json) ? item.json : [item.json];
        combined[`input_${j}`] = arr[idx];
      }
      outputItems.push({
        json: combined,
        pairedItem: ctx.inputItems.map((_, j) => ({ nodeId: ctx.node.id, itemIndex: j })),
      });
    }
    return { status: 'success', outputs: { default: outputItems } };
  },
};
