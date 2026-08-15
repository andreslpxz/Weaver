/**
 * FASE 3 — Tipos de NodeDefinition.
 *
 * Un NodeDefinition es la "clase" de un nodo: define sus inputs, outputs,
 * parámetros, cómo validarlos y cómo ejecutarlo. Las instancias en el
 * canvas (WorkflowNode) referencian un NodeDefinition por (type, version).
 *
 * El engine v2 NO tiene un switch gigante por tipo. En su lugar, mira
 * el NodeDefinition en el NodeRegistry y llama a su execute().
 */

import type {
  WorkflowNode,
  WorkflowEdgeHandle,
  WorkflowNodeType,
} from './definition';
import type { ExecutionItem, StructuredError } from './execution';

/** Parámetro que un nodo declara para su configuración (UI + validación). */
export interface NodeParameter {
  name: string;
  displayName?: string;
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'object'
    | 'array'
    | 'options'
    | 'expression'
    | 'code'
    | 'credential';
  description?: string;
  default?: unknown;
  required?: boolean;
  placeholder?: string;
  /** Para type: 'options'. */
  options?: Array<{ value: string; label: string }>;
  /** Para type: 'credential', qué CredentialType acepta. */
  credentialType?: string;
  /** Para type: 'array', schema de cada item. */
  itemSchema?: Record<string, unknown>;
}

/** Salida declarada de un nodo (para UI + validación de conexiones). */
export interface NodeOutput {
  /** ID del handle. 'default' para salida única. 'true'/'false' para IF. */
  handle: WorkflowEdgeHandle;
  displayName?: string;
}

/** Entrada declarada de un nodo. */
export interface NodeInput {
  handle?: string;
  displayName?: string;
  /** Si true, acepta múltiples inputs (Merge). Default false. */
  multiple?: boolean;
}

/** Request de credential que el nodo hace al engine. */
export interface CredentialRequest {
  name: string;
  credentialType: string;
  required?: boolean;
  /** Campo del config donde está el credentialId. */
  credentialIdField: string;
}

/** Contexto que el engine le pasa a NodeDefinition.execute(). */
export interface ExecutionContext {
  /** Execution completa (read-only para el nodo). */
  execution: import('./execution').Execution;
  /** El nodo que se está ejecutando. */
  node: WorkflowNode;
  /** Items de entrada que el nodo debe procesar. */
  inputItems: ExecutionItem[];
  /** Variables globales del workflow (set por nodos Set previos). */
  variables: Record<string, unknown>;
  /** Credenciales ya descifradas que el nodo pidió (por name). */
  credentials: Record<string, Record<string, unknown>>;
  /** Variables de entorno (filtradas, sólo las permitidas). */
  environment: Record<string, string>;
  /** Helpers para el expression engine ($now, $today, $timedelta, etc.). */
  helpers: ExpressionHelpers;
  /** Signal para cancellation. El nodo debe escuchar y abortar. */
  signal: AbortSignal;
  /** Logger estructurado. */
  log: NodeLogger;
  /** Función para resolver una expression en el contexto actual. */
  resolveExpression: (expr: string, itemOverride?: ExecutionItem) => unknown;
  /** Función para llamar a un sub-workflow (usada por execute_workflow node). */
  executeSubworkflow?: (
    workflowId: string,
    input: ExecutionItem[],
    waitForResult: boolean,
  ) => Promise<{ executionId: string; output?: ExecutionItem[]; error?: StructuredError }>;
}

/** Helpers expuestos en expressions como $now, $today, etc. */
export interface ExpressionHelpers {
  now: () => string;
  today: () => string;
  timedelta: (amount: number, unit: 'ms' | 's' | 'm' | 'h' | 'd') => string;
  randomInt: (min: number, max: number) => number;
  uuid: () => string;
  /** Para acceso a otros nodos desde $node / $items. */
  getNodeOutput?: (nodeLabel: string) => ExecutionItem[] | undefined;
}

/** Logger por nodo. */
export interface NodeLogger {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
}

/** Resultado de execute(). */
export interface NodeExecuteResult {
  /** Si 'success', el nodo terminó bien. Si 'error', falló. Si 'waiting', se pausó. */
  status: 'success' | 'error' | 'waiting';
  /** Items de salida (por handle). Si no se especifica handle, van a 'default'.
   *  Partial: handles sin items pueden omitirse o ser undefined. */
  outputs?: Partial<Record<string, ExecutionItem[]>>;
  /** Si status='error', info del error. */
  error?: StructuredError;
  /** Metadata adicional (duration ya la calcula el engine). */
  metadata?: Record<string, unknown>;
  /** Si el nodo quiere reanudar más tarde (Wait), datos para resumir. */
  resumeToken?: string;
}

/** Función execute de un NodeDefinition. */
export type NodeExecuteFn = (
  ctx: ExecutionContext,
) => Promise<NodeExecuteResult> | NodeExecuteResult;

/** Función de migración entre versiones de un mismo nodo. */
export type NodeMigrateFn = (
  oldConfig: Record<string, unknown>,
  fromVersion: number,
  toVersion: number,
) => Record<string, unknown>;

/** La definición de un tipo de nodo. */
export interface NodeDefinition {
  type: WorkflowNodeType;
  version: number;
  displayName: string;
  description: string;
  icon?: string;
  category: import('./definition').NodeCategory;
  /** Inputs que el nodo acepta. Vacío para triggers. */
  inputs: NodeInput[];
  /** Outputs que el nodo produce. */
  outputs: NodeOutput[];
  /** Parámetros configurables (para el panel de config en la UI). */
  parameters: NodeParameter[];
  /** Credenciales que el nodo puede requerir. */
  credentials?: CredentialRequest[];
  /** Si true, es un trigger (webhook, schedule, manual). */
  isTrigger?: boolean;
  /** Si true, el nodo puede recibir múltiples items y procesarlos uno a uno. */
  processesItems?: 'one' | 'all' | 'batch';
  /** Función de ejecución. */
  execute: NodeExecuteFn;
  /** Función de migración entre versiones (opcional). */
  migrate?: NodeMigrateFn;
  /** Valida la config del nodo antes de ejecutar (opcional). */
  validate?: (config: Record<string, unknown>) => StructuredError[];
}
