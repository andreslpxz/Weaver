/**
 * FASE 6 — Workflow Validator.
 *
 * Detecta workflows inválidos antes de ejecutarlos. Devuelve errores
 * estructurados (código estable, severity, nodeId, path).
 *
 * Reglas:
 *   1. Al menos un trigger node (webhook/schedule/manual)
 *   2. No hay nodos desconectados (cada nodo no-trigger tiene al menos un edge entrante)
 *   3. No hay ciclos (DFS con color marking)
 *   4. Referencias a nodos válidas (edges apuntan a nodos existentes)
 *   5. Credentials referenced exist (cuando se pasa credentialsByIds)
 *   6. Expressions válidas (parse sin error)
 *   7. IF node tiene exactamente 2 salidas (true/false)
 *   8. Merge node tiene ≥ 2 entradas
 *   9. Loop node tiene maxIterations configurado
 *  10. No hay duplicate node IDs
 *  11. Node type conocido por el registry
 */

import type { Workflow, WorkflowNode, WorkflowEdge } from '../types/definition';
import type { ValidationResult, ValidationError } from '../types/errors';
import { emptyValidationResult, addError, VALIDATION_CODES } from '../types/errors';
import { validateExpression } from '../expressions';
import type { CredentialType } from '../types/credentials';

export interface ValidatorOptions {
  /** Set de IDs de credentials que existen (para validar referencias). */
  knownCredentialIds?: Set<string>;
  /** Mapa de (type, version) → NodeDefinition conocido (para validar versiones). */
  knownNodeTypes?: Set<string>;
  /** Si true, valida expressions (más costoso). Default true. */
  validateExpressions?: boolean;
}

const TRIGGER_TYPES = new Set(['webhook', 'schedule', 'manual']);

export function validateWorkflow(wf: Workflow, opts: ValidatorOptions = {}): ValidationResult {
  const result = emptyValidationResult();
  const validateExpr = opts.validateExpressions ?? true;

  // Regla 0: workflow vacío
  if (wf.nodes.length === 0) {
    addError(result, {
      code: VALIDATION_CODES.NO_NODES,
      message: 'Workflow no tiene nodos.',
      severity: 'error',
    });
    return result;
  }

  // Regla 10: duplicate IDs
  const seenIds = new Set<string>();
  for (const node of wf.nodes) {
    if (seenIds.has(node.id)) {
      addError(result, {
        code: VALIDATION_CODES.DUPLICATE_NODE_ID,
        message: `Duplicate node ID: ${node.id}`,
        severity: 'error',
        nodeId: node.id,
      });
    }
    seenIds.add(node.id);
  }

  // Regla 11: tipos de nodo conocidos
  if (opts.knownNodeTypes) {
    for (const node of wf.nodes) {
      const key = `${node.type}@${node.version ?? 1}`;
      if (!opts.knownNodeTypes.has(key) && !opts.knownNodeTypes.has(node.type)) {
        addError(result, {
          code: VALIDATION_CODES.NODE_VERSION_NOT_FOUND,
          message: `Node type ${key} no registrado en el NodeRegistry.`,
          severity: 'error',
          nodeId: node.id,
        });
      }
    }
  }

  // Regla 1: al menos un trigger
  const triggerNodes = wf.nodes.filter((n) => TRIGGER_TYPES.has(n.type));
  if (triggerNodes.length === 0) {
    addError(result, {
      code: VALIDATION_CODES.NO_TRIGGER,
      message: 'Workflow no tiene nodos trigger (webhook/schedule/manual).',
      severity: 'error',
    });
  }

  // Mapa nodeId → node para lookups rápidos.
  const nodesById = new Map(wf.nodes.map((n) => [n.id, n]));

  // Regla 4: edges referencian nodos válidos
  for (const edge of wf.edges) {
    if (!nodesById.has(edge.source)) {
      addError(result, {
        code: VALIDATION_CODES.INVALID_EDGE_REF,
        message: `Edge ${edge.id}: source "${edge.source}" no existe.`,
        severity: 'error',
        edgeId: edge.id,
      });
    }
    if (!nodesById.has(edge.target)) {
      addError(result, {
        code: VALIDATION_CODES.INVALID_EDGE_REF,
        message: `Edge ${edge.id}: target "${edge.target}" no existe.`,
        severity: 'error',
        edgeId: edge.id,
      });
    }
  }

  // Regla 2: nodos desconectados (no-trigger sin edges entrantes)
  const nodesWithIncoming = new Set(wf.edges.map((e) => e.target));
  for (const node of wf.nodes) {
    if (TRIGGER_TYPES.has(node.type)) continue;
    if (!nodesWithIncoming.has(node.id)) {
      addError(result, {
        code: VALIDATION_CODES.DISCONNECTED_NODE,
        message: `Nodo "${node.label}" (${node.id}) no tiene conexiones entrantes.`,
        severity: 'warning',
        nodeId: node.id,
      });
    }
  }

  // Regla 3: detección de ciclos (DFS con color marking: white/gray/black)
  const colors = new Map<string, 'white' | 'gray' | 'black'>();
  for (const node of wf.nodes) colors.set(node.id, 'white');

  const adjacency = new Map<string, string[]>();
  for (const node of wf.nodes) adjacency.set(node.id, []);
  for (const edge of wf.edges) {
    if (adjacency.has(edge.source)) {
      adjacency.get(edge.source)!.push(edge.target);
    }
  }

  for (const node of wf.nodes) {
    if (colors.get(node.id) === 'white') {
      const cyclePath: string[] = [];
      if (hasCycle(node.id, adjacency, colors, cyclePath)) {
        addError(result, {
          code: VALIDATION_CODES.CYCLE_DETECTED,
          message: `Ciclo detectado: ${cyclePath.join(' → ')} → ${cyclePath[0]}`,
          severity: 'error',
          nodeId: cyclePath[0],
        });
      }
    }
  }

  // Reglas específicas por tipo de nodo.
  for (const node of wf.nodes) {
    validateNodeSpecific(node, wf.edges, result, opts, validateExpr);
  }

  return result;
}

