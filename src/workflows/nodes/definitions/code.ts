/**
 * FASE 4 — Code node definition.
 *
 * Ejecuta Python/Node/Bash usando el sandbox existente (sandbox_run).
 * El código recibe el contexto como JSON por stdin y debe imprimir JSON
 * por stdout (se fusiona con el item actual).
 */

import type { NodeDefinition } from '../../types/node_definition';
import { dispatchAdvancedTool } from '@/lib/tools';
import type { ExecutionItem, StructuredError } from '../../types/execution';

export const codeDefinition: NodeDefinition = {
  type: 'code',
  version: 1,
  displayName: 'Code',
  description: 'Ejecuta código Python, Node.js o Bash en un sandbox aislado. Recibe el item por stdin (JSON) y debe imprimir JSON por stdout.',
  icon: 'code',
  category: 'data',
  processesItems: 'all',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'language',
      displayName: 'Language',
      type: 'options',
      options: [
        { value: 'javascript', label: 'JavaScript (Node)' },
        { value: 'python', label: 'Python' },
        { value: 'bash', label: 'Bash' },
      ],
      default: 'javascript',
      required: true,
    },
    {
      name: 'code',
      displayName: 'Code',
      type: 'code',
      description: 'Código a ejecutar. Recibe JSON por stdin, debe imprimir JSON por stdout.',
      default: '',
      required: true,
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as {
      language?: 'javascript' | 'python' | 'bash';
      code?: string;
    };
    const language = config.language ?? 'javascript';
    const code = config.code ?? '';

    if (!code.trim()) {
      return {
        status: 'error',
        error: {
          code: 'INVALID_NODE_CONFIG',
          message: 'Code node no tiene código.',
          nodeId: ctx.node.id,
          retryable: false,
        },
      };
    }

    // Combinar todos los inputItems en un array para el stdin.
    const stdin = JSON.stringify(ctx.inputItems.map((i) => i.json));

    try {
      const result = await dispatchAdvancedTool('sandbox_run', {
        language: language === 'javascript' ? 'node' : language,
        code,
        stdin,
      });

      if (!result.ok) {
        return {
          status: 'error',
          error: {
            code: 'CODE_EXECUTION_ERROR',
            message: result.error ?? 'Error ejecutando código.',
            nodeId: ctx.node.id,
            retryable: false,
          },
        };
      }

      // Intentar parsear stdout como JSON.
      let outputItems: ExecutionItem[];
      try {
        const parsed = JSON.parse(result.output);
        if (Array.isArray(parsed)) {
          outputItems = parsed.map((json, idx) => ({
            json,
            pairedItem: [{ nodeId: ctx.node.id, itemIndex: idx }],
          }));
        } else if (parsed && typeof parsed === 'object') {
          outputItems = [{
            json: parsed,
            pairedItem: [{ nodeId: ctx.node.id, itemIndex: 0 }],
          }];
        } else {
          outputItems = [{
            json: { result: parsed, stdout: result.output },
            pairedItem: [{ nodeId: ctx.node.id, itemIndex: 0 }],
          }];
        }
      } catch {
        // No era JSON: usar el stdout como texto.
        outputItems = ctx.inputItems.map((item, idx) => ({
          json: { ...((item.json as Record<string, unknown>) ?? {}), _codeOutput: result.output },
          pairedItem: [{ nodeId: ctx.node.id, itemIndex: idx }],
        }));
      }

      return {
        status: 'success',
        outputs: { default: outputItems },
      };
    } catch (e) {
      const error: StructuredError = {
        code: 'CODE_EXECUTION_ERROR',
        message: e instanceof Error ? e.message : String(e),
        nodeId: ctx.node.id,
        retryable: false,
      };
      return { status: 'error', error };
    }
  },
};
