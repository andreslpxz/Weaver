/**
 * FASE 26 — LLM node definition.
 *
 * Llama a un provider+modelo con un prompt (con expressions) y devuelve
 * el texto generado. Reutiliza la infraestructura de providers/ existente.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem, StructuredError } from '../../types/execution';
import { createProvider } from '@/providers';
import { streamChat } from '@/lib/chain';
import type { ProviderId } from '@/providers/types';

export const llmDefinition: NodeDefinition = {
  type: 'llm',
  version: 1,
  displayName: 'LLM',
  description: 'Llama a un LLM con un prompt. Soporta expressions.',
  icon: 'brain',
  category: 'ai',
  processesItems: 'one',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [
    { handle: 'default', displayName: 'Output' },
    { handle: 'error', displayName: 'Error' },
  ],
  parameters: [
    {
      name: 'providerId',
      displayName: 'Provider',
      type: 'string',
      description: 'ID del provider (p.ej. openai, anthropic). Default: el activo en Weaver.',
      default: '',
    },
    {
      name: 'modelId',
      displayName: 'Model',
      type: 'string',
      description: 'ID del modelo (p.ej. gpt-4o). Default: el activo.',
      default: '',
    },
    {
      name: 'systemPrompt',
      displayName: 'System Prompt',
      type: 'expression',
      default: '',
      description: 'System prompt (opcional). Soporta expressions.',
    },
    {
      name: 'prompt',
      displayName: 'User Prompt',
      type: 'expression',
      default: '',
      description: 'Prompt del usuario. Soporta expressions.',
      required: true,
    },
    {
      name: 'temperature',
      displayName: 'Temperature',
      type: 'number',
      default: 0.7,
    },
    {
      name: 'maxTokens',
      displayName: 'Max Tokens',
      type: 'number',
      default: 1000,
    },
    {
      name: 'jsonMode',
      displayName: 'JSON Mode',
      type: 'boolean',
      default: false,
      description: 'Si true, fuerza output JSON.',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as {
      providerId?: string;
      modelId?: string;
      systemPrompt?: string;
      prompt?: string;
      temperature?: number;
      maxTokens?: number;
      jsonMode?: boolean;
    };

    // Provider/model defaults: intentar usar el activo del store de Weaver.
    let providerId = config.providerId;
    let modelId = config.modelId;
    if (!providerId || !modelId) {
      try {
        const { useWeaver } = await import('@/store/weaver');
        const state = useWeaver.getState();
        providerId = providerId ?? (state.providerId ?? undefined) ?? undefined;
        modelId = modelId ?? (state.modelId ?? undefined) ?? undefined;
      } catch {
        // noop
      }
    }

    if (!providerId || !modelId) {
      return {
        status: 'error',
        error: {
          code: 'LLM_NO_PROVIDER',
          message: 'LLM node requiere providerId y modelId (o tener uno activo en Weaver).',
          nodeId: ctx.node.id,
          retryable: false,
        } satisfies StructuredError,
      };
    }

    const successItems: ExecutionItem[] = [];
    const errorItems: ExecutionItem[] = [];

    try {
      const llm = await createProvider(providerId as ProviderId);

      for (let idx = 0; idx < ctx.inputItems.length; idx++) {
        const item = ctx.inputItems[idx];
        const systemPrompt = config.systemPrompt
          ? String(ctx.resolveExpression(config.systemPrompt, item))
          : undefined;
        const prompt = String(ctx.resolveExpression(config.prompt ?? '', item));

        const messages = [
          ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
          { role: 'user' as const, content: prompt },
        ];

        try {
          const result = await streamChat(llm, modelId, messages);
          successItems.push({
            ...item,
            json: {
              ...(item.json as Record<string, unknown> ?? {}),
              _llmOutput: result.text,
              _llmModel: modelId,
            },
            pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
          });
        } catch (e) {
          errorItems.push({
            ...item,
            json: {
              ...(item.json as Record<string, unknown> ?? {}),
              _llmError: e instanceof Error ? e.message : String(e),
            },
            pairedItem: [{ nodeId: ctx.node.id, itemIndex: idx }],
          });
        }
      }
    } catch (e) {
      return {
        status: 'error',
        error: {
          code: 'LLM_PROVIDER_ERROR',
          message: e instanceof Error ? e.message : String(e),
          nodeId: ctx.node.id,
          retryable: false,
        } satisfies StructuredError,
      };
    }

    if (successItems.length === 0 && errorItems.length > 0) {
      return {
        status: 'error',
        error: {
          code: 'LLM_ALL_FAILED',
          message: `Todos los ${errorItems.length} requests LLM fallaron`,
          nodeId: ctx.node.id,
          retryable: true,
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
