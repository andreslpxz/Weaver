/**
 * FASE 13 — Execute Workflow node definition.
 *
 * Llama a otro workflow como subworkflow. Si waitForResult=true,
 * espera a que termine y usa su output. Si no, dispara y olvida.
 *
 * El engine v2 implementa la recursión controlada (max depth 3,
 * max total subworkflows 50) en engine.ts.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem, StructuredError } from '../../types/execution';

export const executeWorkflowDefinition: NodeDefinition = {
  type: 'execute_workflow',
  version: 1,
  displayName: 'Execute Workflow',
  description: 'Ejecuta otro workflow como subworkflow. Recibe su output como input.',
  icon: 'network',
  category: 'flow',
  processesItems: 'all',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [
    { handle: 'default', displayName: 'Output' },
    { handle: 'error', displayName: 'Error' },
  ],
  parameters: [
    {
      name: 'workflowId',
      displayName: 'Workflow ID',
      type: 'string',
      description: 'ID del workflow destino. Alternativamente, usar workflowName.',
      default: '',
    },
    {
      name: 'workflowName',
      displayName: 'Workflow Name',
      type: 'string',
      description: 'Nombre del workflow destino (alternativa a ID).',
      default: '',
    },
    {
      name: 'inputMapping',
      displayName: 'Input Mapping (JSON)',
      type: 'object',
      description: 'Mapeo de campos del input actual al input del subworkflow. Vacío = pasar todo.',
      default: {},
    },
    {
      name: 'waitForResult',
      displayName: 'Wait For Result',
      type: 'boolean',
      default: true,
      description: 'Si true, espera a que el subworkflow termine.',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as {
      workflowId?: string;
      workflowName?: string;
      inputMapping?: Record<string, string>;
      waitForResult?: boolean;
    };

    if (!ctx.executeSubworkflow) {
      return {
        status: 'error',
        error: {
          code: 'SUBWORKFLOW_NOT_AVAILABLE',
          message: 'executeSubworkflow no disponible en este contexto.',
          nodeId: ctx.node.id,
          retryable: false,
        } satisfies StructuredError,
      };
    }

    const targetId = config.workflowId ?? config.workflowName;
    if (!targetId) {
      return {
        status: 'error',
        error: {
          code: 'INVALID_NODE_CONFIG',
          message: 'Execute Workflow requiere workflowId o workflowName.',
          nodeId: ctx.node.id,
          retryable: false,
        } satisfies StructuredError,
      };
    }

    // Mapear input.
    let inputItems = ctx.inputItems;
    if (config.inputMapping && Object.keys(config.inputMapping).length > 0) {
      inputItems = ctx.inputItems.map((item) => {
        const mapped: Record<string, unknown> = {};
        for (const [k, expr] of Object.entries(config.inputMapping!)) {
          mapped[k] = ctx.resolveExpression(expr, item);
        }
        return { json: mapped };
      });
    }

    const waitForResult = config.waitForResult ?? true;
    const successItems: ExecutionItem[] = [];
    const errorItems: ExecutionItem[] = [];

    if (waitForResult) {
      const result = await ctx.executeSubworkflow(targetId, inputItems, true);
      if (result.error) {
        errorItems.push({
          json: { error: result.error.message, code: result.error.code, subexecutionId: result.executionId },
          pairedItem: [{ nodeId: ctx.node.id, itemIndex: 0 }],
        });
      } else if (result.output) {
        for (let idx = 0; idx < result.output.length; idx++) {
          successItems.push({
            ...result.output[idx],
            pairedItem: [...(result.output[idx].pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
          });
        }
      }
    } else {
      const result = await ctx.executeSubworkflow(targetId, inputItems, false);
      successItems.push({
        json: { dispatched: true, subexecutionId: result.executionId },
        pairedItem: [{ nodeId: ctx.node.id, itemIndex: 0 }],
      });
    }

    if (successItems.length === 0 && errorItems.length > 0) {
      return {
        status: 'error',
        error: {
          code: 'SUBWORKFLOW_ERROR',
          message: 'Subworkflow falló',
          nodeId: ctx.node.id,
          retryable: false,
        } satisfies StructuredError,
        outputs: { error: errorItems },
      };
    }

    return {
      status: 'success',
      outputs: {
        default: successItems,
        error: errorItems.length > 0 ? errorItems : undefined,
      },
    };
  },
};
