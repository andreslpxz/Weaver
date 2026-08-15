/**
 * FASE 4 — Schedule node definition.
 *
 * Trigger node: dispara el workflow según una expresión cron.
 * El runtime real vive en Rust (FASE 10). Aquí passthrough.
 */

import type { NodeDefinition } from '../../types/node_definition';

export const scheduleDefinition: NodeDefinition = {
  type: 'schedule',
  version: 1,
  displayName: 'Schedule',
  description: 'Dispara el workflow en un horario fijo (cron expression).',
  icon: 'clock',
  category: 'trigger',
  isTrigger: true,
  processesItems: 'all',
  inputs: [],
  outputs: [{ handle: 'default', displayName: 'Output' }],
  parameters: [
    {
      name: 'cronExpr',
      displayName: 'Cron Expression',
      type: 'string',
      description: 'Estándar 5 campos: min hour day-of-month month day-of-week. Ej: "0 9 * * *" = todos los días a las 9am.',
      default: '',
      placeholder: '0 9 * * *',
      required: true,
    },
    {
      name: 'timezone',
      displayName: 'Timezone',
      type: 'string',
      description: 'IANA timezone (p.ej. America/Mexico_City). Default: UTC.',
      default: 'UTC',
      placeholder: 'America/Mexico_City',
    },
  ],
  execute: async (ctx) => {
    // Schedule runtime inyecta un item con timestamp de trigger.
    return {
      status: 'success',
      outputs: {
        default: ctx.inputItems.length > 0 ? ctx.inputItems : [
          {
            json: { triggeredAt: new Date().toISOString(), source: 'schedule' },
            source: 'schedule',
          },
        ],
      },
    };
  },
  validate: (config) => {
    const errors = [];
    const cron = config.cronExpr as string | undefined;
    if (!cron) {
      errors.push({
        code: 'INVALID_NODE_CONFIG',
        message: 'Schedule requiere cronExpr',
        severity: 'error' as const,
        path: 'config.cronExpr',
      });
    } else {
      // Validación básica de 5 campos.
      const parts = cron.trim().split(/\s+/);
      if (parts.length !== 5) {
        errors.push({
          code: 'INVALID_NODE_CONFIG',
          message: `Cron expression debe tener 5 campos, tiene ${parts.length}`,
          severity: 'error' as const,
          path: 'config.cronExpr',
        });
      }
    }
    return errors;
  },
};
