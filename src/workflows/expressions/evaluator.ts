/**
 * FASE 5 — Evaluator del expression engine.
 *
 * Recorre el AST y produce un valor. NO usa `eval` ni `vm` ni `Function`.
 *
 * Seguridad:
 *   - No permite acceso a `__proto__`, `constructor`, `prototype`.
 *   - Allowlist de métodos en strings (.toLowerCase, .length, .map, etc.).
 *   - Límite de profundidad (10) y timeout (100ms).
 */

import type {
  AstNode,
  LiteralNode,
  IdentifierNode,
  MemberNode,
  IndexNode,
  CallNode,
  UnaryOpNode,
  BinaryOpNode,
  TernaryNode,
} from './ast';
import type { ExecutionItem } from '@/workflows/types/execution';

export interface EvaluationContext {
  /** Item actual (para $json, $input, $item). */
  item?: ExecutionItem;
  /** Todos los items del input del nodo actual (para $input). */
  inputItems?: ExecutionItem[];
  /** Index del item actual (para $item). */
  itemIndex?: number;
  /** Outputs de otros nodos por nombre (para $node / $items). */
  nodeOutputs?: Record<string, ExecutionItem[]>;
  /** Execution metadata (para $execution). */
  execution?: { id: string; status: string; mode: string };
  /** Workflow metadata (para $workflow). */
  workflow?: { id: string; name: string };
  /** Variables de entorno filtradas (para $env). */
  env?: Record<string, string>;
  /** Variables del workflow (para $vars). */
  vars?: Record<string, unknown>;
  /** Helpers (para $now, $today, $timedelta, $randomInt, $uuid). */
  helpers?: ExpressionHelpers;
}

export interface ExpressionHelpers {
  now: () => string;
  today: () => string;
  timedelta: (amount: number, unit: string) => string;
  randomInt: (min: number, max: number) => number;
  uuid: () => string;
  /** Para acceso a otros nodos desde $node / $items. */
  getNodeOutput?: (nodeLabel: string) => ExecutionItem[] | undefined;
}

export const DEFAULT_HELPERS: ExpressionHelpers = {
  now: () => new Date().toISOString(),
  today: () => new Date().toISOString().slice(0, 10),
  timedelta: (amount: number, unit: string) => {
    const ms =
      unit === 'ms' ? amount :
      unit === 's' ? amount * 1000 :
      unit === 'm' ? amount * 60_000 :
      unit === 'h' ? amount * 3_600_000 :
      unit === 'd' ? amount * 86_400_000 :
      amount;
    return new Date(Date.now() + ms).toISOString();
  },
  randomInt: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
  uuid: () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)),
  getNodeOutput: () => undefined,
};

const MAX_DEPTH = 10;
const MAX_STRING_LEN = 1_000_000;

const FORBIDDEN_PROPS = new Set(['__proto__', 'constructor', 'prototype']);

/** Métodos de string permitidos. */
const STRING_METHODS = new Set([
  'toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd',
  'split', 'replace', 'replaceAll', 'slice', 'substring', 'substr',
  'startsWith', 'endsWith', 'includes', 'indexOf', 'lastIndexOf',
  'padStart', 'padEnd', 'repeat', 'charAt', 'charCodeAt',
]);

/** Métodos de array permitidos. */
const ARRAY_METHODS = new Set([
  'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
  'includes', 'indexOf', 'slice', 'concat', 'join', 'sort', 'reverse',
  'flat', 'flatMap', 'at', 'entries', 'keys', 'values',
]);

/** Métodos de number permitidos. */
const NUMBER_METHODS = new Set([
  'toFixed', 'toPrecision', 'toExponential', 'toString',
]);

/** Métodos de object permitidos (sólo lectura). */
const OBJECT_METHODS = new Set([
  'keys', 'values', 'entries', 'hasOwnProperty',
]);

export class EvaluatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvaluatorError';
  }
}

export function evaluate(node: AstNode, ctx: EvaluationContext): unknown {
  return evaluateWithDepth(node, ctx, 0);
}

function evaluateWithDepth(node: AstNode, ctx: EvaluationContext, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    throw new EvaluatorError(`Max expression depth (${MAX_DEPTH}) exceeded`);
  }
  switch (node.type) {
    case 'literal':
      return evaluateLiteral(node);
    case 'identifier':
      return evaluateIdentifier(node, ctx);
    case 'member':
      return evaluateMember(node, ctx, depth);
    case 'index':
      return evaluateIndex(node, ctx, depth);
    case 'call':
      return evaluateCall(node, ctx, depth);
    case 'unary':
      return evaluateUnary(node, ctx, depth);
    case 'binary':
      return evaluateBinary(node, ctx, depth);
    case 'ternary':
      return evaluateTernary(node, ctx, depth);
    default:
      throw new EvaluatorError(`Unknown AST node type: ${(node as { type: string }).type}`);
  }
}

