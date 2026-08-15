/**
 * FASE 4 — Catálogo built-in de NodeDefinitions.
 *
 * Cada nueva definición debe añadirse aquí al array BUILTIN_NODE_DEFINITIONS.
 * El registry las carga via loadBuiltinNodeDefinitions() (lazy).
 */

import type { NodeDefinition } from '../../types/node_definition';

import { webhookDefinition } from './webhook';
import { scheduleDefinition } from './schedule';
import { manualDefinition } from './manual';
import { codeDefinition } from './code';
import { ifDefinition } from './if';
import { delayDefinition } from './delay';
import { setDefinition } from './set';
import { chatMessageDefinition } from './chat_message';
import { httpRequestDefinition } from './http_request';
import { filterDefinition } from './filter';
import { sortDefinition } from './sort';
import { limitDefinition } from './limit';
import { aggregateDefinition } from './aggregate';
import { splitDefinition } from './split';
import { mergeDefinition } from './merge';
import { loopDefinition } from './loop';
import { switchDefinition } from './switch';
import { executeWorkflowDefinition } from './execute_workflow';
import { llmDefinition } from './llm';

export const BUILTIN_NODE_DEFINITIONS: NodeDefinition[] = [
  webhookDefinition,
  scheduleDefinition,
  manualDefinition,
  codeDefinition,
  ifDefinition,
  delayDefinition,
  setDefinition,
  chatMessageDefinition,
  httpRequestDefinition,
  filterDefinition,
  sortDefinition,
  limitDefinition,
  aggregateDefinition,
  splitDefinition,
  mergeDefinition,
  loopDefinition,
  switchDefinition,
  executeWorkflowDefinition,
  llmDefinition,
];

/** Re-exporta cada definición para uso directo en tests. */
export {
  webhookDefinition,
  scheduleDefinition,
  manualDefinition,
  codeDefinition,
  ifDefinition,
  delayDefinition,
  setDefinition,
  chatMessageDefinition,
  httpRequestDefinition,
  filterDefinition,
  sortDefinition,
  limitDefinition,
  aggregateDefinition,
  splitDefinition,
  mergeDefinition,
  loopDefinition,
  switchDefinition,
  executeWorkflowDefinition,
  llmDefinition,
};
