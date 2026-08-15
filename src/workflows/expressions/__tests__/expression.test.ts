/**
 * FASE 5 — Tests del expression engine.
 */

import { describe, it, expect } from 'vitest';
import { lex, TokenType } from '../lexer';
import { parse } from '../parser';
import { evaluate, DEFAULT_HELPERS } from '../evaluator';
import { resolveExpression, validateExpression, findExpressions } from '../index';
import type { EvaluationContext } from '../evaluator';
import type { ExecutionItem } from '@/workflows/types/execution';

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    item: { json: { name: 'Alice', age: 30, vip: true, items: [1, 2, 3], tags: ['a', 'b'] } },
    inputItems: [{ json: { x: 1 } }, { json: { x: 2 } }],
    itemIndex: 0,
    nodeOutputs: {
      'HTTP Request': [{ json: { status: 200, tier: 'vip' } }],
    },
    execution: { id: 'exec-1', status: 'running', mode: 'manual' },
    workflow: { id: 'wf-1', name: 'Test' },
    env: { API_URL: 'https://api.example.com' },
    vars: { foo: 'bar' },
    helpers: DEFAULT_HELPERS,
    ...overrides,
  };
}

describe('Lexer', () => {
  it('tokenizes simple identifier', () => {
    const tokens = lex('$json');
    expect(tokens[0].type).toBe(TokenType.Identifier);
    expect(tokens[0].value).toBe('$json');
  });

  it('tokenizes member access', () => {
    const tokens = lex('$json.name');
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.Identifier, TokenType.Dot, TokenType.Identifier, TokenType.EOF,
    ]);
  });

  it('tokenizes string with brackets', () => {
    const tokens = lex('$node["HTTP Request"]');
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.Identifier,
      TokenType.LBracket, TokenType.String, TokenType.RBracket,
      TokenType.EOF,
    ]);
  });

  it('tokenizes arithmetic', () => {
    const tokens = lex('1 + 2 * 3');
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.Number, TokenType.OpPlus, TokenType.Number, TokenType.OpMul, TokenType.Number, TokenType.EOF,
    ]);
  });

  it('tokenizes comparison', () => {
    const tokens = lex('$json.age >= 18');
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.Identifier, TokenType.Dot, TokenType.Identifier,
      TokenType.OpGte, TokenType.Number, TokenType.EOF,
    ]);
  });

  it('tokenizes ternary', () => {
    const tokens = lex('$json.vip ? "premium" : "standard"');
    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.Identifier, TokenType.Dot, TokenType.Identifier,
      TokenType.Question, TokenType.String,
      TokenType.Colon, TokenType.String, TokenType.EOF,
    ]);
  });

  it('throws on invalid char', () => {
    expect(() => lex('@')).toThrow();
  });
});

describe('Parser', () => {
  it('parses literal', () => {
    const ast = parse('42');
    expect(ast).toEqual({ type: 'literal', value: 42, valueType: 'number' });
  });

  it('parses member access', () => {
    const ast = parse('$json.name');
    expect(ast.type).toBe('member');
  });

  it('parses index access', () => {
    const ast = parse('$node["HTTP Request"]');
    expect(ast.type).toBe('index');
  });

  it('parses binary op with precedence', () => {
    const ast = parse('1 + 2 * 3');
    expect(ast.type).toBe('binary');
    expect((ast as { op: string }).op).toBe('+');
  });

  it('parses ternary', () => {
    const ast = parse('$json.vip ? "premium" : "standard"');
    expect(ast.type).toBe('ternary');
  });

  it('parses call with args', () => {
    const ast = parse('$items("HTTP Request")');
    expect(ast.type).toBe('call');
  });

  it('throws on incomplete expression', () => {
    expect(() => parse('$json +')).toThrow();
  });
});

