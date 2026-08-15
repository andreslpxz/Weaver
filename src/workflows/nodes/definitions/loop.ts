/**
 * FASE 12 — Loop node definition.
 *
 * Itera sobre una colección (input items o expression result) y ejecuta
 * el subgrafo conectado para cada item. El "subgrafo" es todo lo que
 * está downstream del loop hasta el primer nodo que no sea del loop.
 *
 * Implementación v1: simplemente emite un item por cada elemento del
 * array. El engine se encarga de que cada item pase por la rama downstream
 * y se vuelvan a recolectar antes de continuar.
 *
 * Nota: la semántica de "subgrafo" en Weaver v1 es simplemente "los items
 * que salen por default se procesan uno a uno por los nodos siguientes".
 * No hay un bloque de loop explícito con boundary; en su lugar, el loop
 * expande N items y el flujo continúa normal. Esto es lo mismo que hace
 * n8n con su nodo "Loop Over Items" (SplitInBatches).
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const loopDefinition: NodeDefinition = {
  type: 'loop',
  version: 1,
  displayName: 'Loop',
  description: 'Itera sobre una colección. Por cada item, emite un item a la salida "loop" para que los nodos siguientes lo procesen.',
  icon: 'repeat',
  category: 'flow',
  processesItems: 'all',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [
    { handle: 'loop', displayName: 'Per item' },
    { handle: 'done', displayName: 'Done (después de iterar)' },
  ],
  parameters: [
    {
      name: 'itemsExpression',
      displayName: 'Items Expression (optional)',
      type: 'expression',
      description: 'Si se especifica, evalúa esta expression para obtener el array a iterar. Si no, itera sobre inputItems.',
      default: '',
      placeholder: '{{$json.users}}',
    },
    {
      name: 'maxIterations',
      displayName: 'Max Iterations',
      type: 'number',
      default: 1000,
      description: 'Límite de seguridad contra loops infinitos.',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as {
      itemsExpression?: string;
      maxIterations?: number;
    };
    const maxIter = Math.max(1, Math.min(config.maxIterations ?? 1000, 100_000));

    let itemsToIterate: ExecutionItem[];

    if (config.itemsExpression && config.itemsExpression.trim()) {
      // Evaluar expression en el primer item (o item vacío si no hay).
      const baseItem = ctx.inputItems[0] ?? { json: {} };
      const value = ctx.resolveExpression(config.itemsExpression, baseItem);
      if (!Array.isArray(value)) {
        return {
          status: 'error',
          error: {
            code: 'LOOP_NOT_ARRAY',
            message: 'Loop expression no devolvió un array.',
            nodeId: ctx.node.id,
            retryable: false,
          },
        };
      }
      itemsToIterate = value.slice(0, maxIter).map((json, idx) => ({
        json,
        pairedItem: [{ nodeId: ctx.node.id, itemIndex: idx }],
      }));
    } else {
      itemsToIterate = ctx.inputItems.slice(0, maxIter).map((item, idx) => ({
        ...item,
        pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
      }));
    }

    // Emitimos los items por 'loop' y un marcador por 'done'.
    return {
      status: 'success',
      outputs: {
        loop: itemsToIterate,
        done: [{ json: { loopCount: itemsToIterate.length, completed: true } }],
      },
    };
  },
  validate: (config) => {
    const errors = [];
    const maxIter = config.maxIterations as number | undefined;
    if (maxIter !== undefined && (typeof maxIter !== 'number' || maxIter <= 0 || maxIter > 100_000)) {
      errors.push({
        code: 'INVALID_NODE_CONFIG',
        message: 'maxIterations debe ser un número entre 1 y 100000',
        severity: 'error' as const,
        path: 'config.maxIterations',
      });
    }
    return errors;
  },
};
