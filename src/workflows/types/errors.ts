/**
 * FASE 3 / 6 — Tipos de errores y validación.
 */

import type { WorkflowEdgeHandle } from './definition';

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationError {
  /** ID del nodo involucrado (si aplica). */
  nodeId?: string;
  /** Edge ID involucrado (si aplica). */
  edgeId?: string;
  /** Código de error estable (para i18n / programmatic handling). */
  code: string;
  message: string;
  severity: ValidationSeverity;
  /** Path al campo problemático (p.ej. "config.url"). */
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  infos: ValidationError[];
}

export function emptyValidationResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [], infos: [] };
}

export function addError(result: ValidationResult, error: ValidationError): void {
  if (error.severity === 'error') {
    result.errors.push(error);
    result.valid = false;
  } else if (error.severity === 'warning') {
    result.warnings.push(error);
  } else {
    result.infos.push(error);
  }
}

/** Códigos de error estables. */
export const VALIDATION_CODES = {
  NO_TRIGGER: 'no_trigger',
  NO_NODES: 'no_nodes',
  DISCONNECTED_NODE: 'disconnected_node',
  CYCLE_DETECTED: 'cycle_detected',
  INVALID_EDGE_REF: 'invalid_edge_ref',
  DUPLICATE_NODE_ID: 'duplicate_node_id',
  MISSING_CREDENTIAL: 'missing_credential',
  INVALID_EXPRESSION: 'invalid_expression',
  IF_MISSING_BRANCH: 'if_missing_branch',
  MERGE_INSUFFICIENT_INPUTS: 'merge_insufficient_inputs',
  LOOP_MISSING_MAX_ITERATIONS: 'loop_missing_max_iterations',
  UNKNOWN_NODE_TYPE: 'unknown_node_type',
  INVALID_NODE_CONFIG: 'invalid_node_config',
  NODE_VERSION_NOT_FOUND: 'node_version_not_found',
} as const;

/** Códigos de error de ejecución. */
export const EXECUTION_ERROR_CODES = {
  NODE_TIMEOUT: 'node_timeout',
  NODE_RETRY_EXHAUSTED: 'node_retry_exhausted',
  MAX_STEPS_EXCEEDED: 'max_steps_exceeded',
  MAX_ITEMS_EXCEEDED: 'max_items_exceeded',
  MAX_DURATION_EXCEEDED: 'max_duration_exceeded',
  CANCELLED: 'cancelled',
  CYCLE_AT_RUNTIME: 'cycle_at_runtime',
  SUBWORKFLOW_DEPTH_EXCEEDED: 'subworkflow_depth_exceeded',
  NODE_DEFINITION_NOT_FOUND: 'node_definition_not_found',
  CREDENTIAL_RESOLUTION_FAILED: 'credential_resolution_failed',
  EXPRESSION_EVAL_FAILED: 'expression_eval_failed',
  SSRF_BLOCKED: 'ssrf_blocked',
} as const;

/** Type guard para sourceHandle. */
export function isValidHandle(handle: string | undefined): handle is WorkflowEdgeHandle {
  if (!handle) return true;
  return typeof handle === 'string' && handle.length > 0;
}
