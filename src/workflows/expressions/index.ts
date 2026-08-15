/**
 * FASE 5 — Expression Engine API pública.
 *
 * Uso típico:
 *   const value = resolveExpression('{{$json.price * 1.16}}', ctx);
 *   const value = resolveExpression('{{$node["HTTP Request"].json.tier}}', ctx);
 *
 * Si la expresión no tiene {{ }}, se devuelve como string literal.
 * Si la expresión es solo {{ ... }} (sin texto alrededor), se devuelve
 * el valor evaluado (no como string).
 * Si la expresión mezcla texto y {{ }}, se interpolan los valores como
 * strings (igual que template literals de JS).
 */

import { parse } from './parser';
import { evaluate, type EvaluationContext } from './evaluator';

export { lex, type Token, TokenType, LexerError } from './lexer';
export { parse, ParserError } from './parser';
export type * from './ast';
export { evaluate, EvaluatorError, type EvaluationContext, type ExpressionHelpers, DEFAULT_HELPERS } from './evaluator';

const EXPR_PATTERN = /\{\{(.*?)\}\}/gs;

export interface ResolveOptions {
  /** Si true, lanza error en expression inválida. Si false, devuelve string vacío. */
  throwOnError?: boolean;
  /** Contexto de evaluación. */
  context: EvaluationContext;
}

/** Resuelve una expression completa (con o sin {{ }}). */
export function resolveExpression(template: string, opts: ResolveOptions): unknown {
  if (!template || typeof template !== 'string') return template;

  const matches = Array.from(template.matchAll(EXPR_PATTERN));
  if (matches.length === 0) return template;

  // Si la expresión es EXACTAMENTE {{ ... }} (sin texto alrededor),
  // devolvemos el valor evaluado tal cual.
  if (matches.length === 1 && matches[0][0] === template.trim() && template.trim() === matches[0][0]) {
    const expr = matches[0][1].trim();
    try {
      const ast = parse(expr);
      return evaluate(ast, opts.context);
    } catch (e) {
      if (opts.throwOnError) throw e;
      return '';
    }
  }

  // Si hay texto mezclado, interpolamos como strings.
  let result = '';
  let lastIndex = 0;
  for (const match of matches) {
    const m = match[0];
    const expr = match[1].trim();
    const idx = match.index ?? 0;
    result += template.slice(lastIndex, idx);
    try {
      const ast = parse(expr);
      const value = evaluate(ast, opts.context);
      result += value === null || value === undefined ? '' : String(value);
    } catch (e) {
      if (opts.throwOnError) throw e;
      result += '';
    }
    lastIndex = idx + m.length;
  }
  result += template.slice(lastIndex);
  return result;
}

/** Verifica si una expression es sintácticamente válida (sin evaluarla). */
export function validateExpression(expr: string): { valid: boolean; error?: string } {
  if (!expr) return { valid: true };
  try {
    // Si tiene {{ }}, validar el contenido.
    const matches = Array.from(expr.matchAll(EXPR_PATTERN));
    if (matches.length === 0) return { valid: true };
    for (const m of matches) {
      const inner = m[1].trim();
      if (inner) parse(inner);
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Detecta todas las expresiones en un string. Útil para UI (highlight). */
export function findExpressions(text: string): Array<{ start: number; end: number; expression: string }> {
  const results: Array<{ start: number; end: number; expression: string }> = [];
  for (const match of text.matchAll(EXPR_PATTERN)) {
    results.push({
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      expression: (match[1] ?? '').trim(),
    });
  }
  return results;
}
