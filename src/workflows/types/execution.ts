/**
 * FASE 3 — Tipos de ejecución de Workflow.
 *
 * El modelo de ejecución está basado en el concepto de n8n (Execution /
 * ExecutionContext / ExecutionItem / NodeExecution) pero reinterpretado
 * para Weaver:
 *
 *   - ExecutionItem: la unidad de dato que fluye entre nodos. Soporta
 *     múltiples items por nodo (no solo un objeto plano).
 *   - ExecutionContext: el estado que se le pasa a NodeDefinition.execute().
 *   - NodeExecution: el resultado de correr un nodo una vez (con sus
 *     input/output items, duración, error, attempts).
 *   - Execution: la corrida completa del workflow.
 *
 * La distinción clave vs el engine v0 es:
 *   - El engine v0 usaba `ExecContext = Record<string, unknown>` que se iba
 *     fusionando entre nodos. Esto impedía multiple items.
 *   - El engine v2 pasa `ExecutionItem[]` entre nodos. Cada item es
 *     independiente y se procesa según la semántica del nodo.
 */

/** Dato binario adjunto a un item (p.ej. file upload de un webhook). */
export interface BinaryData {
  /** Identificador único del blob dentro de la ejecución. */
  id: string;
  fileName?: string;
  mimeType?: string;
  /** Tamaño en bytes. */
  size?: number;
  /** Para datos pequeños, va inline. Para grandes, el engine lo persiste aparte. */
  data?: string;
  /** Referencia externa (p.ej. file path en tmp dir del engine). */
  ref?: string;
}

/** Un item de datos que fluye entre nodos. */
export interface ExecutionItem {
  /** Payload principal. Cualquier valor JSON-serializable. */
  json: unknown;
  /** Archivos adjuntos (opcional). */
  binary?: BinaryData;
  /** Metadata libre (headers del webhook, source, etc.). */
  metadata?: Record<string, unknown>;
  /** Trazabilidad: de qué item de qué nodo proviene. */
  pairedItem?: Array<{ nodeId: string; itemIndex: number }>;
  /** Origen legible (p.ej. "webhook", "schedule", "manual"). */
  source?: string;
}

/** Estado global de una ejecución. */
export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type ExecutionMode =
  | 'manual'
  | 'trigger'
  | 'webhook'
  | 'schedule'
  | 'subworkflow';

/** Error estructurado (no un string plano). */
export interface StructuredError {
  code: string;
  message: string;
  /** ID del nodo donde ocurrió (si aplica). */
  nodeId?: string;
  /** Stack trace (en sandbox de código). */
  stack?: string;
  /** Detalles adicionales estructurados. */
  details?: Record<string, unknown>;
  /** Si true, el error es recuperable con retry. */
  retryable?: boolean;
}

/** Resultado de correr un nodo una vez (con todos sus items). */
export interface NodeExecution {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  nodeVersion: number;
  status: 'success' | 'error' | 'skipped' | 'waiting';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  inputItems: ExecutionItem[];
  outputItems: ExecutionItem[];
  error?: StructuredError;
  /** Cuántas veces se intentó (1 = primera vez, 2 = un retry, etc.). */
  attempts: number;
  /** Si este NodeExecution es retry de otro, su id. */
  retryOf?: string;
  /** Items que se pasaron a cada edge saliente. */
  outputsByHandle?: Partial<Record<string, ExecutionItem[]>>;
  /** Metadata adicional (resumeToken para Wait, etc.). */
  metadata?: Record<string, unknown>;
}

/** Una corrida completa de un workflow. */
export interface Execution {
  id: string;
  workflowId: string;
  /** ID de la versión del workflow que se ejecutó (para versioning). */
  workflowVersionId?: string;
  status: ExecutionStatus;
  mode: ExecutionMode;
  startedAt: number;
  finishedAt?: number;
  /** Input inicial (payload del trigger). */
  input: ExecutionItem[];
  /** Output final (items del último nodo ejecutado). */
  output: ExecutionItem[];
  error?: StructuredError;
  nodeExecutions: NodeExecution[];
  metadata: Record<string, unknown>;
  /** Si esta execution fue disparada por un parent (subworkflow). */
  parentExecutionId?: string;
  /** Si esta execution disparó subworkflows, sus IDs. */
  childExecutionIds?: string[];
}

/** Snapshot del estado del engine en un momento dado. */
export interface ExecutionState {
  execution: Execution;
  /** Items pendientes de procesar, agrupados por (nodeId, sourceHandle). */
  pending: Array<{
    nodeId: string;
    items: ExecutionItem[];
    sourceHandle?: string;
  }>;
  /** Items ya producidos por cada nodo (cache para expressions $node[...]). */
  nodeOutputs: Map<string, NodeExecution>;
  /** Nodos que ya terminaron (para no re-ejecutar a menos que sea loop). */
  completedNodes: Set<string>;
  /** Nodos actualmente en ejecución. */
  runningNodes: Set<string>;
  /** Camino actual (para detección de ciclos en runtime). */
  currentPath: string[];
}
