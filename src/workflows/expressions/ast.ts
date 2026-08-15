/**
 * FASE 5 — AST del expression engine.
 *
 * Define los nodos del árbol de sintaxis abstracta que produce el parser
 * y consume el evaluator.
 */

export type AstNode =
  | LiteralNode
  | IdentifierNode
  | MemberNode
  | IndexNode
  | CallNode
  | UnaryOpNode
  | BinaryOpNode
  | TernaryNode;

export interface LiteralNode {
  type: 'literal';
  value: string | number | boolean | null | undefined;
  valueType: 'string' | 'number' | 'boolean' | 'null' | 'undefined';
}

export interface IdentifierNode {
  type: 'identifier';
  name: string;
  /** Si true, es una variable especial que empieza con $ (json, node, items, etc.). */
  isSpecial: boolean;
}

export interface MemberNode {
  type: 'member';
  object: AstNode;
  property: string;
}

export interface IndexNode {
  type: 'index';
  object: AstNode;
  index: AstNode;
}

export interface CallNode {
  type: 'call';
  callee: AstNode;
  args: AstNode[];
}

export interface UnaryOpNode {
  type: 'unary';
  op: '!' | '-';
  operand: AstNode;
}

export interface BinaryOpNode {
  type: 'binary';
  op:
    | '+' | '-' | '*' | '/' | '%'
    | '==' | '!=' | '<' | '>' | '<=' | '>='
    | '&&' | '||';
  left: AstNode;
  right: AstNode;
}

export interface TernaryNode {
  type: 'ternary';
  condition: AstNode;
  consequent: AstNode;
  alternate: AstNode;
}

/** Helpers para construir AST en tests. */
export const ast = {
  literal: (value: string | number | boolean | null | undefined): LiteralNode => {
    if (value === null) return { type: 'literal', value: null, valueType: 'null' };
    if (value === undefined) return { type: 'literal', value: undefined, valueType: 'undefined' };
    if (typeof value === 'string') return { type: 'literal', value, valueType: 'string' };
    if (typeof value === 'number') return { type: 'literal', value, valueType: 'number' };
    return { type: 'literal', value, valueType: 'boolean' };
  },
  identifier: (name: string): IdentifierNode => ({
    type: 'identifier',
    name,
    isSpecial: name.startsWith('$'),
  }),
  member: (object: AstNode, property: string): MemberNode => ({
    type: 'member',
    object,
    property,
  }),
  index: (object: AstNode, index: AstNode): IndexNode => ({
    type: 'index',
    object,
    index,
  }),
  call: (callee: AstNode, args: AstNode[]): CallNode => ({
    type: 'call',
    callee,
    args,
  }),
  unary: (op: '!' | '-', operand: AstNode): UnaryOpNode => ({
    type: 'unary',
    op,
    operand,
  }),
  binary: (op: BinaryOpNode['op'], left: AstNode, right: AstNode): BinaryOpNode => ({
    type: 'binary',
    op,
    left,
    right,
  }),
  ternary: (condition: AstNode, consequent: AstNode, alternate: AstNode): TernaryNode => ({
    type: 'ternary',
    condition,
    consequent,
    alternate,
  }),
};