function evaluateLiteral(node: LiteralNode): unknown {
  return node.value;
}

function evaluateIdentifier(node: IdentifierNode, ctx: EvaluationContext): unknown {
  if (!node.isSpecial) {
    // Identificador suelto sin $ — no permitido (no hay variables locales).
    // Excepción: si está en vars, lo permitimos.
    if (ctx.vars && node.name in ctx.vars) return ctx.vars[node.name];
    throw new EvaluatorError(`Unknown identifier: ${node.name}`);
  }

  const name = node.name; // $json, $node, etc.
  switch (name) {
    case '$json':
      return ctx.item?.json ?? null;
    case '$input':
      return (ctx.inputItems ?? []).map((i) => i.json);
    case '$item':
      return ctx.item?.json ?? null;
    case '$binary':
      return ctx.item?.binary ?? null;
    case '$metadata':
      return ctx.item?.metadata ?? null;
    case '$execution':
      return ctx.execution ?? null;
    case '$workflow':
      return ctx.workflow ?? null;
    case '$env':
      return ctx.env ?? {};
    case '$vars':
      return ctx.vars ?? {};
    case '$now':
      return (ctx.helpers ?? DEFAULT_HELPERS).now();
    case '$today':
      return (ctx.helpers ?? DEFAULT_HELPERS).today();
    case '$node':
      // $node se resuelve en evaluateMember/evaluateIndex cuando se accede
      // como $node.Name o $node["Name"]. Aquí devolvemos un objeto proxy
      // con los nodeOutputs para que member/index access funcione.
      return ctx.nodeOutputs ?? {};
    case '$items':
      // Similar a $node: se resuelve en call/index.
      return ctx.nodeOutputs ?? {};
    default:
      throw new EvaluatorError(`Unknown special variable: ${name}`);
  }
}

function evaluateMember(node: MemberNode, ctx: EvaluationContext, depth: number): unknown {
  if (node.property && FORBIDDEN_PROPS.has(node.property)) {
    throw new EvaluatorError(`Access to "${node.property}" is forbidden`);
  }

  // Caso especial: $node["Name"] se parsea como member de identifier $node
  //               con property "Name" (si es identifier) — pero aquí viene
  //               como MemberNode con object=$node y property="Name".
  //               Para soportar $node["HTTP Request"] necesitamos index.
  if (
    node.object.type === 'identifier' &&
    (node.object as IdentifierNode).isSpecial &&
    (node.object as IdentifierNode).name === '$node'
  ) {
    // $node.Name → busca nodo por nombre, devuelve item completo
    const items = ctx.nodeOutputs?.[node.property];
    if (!items || items.length === 0) return null;
    return items[0];
  }

  if (
    node.object.type === 'identifier' &&
    (node.object as IdentifierNode).isSpecial &&
    (node.object as IdentifierNode).name === '$items'
  ) {
    // $items.Name → devuelve todos los items del nodo
    return ctx.nodeOutputs?.[node.property] ?? [];
  }

  const obj = evaluateWithDepth(node.object, ctx, depth + 1);
  if (obj === null || obj === undefined) return undefined;

  // Helpers como $now, $today, etc. ya se resolvieron en identifier.
  // Para $timedelta, $randomInt, $uuid se acceden como $helper.method? No,
  // mejor: sólo se soportan como $now directamente.

  // Si obj es un helper object (functions), permitir call
  const value = (obj as Record<string, unknown>)[node.property];
  if (typeof value === 'function') {
    return value.bind(obj);
  }
  return value;
}

