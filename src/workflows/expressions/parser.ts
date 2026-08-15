/**
 * FASE 5 — Parser del expression engine (recursive descent).
 *
 * Gramática (simplificada):
 *
 *   expression  := ternary
 *   ternary     := logical_or ( '?' expression ':' expression )?
 *   logical_or  := logical_and ( ('||' | 'or') logical_and )*
 *   logical_and := equality ( ('&&' | 'and') equality )*
 *   equality    := comparison ( ('==' | '!=') comparison )*
 *   comparison  := additive ( ('<' | '>' | '<=' | '>=') additive )*
 *   additive    := multiplicative ( ('+' | '-') multiplicative )*
 *   multiplicative := unary ( ('*' | '/' | '%') unary )*
 *   unary       := ('!' | '-' | 'not') unary | postfix
 *   postfix     := primary ( member | index | call )*
 *   primary     := literal | identifier | '(' expression ')'
 *
 * No se soporta assignment (=). Las expressions son puramente de lectura.
 */

import { lex, TokenType, type Token } from './lexer';
import type {
  AstNode,
  LiteralNode,
  IdentifierNode,
  MemberNode,
  IndexNode,
  CallNode,
} from './ast';

export class ParserError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(`Parser error at pos ${pos}: ${message}`);
    this.pos = pos;
    this.name = 'ParserError';
  }
}

export function parse(input: string): AstNode {
  const tokens = lex(input);
  const parser = new Parser(tokens);
  const result = parser.parseExpression();
  if (parser.peek().type !== TokenType.EOF) {
    throw new ParserError(`Unexpected token "${parser.peek().value}" after expression`, parser.peek().pos);
  }
  return result;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? this.tokens[this.tokens.length - 1];
  }

  consume(): Token {
    const t = this.tokens[this.pos];
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  expect(type: TokenType, what?: string): Token {
    const t = this.peek();
    if (t.type !== type) {
      throw new ParserError(`Expected ${what ?? TokenType[type]} but got "${t.value}"`, t.pos);
    }
    return this.consume();
  }

  parseExpression(): AstNode {
    return this.parseTernary();
  }

  private parseTernary(): AstNode {
    const condition = this.parseLogicalOr();
    if (this.peek().type === TokenType.Question) {
      this.consume();
      const consequent = this.parseExpression();
      this.expect(TokenType.Colon, '":"');
      const alternate = this.parseExpression();
      return { type: 'ternary', condition, consequent, alternate };
    }
    return condition;
  }

  private parseLogicalOr(): AstNode {
    let left = this.parseLogicalAnd();
    while (this.peek().type === TokenType.OpOr) {
      this.consume();
      const right = this.parseLogicalAnd();
      left = { type: 'binary', op: '||', left, right };
    }
    return left;
  }

  private parseLogicalAnd(): AstNode {
    let left = this.parseEquality();
    while (this.peek().type === TokenType.OpAnd) {
      this.consume();
      const right = this.parseEquality();
      left = { type: 'binary', op: '&&', left, right };
    }
    return left;
  }

  private parseEquality(): AstNode {
    let left = this.parseComparison();
    while (this.peek().type === TokenType.OpEq || this.peek().type === TokenType.OpNeq) {
      const op = this.consume().type === TokenType.OpEq ? '==' : '!=';
      const right = this.parseComparison();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseComparison(): AstNode {
    let left = this.parseAdditive();
    while (
      this.peek().type === TokenType.OpLt ||
      this.peek().type === TokenType.OpGt ||
      this.peek().type === TokenType.OpLte ||
      this.peek().type === TokenType.OpGte
    ) {
      const t = this.consume();
      const op =
        t.type === TokenType.OpLt ? '<' :
        t.type === TokenType.OpGt ? '>' :
        t.type === TokenType.OpLte ? '<=' : '>=';
      const right = this.parseAdditive();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();
    while (this.peek().type === TokenType.OpPlus || this.peek().type === TokenType.OpMinus) {
      const op = this.consume().type === TokenType.OpPlus ? '+' : '-';
      const right = this.parseMultiplicative();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseUnary();
    while (
      this.peek().type === TokenType.OpMul ||
      this.peek().type === TokenType.OpDiv ||
      this.peek().type === TokenType.OpMod
    ) {
      const t = this.consume();
      const op = t.type === TokenType.OpMul ? '*' : t.type === TokenType.OpDiv ? '/' : '%';
      const right = this.parseUnary();
      left = { type: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): AstNode {
    const t = this.peek();
    if (t.type === TokenType.OpNot) {
      this.consume();
      return { type: 'unary', op: '!', operand: this.parseUnary() };
    }
    if (t.type === TokenType.OpMinus) {
      this.consume();
      return { type: 'unary', op: '-', operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): AstNode {
    let node = this.parsePrimary();
    while (true) {
      const t = this.peek();
      if (t.type === TokenType.Dot) {
        this.consume();
        const propTok = this.expect(TokenType.Identifier, 'identifier');
        node = { type: 'member', object: node, property: propTok.value } as MemberNode;
      } else if (t.type === TokenType.LBracket) {
        this.consume();
        const index = this.parseExpression();
        this.expect(TokenType.RBracket, '"]"');
        node = { type: 'index', object: node, index } as IndexNode;
      } else if (t.type === TokenType.LParen) {
        this.consume();
        const args: AstNode[] = [];
        if (this.peek().type !== TokenType.RParen) {
          args.push(this.parseExpression());
          while (this.peek().type === TokenType.Comma) {
            this.consume();
            args.push(this.parseExpression());
          }
        }
        this.expect(TokenType.RParen, '")"');
        node = { type: 'call', callee: node, args } as CallNode;
      } else {
        break;
      }
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const t = this.peek();
    switch (t.type) {
      case TokenType.Number: {
        this.consume();
        return { type: 'literal', value: parseFloat(t.value), valueType: 'number' } as LiteralNode;
      }
      case TokenType.String: {
        this.consume();
        return { type: 'literal', value: t.value, valueType: 'string' } as LiteralNode;
      }
      case TokenType.OpTrue:
        this.consume();
        return { type: 'literal', value: true, valueType: 'boolean' } as LiteralNode;
      case TokenType.OpFalse:
        this.consume();
        return { type: 'literal', value: false, valueType: 'boolean' } as LiteralNode;
      case TokenType.OpNull:
        this.consume();
        return { type: 'literal', value: null, valueType: 'null' } as LiteralNode;
      case TokenType.OpUndefined:
        this.consume();
        return { type: 'literal', value: undefined, valueType: 'undefined' } as LiteralNode;
      case TokenType.Identifier:
        this.consume();
        return { type: 'identifier', name: t.value, isSpecial: t.value.startsWith('$') } as IdentifierNode;
      case TokenType.LParen: {
        this.consume();
        const expr = this.parseExpression();
        this.expect(TokenType.RParen, '")"');
        return expr;
      }
      default:
        throw new ParserError(`Unexpected token "${t.value}"`, t.pos);
    }
  }
}