function hasCycle(
  nodeId: string,
  adjacency: Map<string, string[]>,
  colors: Map<string, 'white' | 'gray' | 'black'>,
  path: string[],
): boolean {
  colors.set(nodeId, 'gray');
  path.push(nodeId);

  const neighbors = adjacency.get(nodeId) ?? [];
  for (const next of neighbors) {
    const color = colors.get(next);
    if (color === 'gray') {
      // Encontramos un back-edge → ciclo.
      path.push(next);
      return true;
    }
    if (color === 'white') {
      if (hasCycle(next, adjacency, colors, path)) return true;
    }
  }

  path.pop();
  colors.set(nodeId, 'black');
  return false;
}

function validateNodeSpecific(
  node: WorkflowNode,
  edges: WorkflowEdge[],
  result: ValidationResult,
  opts: ValidatorOptions,
  validateExpr: boolean,
): void {
  // Edges salientes de este nodo.
  const outgoing = edges.filter((e) => e.source === node.id);
  const incoming = edges.filter((e) => e.target === node.id);

  switch (node.type) {
    case 'if': {
      // Regla 7: IF debe tener 2 salidas (true y false).
      const trueEdge = outgoing.find((e) => e.sourceHandle === 'true');
      const falseEdge = outgoing.find((e) => e.sourceHandle === 'false');
      if (!trueEdge) {
        addError(result, {
          code: VALIDATION_CODES.IF_MISSING_BRANCH,
          message: `Nodo IF "${node.label}" no tiene conexión de salida "true".`,
          severity: 'warning',
          nodeId: node.id,
        });
      }
      if (!falseEdge) {
        addError(result, {
          code: VALIDATION_CODES.IF_MISSING_BRANCH,
          message: `Nodo IF "${node.label}" no tiene conexión de salida "false".`,
          severity: 'warning',
          nodeId: node.id,
        });
      }
      // Validar expression si está presente.
      if (validateExpr && node.config.expression) {
        const exprCheck = validateExpression(String(node.config.expression));
        if (!exprCheck.valid) {
          addError(result, {
            code: VALIDATION_CODES.INVALID_EXPRESSION,
            message: `IF expression inválida: ${exprCheck.error}`,
            severity: 'error',
            nodeId: node.id,
            path: 'config.expression',
          });
        }
      }
      break;
    }

    case 'merge': {
      // Regla 8: Merge debe tener ≥ 2 entradas.
      if (incoming.length < 2) {
        addError(result, {
          code: VALIDATION_CODES.MERGE_INSUFFICIENT_INPUTS,
          message: `Nodo Merge "${node.label}" debe tener al menos 2 entradas (tiene ${incoming.length}).`,
          severity: 'error',
          nodeId: node.id,
        });
      }
      break;
    }

    case 'loop': {
      // Regla 9: Loop debe tener maxIterations configurado.
      const maxIter = node.config.maxIterations as number | undefined;
      if (maxIter === undefined || typeof maxIter !== 'number' || maxIter <= 0) {
        addError(result, {
          code: VALIDATION_CODES.LOOP_MISSING_MAX_ITERATIONS,
          message: `Nodo Loop "${node.label}" debe tener maxIterations configurado (> 0).`,
          severity: 'warning',
          nodeId: node.id,
          path: 'config.maxIterations',
        });
      }
      break;
    }

    case 'http_request': {
      // Validar URL si no es expression pura.
      const url = node.config.url as string | undefined;
      if (validateExpr && url) {
        const exprCheck = validateExpression(url);
        if (!exprCheck.valid) {
          addError(result, {
            code: VALIDATION_CODES.INVALID_EXPRESSION,
            message: `HTTP Request URL expression inválida: ${exprCheck.error}`,
            severity: 'error',
            nodeId: node.id,
            path: 'config.url',
          });
        }
      }
      // Validar credential.
      const credId = node.config.credentialId as string | undefined;
      if (credId && opts.knownCredentialIds && !opts.knownCredentialIds.has(credId)) {
        addError(result, {
          code: VALIDATION_CODES.MISSING_CREDENTIAL,
          message: `HTTP Request "${node.label}" referencia credential "${credId}" que no existe.`,
          severity: 'error',
          nodeId: node.id,
          path: 'config.credentialId',
        });
      }
      break;
    }

    case 'filter':
    case 'switch': {
      // Validar expressions.
      if (validateExpr && node.type === 'filter') {
        const expr = node.config.expression as string | undefined;
        if (!expr) {
          addError(result, {
            code: VALIDATION_CODES.INVALID_EXPRESSION,
            message: `Filter "${node.label}" requiere expression.`,
            severity: 'error',
            nodeId: node.id,
            path: 'config.expression',
          });
        } else {
          const check = validateExpression(expr);
          if (!check.valid) {
            addError(result, {
              code: VALIDATION_CODES.INVALID_EXPRESSION,
              message: `Filter expression inválida: ${check.error}`,
              severity: 'error',
              nodeId: node.id,
              path: 'config.expression',
            });
          }
        }
      }
      if (validateExpr && node.type === 'switch') {
        const cases = (node.config.cases as Array<{ id: string; expression: string }>) ?? [];
        for (const c of cases) {
          const check = validateExpression(c.expression);
          if (!check.valid) {
            addError(result, {
              code: VALIDATION_CODES.INVALID_EXPRESSION,
              message: `Switch case "${c.id}" expression inválida: ${check.error}`,
              severity: 'error',
              nodeId: node.id,
              path: 'config.cases',
            });
          }
        }
      }
      break;
    }

    case 'set': {
      if (validateExpr) {
        const fields = (node.config.fields as Array<{ key: string; value: string }>) ?? [];
        for (const f of fields) {
          if (!f.value) continue;
          const check = validateExpression(f.value);
          if (!check.valid) {
            addError(result, {
              code: VALIDATION_CODES.INVALID_EXPRESSION,
              message: `Set field "${f.key}" expression inválida: ${check.error}`,
              severity: 'error',
              nodeId: node.id,
              path: 'config.fields',
            });
          }
        }
      }
      break;
    }

    case 'execute_workflow': {
      const hasId = Boolean(node.config.workflowId);
      const hasName = Boolean(node.config.workflowName);
      if (!hasId && !hasName) {
        addError(result, {
          code: VALIDATION_CODES.INVALID_NODE_CONFIG,
          message: `Execute Workflow "${node.label}" requiere workflowId o workflowName.`,
          severity: 'error',
          nodeId: node.id,
          path: 'config.workflowId',
        });
      }
      break;
    }
  }
}

/** Versión simplificada: devuelve true/false sin detalles. */
export function isValidWorkflow(wf: Workflow, opts?: ValidatorOptions): boolean {
  return validateWorkflow(wf, opts).valid;
}