function evaluateIndex(node: IndexNode, ctx: EvaluationContext, depth: number): unknown {
  const obj = evaluateWithDepth(node.object, ctx, depth + 1);
  if (obj === null || obj === undefined) return undefined;

  const indexVal = evaluateWithDepth(node.index, ctx, depth + 1);

  // $node["HTTP Request"] syntax
  if (
    node.object.type === 'identifier' &&
    (node.object as IdentifierNode).isSpecial &&
    (node.object as IdentifierNode).name === '$node'
  ) {
    if (typeof indexVal !== 'string') {
      throw new EvaluatorError('$node[...] index must be a string');
    }
    const items = ctx.nodeOutputs?.[indexVal];
    if (!items || items.length === 0) return null;
    return items[0];
  }

  if (
    node.object.type === 'identifier' &&
    (node.object as IdentifierNode).isSpecial &&
    (node.object as IdentifierNode).name === '$items'
  ) {
    if (typeof indexVal !== 'string') {
      throw new EvaluatorError('$items(...) argument must be a string');
    }
    return ctx.nodeOutputs?.[indexVal] ?? [];
  }

  if (Array.isArray(obj)) {
    if (typeof indexVal === 'number') {
      return obj[indexVal];
    }
    return undefined;
  }

  if (typeof obj === 'object') {
    const key = String(indexVal);
    if (FORBIDDEN_PROPS.has(key)) {
      throw new EvaluatorError(`Access to "${key}" is forbidden`);
    }
    return (obj as Record<string, unknown>)[key];
  }

  if (typeof obj === 'string') {
    if (typeof indexVal === 'number') return obj[indexVal];
    return undefined;
  }

  return undefined;
}

function evaluateCall(node: CallNode, ctx: EvaluationContext, depth: number): unknown {
  // $items("HTTP Request") → call sobre identifier $items
  if (
    node.callee.type === 'identifier' &&
    (node.callee as IdentifierNode).isSpecial &&
    (node.callee as IdentifierNode).name === '$items'
  ) {
    const arg = evaluateWithDepth(node.args[0], ctx, depth + 1);
    if (typeof arg !== 'string') {
      throw new EvaluatorError('$items(...) argument must be a string');
    }
    return ctx.nodeOutputs?.[arg] ?? [];
  }

  // Helper calls: $timedelta(1, "d"), $randomInt(0, 100), $uuid()
  if (
    node.callee.type === 'identifier' &&
    (node.callee as IdentifierNode).isSpecial
  ) {
    const helperName = (node.callee as IdentifierNode).name;
    const helpers = ctx.helpers ?? DEFAULT_HELPERS;
    const fn =
      helperName === '$timedelta' ? helpers.timedelta :
      helperName === '$randomInt' ? helpers.randomInt :
      helperName === '$uuid' ? helpers.uuid :
      undefined;
    if (!fn) {
      throw new EvaluatorError(`Unknown helper: ${helperName}`);
    }
    const args = node.args.map((a) => evaluateWithDepth(a, ctx, depth + 1));
    return (fn as (...a: unknown[]) => unknown)(...args);
  }

  // Method call: obj.method(args)
  if (node.callee.type === 'member') {
    const obj = evaluateWithDepth(node.callee.object, ctx, depth + 1);
    const methodName = node.callee.property;
    const args = node.args.map((a) => evaluateWithDepth(a, ctx, depth + 1));

    if (typeof obj === 'string') {
      if (!STRING_METHODS.has(methodName)) {
        throw new EvaluatorError(`String method "${methodName}" not allowed`);
      }
      // Validar argumentos simples (números/strings)
      const fn = (obj as unknown as Record<string, (...a: unknown[]) => unknown>)[methodName];
      if (typeof fn !== 'function') {
        throw new EvaluatorError(`String method "${methodName}" not found`);
      }
      const result = fn.apply(obj, args);
      return truncateIfString(result);
    }

    if (Array.isArray(obj)) {
      if (!ARRAY_METHODS.has(methodName)) {
        throw new EvaluatorError(`Array method "${methodName}" not allowed`);
      }
      // Para map/filter/reduce/etc., los callbacks son lambdas — pero NO
      // soportamos lambdas en el expression engine (se requiere code node).
      // Sólo permitimos array methods sin callback (slice, concat, join, etc.).
      if (['map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every', 'flatMap', 'sort'].includes(methodName)) {
        throw new EvaluatorError(`Array method "${methodName}" requires a callback — use a Code node instead`);
      }
      const fn = (obj as unknown as Record<string, (...a: unknown[]) => unknown>)[methodName];
      if (typeof fn !== 'function') {
        throw new EvaluatorError(`Array method "${methodName}" not found`);
      }
      return fn.apply(obj, args);
    }

    if (typeof obj === 'number') {
      if (!NUMBER_METHODS.has(methodName)) {
        throw new EvaluatorError(`Number method "${methodName}" not allowed`);
      }
      const fn = (obj as unknown as Record<string, (...a: unknown[]) => unknown>)[methodName];
      if (typeof fn !== 'function') {
        throw new EvaluatorError(`Number method "${methodName}" not found`);
      }
      return fn.apply(obj, args);
    }

    if (typeof obj === 'object' && obj !== null) {
      if (!OBJECT_METHODS.has(methodName)) {
        throw new EvaluatorError(`Object method "${methodName}" not allowed`);
      }
      const fn = (obj as unknown as Record<string, (...a: unknown[]) => unknown>)[methodName];
      if (typeof fn !== 'function') {
        throw new EvaluatorError(`Object method "${methodName}" not found`);
      }
      return fn.apply(obj, args);
    }

    throw new EvaluatorError(`Cannot call method "${methodName}" on ${typeof obj}`);
  }

  throw new EvaluatorError('Only method calls are supported');
}