describe('Evaluator', () => {
  it('evaluates literal', () => {
    expect(evaluate(parse('42'), makeCtx())).toBe(42);
    expect(evaluate(parse('"hello"'), makeCtx())).toBe('hello');
    expect(evaluate(parse('true'), makeCtx())).toBe(true);
    expect(evaluate(parse('null'), makeCtx())).toBe(null);
  });

  it('evaluates $json', () => {
    expect(evaluate(parse('$json'), makeCtx())).toEqual({ name: 'Alice', age: 30, vip: true, items: [1, 2, 3], tags: ['a', 'b'] });
  });

  it('evaluates $json.name', () => {
    expect(evaluate(parse('$json.name'), makeCtx())).toBe('Alice');
  });

  it('evaluates $json.age (number)', () => {
    expect(evaluate(parse('$json.age'), makeCtx())).toBe(30);
  });

  it('evaluates arithmetic', () => {
    expect(evaluate(parse('1 + 2 * 3'), makeCtx())).toBe(7);
    expect(evaluate(parse('(1 + 2) * 3'), makeCtx())).toBe(9);
    expect(evaluate(parse('10 % 3'), makeCtx())).toBe(1);
  });

  it('evaluates string method', () => {
    expect(evaluate(parse('$json.name.toLowerCase()'), makeCtx())).toBe('alice');
    expect(evaluate(parse('$json.name.toUpperCase()'), makeCtx())).toBe('ALICE');
    expect(evaluate(parse('$json.name.length'), makeCtx())).toBe(5);
  });

  it('evaluates array length', () => {
    expect(evaluate(parse('$json.items.length'), makeCtx())).toBe(3);
  });

  it('evaluates ternary', () => {
    expect(evaluate(parse('$json.vip ? "premium" : "standard"'), makeCtx())).toBe('premium');
  });

  it('evaluates comparison', () => {
    expect(evaluate(parse('$json.age >= 18'), makeCtx())).toBe(true);
    expect(evaluate(parse('$json.age < 18'), makeCtx())).toBe(false);
    expect(evaluate(parse('$json.age == 30'), makeCtx())).toBe(true);
    expect(evaluate(parse('$json.name != "Bob"'), makeCtx())).toBe(true);
  });

  it('evaluates $node["HTTP Request"].json.tier', () => {
    expect(evaluate(parse('$node["HTTP Request"].json.tier'), makeCtx())).toBe('vip');
  });

  it('evaluates $items("HTTP Request")', () => {
    const result = evaluate(parse('$items("HTTP Request")'), makeCtx());
    expect(Array.isArray(result)).toBe(true);
    expect((result as ExecutionItem[]).length).toBe(1);
  });

  it('evaluates $env.API_URL', () => {
    expect(evaluate(parse('$env.API_URL'), makeCtx())).toBe('https://api.example.com');
  });

  it('evaluates $vars.foo', () => {
    expect(evaluate(parse('$vars.foo'), makeCtx())).toBe('bar');
  });

  it('evaluates $now (string ISO)', () => {
    const v = evaluate(parse('$now'), makeCtx());
    expect(typeof v).toBe('string');
    expect(() => new Date(v as string)).not.toThrow();
  });

  it('evaluates string concat', () => {
    expect(evaluate(parse('"Hello " + $json.name'), makeCtx())).toBe('Hello Alice');
  });

  it('throws on forbidden prop __proto__', () => {
    expect(() => evaluate(parse('$json.__proto__'), makeCtx())).toThrow();
  });

  it('throws on forbidden prop constructor', () => {
    expect(() => evaluate(parse('$json.constructor'), makeCtx())).toThrow();
  });

  it('throws on disallowed method', () => {
    expect(() => evaluate(parse('$json.name.eval()'), makeCtx())).toThrow();
  });

  it('throws on division by zero', () => {
    expect(() => evaluate(parse('1 / 0'), makeCtx())).toThrow();
  });

  it('throws on type mismatch', () => {
    expect(() => evaluate(parse('"hello" - 5'), makeCtx())).toThrow();
  });

  it('throws on unknown identifier', () => {
    expect(() => evaluate(parse('totally_unknown_var'), makeCtx())).toThrow();
  });

  it('handles null safely', () => {
    const ctx = makeCtx({ item: { json: { missing: null } } });
    expect(evaluate(parse('$json.missing'), ctx)).toBe(null);
    expect(evaluate(parse('$json.missing.field'), ctx)).toBe(undefined);
  });
});

describe('resolveExpression (template)', () => {
  it('passes through plain string', () => {
    expect(resolveExpression('hello world', { context: makeCtx() })).toBe('hello world');
  });

  it('interpolates single expression', () => {
    expect(resolveExpression('Hello {{$json.name}}!', { context: makeCtx() })).toBe('Hello Alice!');
  });

  it('returns native value when expression wraps entire string', () => {
    const v = resolveExpression('{{$json.age}}', { context: makeCtx() });
    expect(v).toBe(30);
    expect(typeof v).toBe('number');
  });

  it('interpolates multiple expressions', () => {
    expect(resolveExpression('{{$json.name}} has {{$json.age}} years', { context: makeCtx() }))
      .toBe('Alice has 30 years');
  });

  it('handles invalid expression gracefully', () => {
    expect(resolveExpression('Hello {{$json.}}!', { context: makeCtx(), throwOnError: false }))
      .toBe('Hello !');
  });

  it('throws on invalid expression when throwOnError', () => {
    expect(() => resolveExpression('{{$json.}}', { context: makeCtx(), throwOnError: true })).toThrow();
  });
});

describe('validateExpression', () => {
  it('returns valid for empty string', () => {
    expect(validateExpression('').valid).toBe(true);
  });

  it('returns valid for plain string', () => {
    expect(validateExpression('hello').valid).toBe(true);
  });

  it('returns valid for well-formed expression', () => {
    expect(validateExpression('{{$json.name}}').valid).toBe(true);
  });

  it('returns invalid for malformed expression', () => {
    const result = validateExpression('{{$json.}}');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('findExpressions', () => {
  it('finds all expressions in a string', () => {
    const exprs = findExpressions('Hello {{$json.name}}! Age: {{$json.age}}');
    expect(exprs.length).toBe(2);
    expect(exprs[0].expression).toBe('$json.name');
    expect(exprs[1].expression).toBe('$json.age');
  });

  it('returns empty array for plain string', () => {
    expect(findExpressions('hello')).toEqual([]);
  });
});
