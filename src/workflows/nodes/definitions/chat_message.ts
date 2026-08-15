/**
 * FASE 4 — Chat Message node definition.
 *
 * v1: muestra el mensaje en el log de ejecución (igual que v0).
 * Futuro: integrar con canal de mensajería real (Discord/Slack/etc.)
 * vía HTTP node + credential, lo que es más flexible que un node
 * específico.
 */

import type { NodeDefinition } from '../../types/node_definition';
import type { ExecutionItem } from '../../types/execution';

export const chatMessageDefinition: NodeDefinition = {
  type: 'chat_message',
  version: 1,
  displayName: 'Chat Message',
  description: 'Muestra un mensaje en el log de ejecución. Soporta expressions.',
  icon: 'message-square',
  category: 'data',
  processesItems: 'one',
  inputs: [{ handle: 'default', displayName: 'Input' }],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'message',
      displayName: 'Message',
      type: 'expression',
      description: 'Texto del mensaje. Soporta expressions.',
      default: '',
      placeholder: 'Pedido {{$json.orderId}} recibido',
    },
  ],
  execute: async (ctx) => {
    const config = ctx.node.config as { message?: string };
    const messages: string[] = [];

    for (let idx = 0; idx < ctx.inputItems.length; idx++) {
      const item = ctx.inputItems[idx];
      const resolved = ctx.resolveExpression(config.message ?? '', item);
      messages.push(typeof resolved === 'string' ? resolved : JSON.stringify(resolved));
    }

    ctx.log.info('chat_message', { messages });

    const outputItems: ExecutionItem[] = ctx.inputItems.map((item, idx) => ({
      ...item,
      pairedItem: [...(item.pairedItem ?? []), { nodeId: ctx.node.id, itemIndex: idx }],
      metadata: { ...item.metadata, lastChatMessage: messages[idx] ?? '' },
    }));

    return {
      status: 'success',
      outputs: { default: outputItems },
      metadata: { messages },
    };
  },
};
