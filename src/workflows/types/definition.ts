/**
 * FASE 3 — Tipos de definición de Workflow.
 *
 * Un Workflow es un grafo (nodos + conexiones) más un chat propio donde el
 * usuario le pide al agente que construya/edite ese grafo.
 *
 * Separado de tipos de ejecución (execution.ts) para mantener clara la
 * distinción entre la definición (lo que el usuario edita) y el estado
 * de ejecución (lo que el engine produce al correr).
 */

import type { ExecutionItem } from './execution';

/** Identificador de tipo de nodo. Será combinado con `version` en el registry. */
export type WorkflowNodeType =
  | 'webhook'
  | 'schedule'
  | 'code'
  | 'if'
  | 'switch'
  | 'delay'
  | 'set'
  | 'chat_message'
  | 'http_request'
  | 'loop'
  | 'split'
  | 'filter'
  | 'sort'
  | 'limit'
  | 'aggregate'
  | 'merge'
  | 'execute_workflow'
  | 'llm'
  | 'ai_agent'
  | 'structured_output'
  | 'memory'
  | 'tool'
  | 'manual';

/** Posición en el canvas (coordenadas de React Flow). */
export interface WorkflowPosition {
  x: number;
  y: number;
}

/** Configuración específica de cada tipo de nodo. Todos los campos son opcionales
 * porque el nodo puede crearse vacío y completarse después (a mano o por el agente). */
export interface WebhookNodeConfig {
  path?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  responseMode?: 'sync' | 'async';
  authCredentialId?: string;
}

export interface ScheduleNodeConfig {
  /** Expresión cron estándar de 5 campos: min hour dom month dow. */
  cronExpr?: string;
  timezone?: string;
  /** Legacy: tiempo HH:MM + recurrence (compatibilidad con workflows v0). */
  time?: string;
  recurrence?: 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
  weekday?: number;
  monthDay?: number;
}

export interface CodeNodeConfig {
  language?: 'javascript' | 'python' | 'bash';
  code?: string;
}

export interface IfNodeConfig {
  /** Expression que se evalúa a booleano. Reemplaza al field/operator/value legacy. */
  expression?: string;
  /** Legacy v0: field + operator + value. Si expression está vacío, se usa este. */
  field?: string;
  operator?: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'is_empty' | 'is_not_empty';
  value?: string;
}

export interface SwitchCase {
  id: string;
  label: string;
  expression: string;
}

export interface SwitchNodeConfig {
  cases?: SwitchCase[];
  defaultCase?: string;
}

export interface DelayNodeConfig {
  ms?: number;
}

export interface SetFieldEntry {
  key: string;
  /** Expression que se evalúa al valor a asignar. */
  value: string;
}

export interface SetNodeConfig {
  fields?: SetFieldEntry[];
  /** Si true, reemplaza todo el item. Si false (default), mergea con el item actual. */
  replace?: boolean;
}

export interface ChatMessageNodeConfig {
  message?: string;
}

export interface HttpRequestNodeConfig {
  url?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  /** ID de credential a resolver (httpHeaderAuth / httpBasicAuth / oAuth2Api). */
  credentialId?: string;
  /** Si true, evalúa response como JSON y lo deja en $json. */
  parseJson?: boolean;
  timeoutMs?: number;
}

export interface LoopNodeConfig {
  /** Expression que devuelve el array sobre el que iterar. Si vacío, itera sobre inputItems. */
  itemsExpression?: string;
  /** Máximo de iteraciones (safety). Default 1000. */
  maxIterations?: number;
}

export interface FilterNodeConfig {
  /** Expression que se evalúa a booleano por item. Los items que dan false se descartan. */
  expression?: string;
}

export interface SortNodeConfig {
  /** Expression que devuelve el valor clave para ordenar. */
  keyExpression?: string;
  order?: 'asc' | 'desc';
}

export interface LimitNodeConfig {
  limit?: number;
  /** Si true, mantiene los últimos N en vez de los primeros. */
  fromEnd?: boolean;
}

export interface AggregateNodeConfig {
  /** Nombre del campo donde poner el array agregado. Default "items". */
  field?: string;
}

export interface MergeNodeConfig {
  mode?: 'append' | 'combine' | 'wait_all';
}

export interface ExecuteWorkflowNodeConfig {
  /** ID del workflow destino. Alternativamente, name para lookup. */
  workflowId?: string;
  workflowName?: string;
  /** Mapeo de campos del input actual al input del subworkflow. */
  inputMapping?: Record<string, string>;
  /** Si true (default), espera a que el subworkflow termine y usa su output. */
  waitForResult?: boolean;
}

export interface LlmNodeConfig {
  providerId?: string;
  modelId?: string;
  systemPrompt?: string;
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** Si true, parsea el output como JSON. */
  jsonMode?: boolean;
}

export interface AiAgentNodeConfig {
  providerId?: string;
  modelId?: string;
  objective?: string;
  maxSteps?: number;
  /** Tools permitidas para el sub-agente (subset de las del agente principal). */
  allowedTools?: string[];
}

export interface StructuredOutputNodeConfig {
  /** JSON Schema que el LLM debe seguir. */
  schema?: Record<string, unknown>;
  prompt?: string;
  providerId?: string;
  modelId?: string;
}

export interface MemoryNodeConfig {
  action?: 'save_fact' | 'get_fact' | 'delete_fact' | 'list_facts' | 'save_episode';
  key?: string;
  valueExpression?: string;
  namespace?: string;
}

export interface ManualNodeConfig {
  /** Mensaje que se le pide al usuario que confirme antes de continuar. */
  prompt?: string;
}

