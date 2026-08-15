/**
 * FASE 4 — IF node definition.
 *
 * Soporta dos modos:
 *   - Legacy (v0): field + operator + value
 *   - v1: expression (evalúa a booleano)
 *
 * Si expression está presente, se usa. Si no, se construye una expression
 * equivalente a partir de field/operator/value (compatibilidad backwards).
 *
 * Salidas:
 *   - 'true'  (handle superior)
 *   - 'false' (handle inferior)
 *   - 'error' (opcional, activada si la expression falla)
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const ifDefinition: NodeDefinition = {
  type: 'if',
  version: 1,
  displayName: 'If / Else',
  description: 'Evalúa una condición y divide el flujo en dos ramas (true / false).',
  icon: 'git-branch',
  category: 'logic',
  processesItems: 'one',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [
    { handle: 'true', displayName: 'True' },
    { handle: 'false', displayName: 'False' },
    { handle: 'error', displayName: 'Error' },
  ],
  parameters: [
    {
      name: 'expression',
      displayName: 'Condition (expression)',
      type: 'expression',
      description: 'Expression que se evalúa a booleano. Ej: {{$json.tier == "vip"}}',
      default: '',
      placeholder: '{{$json.tier == "vip"}}',
    },
    // Legacy v0 (fallback si expression está vacío):
    {
      name: 'field',
      displayName: 'Field (legacy)',
      type: 'string',
      description: 'Campo del item a comparar. Se ignora si "expression" está presente.',
      default: '',
    },
    {
      name: 'operator',
      displayName: 'Operator (legacy)',
      type: 'options',
      options: [
        { value: 'eq', label: '==' },
        { value: 'neq', label: '!=' },
        { value: 'gt', label: '>' },
        { value: 'lt', label: '<' },
        { value: 'contains', label: 'contains' },
        { value: 'is_empty', label: 'is empty' },
        { value: 'is_not_empty', label: 'is not empty' },
      ],
      default: 'eq',
    },
    {
      name: 'value',
      displayName: 'Value (legacy)',
      type: 'string',
      default: '',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as {
      expression?: string;
      field?: string;
      operator?: string;
      value?: string;
    };

    const trueItems: ExecutionItem[] = [];
    const falseItems: ExecutionItem[] = [];

    for (let idx = 0; idx < ctx.inputItems.length; idx++) {
      const item = ctx.inputItems[idx];
      let result: boolean;

      try {
        if (config.expression && config.expression.trim()) {
          // Modo v1: evalúa expression.
          const value = ctx.resolveExpression(config.expression, item);
          result = Boolean(value);
        } else {
          // Modo legacy v0.
          const fieldValue = config.field
            ? (item.json as Record<string, unknown>)?.[config.field]
            : undefined;
          const target = config.value ?? '';
          const strVal = fieldValue === undefined || fieldValue === null ? '' : String(fieldValue);
          switch (config.operator) {
            case 'eq': result = strVal === target; break;
            case 'neq': result = strVal !== target; break;
            case 'gt': result = Number(strVal) > Number(target); break;
            case 'lt': result = Number(strVal) < Number(target); break;
            case 'contains': result = strVal.includes(target); break;
            case 'is_empty': result = strVal.trim() === ''; break;
            case 'is_not_empty': result = strVal.trim() !== ''; break;
            default: result = Boolean(strVal);
          }
        }
      } catch (e) {
        return {
          status: 'error',
          error: {
            code: 'IF_EXPRESSION_ERROR',
            message: e instanceof Error ? e.message : String(e),
            nodeId: ctx.node.id,
            retryable: false,
          },
        };
      }

      if (result) {
        trueItems.push({
          ...item,
          pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
        });
      } else {
        falseItems.push({
          ...item,
          pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
        });
      }
    }

    return {
      status: 'success',
      outputs: {
        true: trueItems,
        false: falseItems,
      },
    };
  },
  migrate: (oldConfig, fromVersion) => {
    if (fromVersion === 0) {
      // v0: field + operator + value → v1: dejar como legacy, no construir expression automáticamente.
      return { ...oldConfig };
    }
    return oldConfig;
  },
};