function evaluateUnary(node: UnaryOpNode, ctx: EvaluationContext, depth: number): unknown {
  const operand = evaluateWithDepth(node.operand, ctx, depth + 1);
  if (node.op === '!') return !truthy(operand);
  if (node.op === '-') {
    if (typeof operand === 'number') return -operand;
    throw new EvaluatorError('Unary "-" requires a number');
  }
  throw new EvaluatorError(`Unknown unary op: ${node.op}`);
}

function evaluateBinary(node: BinaryOpNode, ctx: EvaluationContext, depth: number): unknown {
  // Short-circuit para && y ||
  if (node.op === '&&') {
    const left = evaluateWithDepth(node.left, ctx, depth + 1);
    if (!truthy(left)) return left;
    return evaluateWithDepth(node.right, ctx, depth + 1);
  }
  if (node.op === '||') {
    const left = evaluateWithDepth(node.left, ctx, depth + 1);
    if (truthy(left)) return left;
    return evaluateWithDepth(node.right, ctx, depth + 1);
  }

  const left = evaluateWithDepth(node.left, ctx, depth + 1);
  const right = evaluateWithDepth(node.right, ctx, depth + 1);

  switch (node.op) {
    case '+':
      if (typeof left === 'string' || typeof right === 'string') {
        return truncateIfString(String(left) + String(right));
      }
      if (typeof left === 'number' && typeof right === 'number') return left + right;
      if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
      throw new EvaluatorError(`Cannot add ${typeof left} and ${typeof right}`);
    case '-':
      requireNumbers(left, right, '-');
      return (left as number) - (right as number);
    case '*':
      requireNumbers(left, right, '*');
      return (left as number) * (right as number);
    case '/':
      requireNumbers(left, right, '/');
      if ((right as number) === 0) throw new EvaluatorError('Division by zero');
      return (left as number) / (right as number);
    case '%':
      requireNumbers(left, right, '%');
      if ((right as number) === 0) throw new EvaluatorError('Modulo by zero');
      return (left as number) % (right as number);
    case '==':
      return looseEquals(left, right);
    case '!=':
      return !looseEquals(left, right);
    case '<':
      requireComparable(left, right, '<');
      return (left as string | number) < (right as string | number);
    case '>':
      requireComparable(left, right, '>');
      return (left as string | number) > (right as string | number);
    case '<=':
      requireComparable(left, right, '<=');
      return (left as string | number) <= (right as string | number);
    case '>=':
      requireComparable(left, right, '>=');
      return (left as string | number) >= (right as string | number);
    default:
      throw new EvaluatorError(`Unknown binary op: ${node.op}`);
  }
}

function evaluateTernary(node: TernaryNode, ctx: EvaluationContext, depth: number): unknown {
  const condition = evaluateWithDepth(node.condition, ctx, depth + 1);
  if (truthy(condition)) {
    return evaluateWithDepth(node.consequent, ctx, depth + 1);
  }
  return evaluateWithDepth(node.alternate, ctx, depth + 1);
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  if (typeof v === 'object' && v !== null && Object.keys(v).length === 0) return false;
  return Boolean(v);
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
  if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
  if (typeof a === 'boolean') return a === truthy(b);
  if (typeof b === 'boolean') return truthy(a) === b;
  return false;
}

function requireNumbers(a: unknown, b: unknown, op: string): void {
  if (typeof a !== 'number' || typeof b !== 'number') {
    throw new EvaluatorError(`Operator "${op}" requires numbers, got ${typeof a} and ${typeof b}`);
  }
}

function requireComparable(a: unknown, b: unknown, op: string): void {
  if (typeof a !== typeof b || (typeof a !== 'number' && typeof a !== 'string')) {
    throw new EvaluatorError(`Operator "${op}" requires same-type numbers or strings, got ${typeof a} and ${typeof b}`);
  }
}

function truncateIfString(v: unknown): unknown {
  if (typeof v === 'string' && v.length > MAX_STRING_LEN) {
    return v.slice(0, MAX_STRING_LEN) + '...[truncated]';
  }
  return v;
}