export type WorkflowNodeConfig =
  | WebhookNodeConfig
  | ScheduleNodeConfig
  | CodeNodeConfig
  | IfNodeConfig
  | SwitchNodeConfig
  | DelayNodeConfig
  | SetNodeConfig
  | ChatMessageNodeConfig
  | HttpRequestNodeConfig
  | LoopNodeConfig
  | FilterNodeConfig
  | SortNodeConfig
  | LimitNodeConfig
  | AggregateNodeConfig
  | MergeNodeConfig
  | ExecuteWorkflowNodeConfig
  | LlmNodeConfig
  | AiAgentNodeConfig
  | StructuredOutputNodeConfig
  | MemoryNodeConfig
  | ManualNodeConfig;

/** Configuración de retry por nodo. */
export interface RetryPolicy {
  maxAttempts?: number;       // default 1 (sin retry)
  backoff?: 'fixed' | 'exponential';
  delayMs?: number;           // default 1000
  /** Si true, continúa al siguiente nodo aunque este falle. */
  continueOnFail?: boolean;
  /** Si true, activa la salida "error" del nodo en vez de fallar el workflow. */
  onError?: 'fail_workflow' | 'continue' | 'error_branch';
}

/** Versión del NodeDefinition que este nodo requiere. */
export interface NodeVersionRef {
  type: WorkflowNodeType;
  version: number;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  /** Versión del NodeDefinition. Default 1. */
  version?: number;
  label: string;
  position: WorkflowPosition;
  config: Record<string, unknown>;
  /** Política de retry/timeout override a nivel de instancia. */
  retry?: RetryPolicy;
  timeoutMs?: number;
  /** Nota libre del usuario (anotación en el canvas). */
  note?: string;
  /** Si true, el nodo está deshabilitado (no se ejecuta, se salta). */
  disabled?: boolean;
}

export type WorkflowEdgeHandle = 'default' | 'true' | 'false' | 'error' | string;

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle?: WorkflowEdgeHandle;
  target: string;
  /** Expression que debe evaluar a true para que el item pase por esta edge. */
  filterExpression?: string;
}

export interface WorkflowChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

/** Log legado (compatibilidad con workflows v0). */
export interface WorkflowRunLogEntry {
  ts: number;
  nodeId: string;
  nodeLabel: string;
  status: 'ok' | 'error' | 'skipped';
  output?: string;
  error?: string;
}

export interface WorkflowRun {
  id: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'success' | 'error';
  log: WorkflowRunLogEntry[];
}

export interface WorkflowSettings {
  /** Máxima duración total de una ejecución (ms). Default 30 min. */
  maxExecutionDurationMs?: number;
  /** Máximo de items que un nodo puede producir. Default 10000. */
  maxItemsPerNode?: number;
  /** Máximo de pasos totales (NodeExecution) en una ejecución. Default 10000. */
  maxSteps?: number;
  /** Modo de ejecución por defecto para el workflow. */
  defaultExecutionMode?: 'manual' | 'trigger' | 'webhook' | 'schedule';
  /** Timezone para el schedule (IANA). Default UTC. */
  timezone?: string;
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  chat: WorkflowChatMessage[];
  createdAt: number;
  updatedAt: number;
  lastRun?: WorkflowRun;
  enabled: boolean;
  settings?: WorkflowSettings;
  /** ID de la versión publicada (para versioning). Si null, usa el draft. */
  publishedVersionId?: string | null;
  /** Tags libres para organización. */
  tags?: string[];
}

/** Versión snapshot del workflow (para versioning y rollback). */
export interface WorkflowVersion {
  id: string;
  workflowId: string;
  versionNumber: number;
  snapshot: Workflow;
  label?: string;
  createdAt: number;
  createdBy?: string;
}

/** Input que se pasa al workflow al iniciarlo (trigger payload). */
export interface WorkflowTriggerInput {
  /** Items iniciales a inyectar en los trigger nodes. */
  items?: ExecutionItem[];
  /** Metadata adicional (Headers del webhook, query params, etc.). */
  metadata?: Record<string, unknown>;
  /** Modo de ejecución. */
  mode?: 'manual' | 'trigger' | 'webhook' | 'schedule' | 'subworkflow';
}

export const WORKFLOW_NODE_LABELS: Record<WorkflowNodeType, string> = {
  webhook: 'Webhook',
  schedule: 'Schedule',
  code: 'Code',
  if: 'If / Else',
  switch: 'Switch',
  delay: 'Delay',
  set: 'Set',
  chat_message: 'Chat',
  http_request: 'HTTP Request',
  loop: 'Loop',
  split: 'Split',
  filter: 'Filter',
  sort: 'Sort',
  limit: 'Limit',
  aggregate: 'Aggregate',
  merge: 'Merge',
  execute_workflow: 'Execute Workflow',
  llm: 'LLM',
  ai_agent: 'AI Agent',
  structured_output: 'Structured Output',
  memory: 'Memory',
  tool: 'Tool',
  manual: 'Manual Trigger',
};

/** Categorías para el node picker. */
export type NodeCategory = 'trigger' | 'logic' | 'data' | 'network' | 'flow' | 'ai';

export const WORKFLOW_NODE_CATEGORIES: Record<WorkflowNodeType, NodeCategory> = {
  webhook: 'trigger',
  schedule: 'trigger',
  manual: 'trigger',
  if: 'logic',
  switch: 'logic',
  filter: 'logic',
  loop: 'flow',
  split: 'flow',
  merge: 'flow',
  aggregate: 'flow',
  sort: 'data',
  limit: 'data',
  set: 'data',
  code: 'data',
  chat_message: 'data',
  http_request: 'network',
  delay: 'flow',
  execute_workflow: 'flow',
  llm: 'ai',
  ai_agent: 'ai',
  structured_output: 'ai',
  memory: 'ai',
  tool: 'ai',
};
