/**
 * FASE 5 — Lexer del expression engine.
 *
 * Tokeniza expresiones tipo n8n:
 *   {{$json.user.email}}
 *   {{$json.price * 1.16}}
 *   {{$json.email.toLowerCase()}}
 *   {{$node["HTTP Request"].json}}
 *   {{$items("HTTP Request").length}}
 *   {{$execution.id}}
 *   {{$now}}
 *   {{$json.vip ? "premium" : "standard"}}
 *
 * Las expresiones van delimitadas por {{ ... }}. El lexer opera sobre
 * el contenido INTERNO (sin las llaves), que le pasa el parser.
 */

export enum TokenType {
  Identifier,      // foo, $json, $node
  Number,          // 1, 1.5, 100
  String,          // "hello", 'world'
  Dot,             // .
  Comma,           // ,
  Colon,           // :
  Question,        // ?
  LParen,          // (
  RParen,          // )
  LBracket,        // [
  RBracket,        // ]
  LBrace,          // {
  RBrace,          // }
  OpPlus,
  OpMinus,
  OpMul,
  OpDiv,
  OpMod,
  OpEq,            // ==
  OpNeq,           // !=
  OpLt,            // <
  OpGt,            // >
  OpLte,           // <=
  OpGte,           // >=
  OpAnd,           // &&  (también "and" como keyword)
  OpOr,            // ||  (también "or" como keyword)
  OpNot,           // !   (también "not" como keyword)
  OpTrue,
  OpFalse,
  OpNull,
  OpUndefined,
  EOF,
}

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
  line: number;
  col: number;
}

const KEYWORDS: Record<string, TokenType> = {
  and: TokenType.OpAnd,
  or: TokenType.OpOr,
  not: TokenType.OpNot,
  true: TokenType.OpTrue,
  false: TokenType.OpFalse,
  null: TokenType.OpNull,
  undefined: TokenType.OpUndefined,
};

export class LexerError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(`Lexer error at pos ${pos}: ${message}`);
    this.pos = pos;
    this.name = 'LexerError';
  }
}

export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function peek(offset = 0): string {
    return input[pos + offset] ?? '';
  }

  function advance(): string {
    const c = input[pos++];
    if (c === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
    return c;
  }

  function pushToken(type: TokenType, value: string): void {
    tokens.push({ type, value, pos: pos - value.length, line, col });
  }

  while (pos < input.length) {
    const c = input[pos];

    // Skip whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      advance();
      continue;
    }

    // Identifiers (incluye $json, $node, etc.)
    if (isIdentStart(c)) {
      let start = pos;
      let ident = '';
      while (pos < input.length && isIdentPart(input[pos])) {
        ident += advance();
      }
      // Special: $json, $node, $items, $input, $item, $execution, $workflow, $env, $vars, $now, $today
      // (los identificadores con $ son válidos)
      const kw = KEYWORDS[ident.toLowerCase()];
      if (kw !== undefined && !ident.startsWith('$')) {
        pushToken(kw, ident);
      } else {
        pushToken(TokenType.Identifier, ident);
      }
      continue;
    }

    // Numbers
    if (isDigit(c)) {
      let num = '';
      while (pos < input.length && (isDigit(input[pos]) || input[pos] === '.')) {
        num += advance();
      }
      pushToken(TokenType.Number, num);
      continue;
    }

    // Strings (double or single quoted)
    if (c === '"' || c === "'") {
      const quote = advance();
      let str = '';
      while (pos < input.length && input[pos] !== quote) {
        if (input[pos] === '\\') {
          advance();
          const next = advance();
          str += unescapeChar(next);
        } else {
          str += advance();
        }
      }
      if (pos >= input.length) {
        throw new LexerError(`Unterminated string starting at ${pos - str.length - 1}`, pos);
      }
      advance(); // closing quote
      pushToken(TokenType.String, str);
      continue;
    }

    // Two-char operators
    const two = c + peek(1);
    if (two === '==') { advance(); advance(); pushToken(TokenType.OpEq, '=='); continue; }
    if (two === '!=') { advance(); advance(); pushToken(TokenType.OpNeq, '!='); continue; }
    if (two === '<=') { advance(); advance(); pushToken(TokenType.OpLte, '<='); continue; }
    if (two === '>=') { advance(); advance(); pushToken(TokenType.OpGte, '>='); continue; }
    if (two === '&&') { advance(); advance(); pushToken(TokenType.OpAnd, '&&'); continue; }
    if (two === '||') { advance(); advance(); pushToken(TokenType.OpOr, '||'); continue; }

    // Single-char tokens
    switch (c) {
      case '.': pushToken(TokenType.Dot, advance()); continue;
      case ',': pushToken(TokenType.Comma, advance()); continue;
      case ':': pushToken(TokenType.Colon, advance()); continue;
      case '?': pushToken(TokenType.Question, advance()); continue;
      case '(': pushToken(TokenType.LParen, advance()); continue;
      case ')': pushToken(TokenType.RParen, advance()); continue;
      case '[': pushToken(TokenType.LBracket, advance()); continue;
      case ']': pushToken(TokenType.RBracket, advance()); continue;
      case '{': pushToken(TokenType.LBrace, advance()); continue;
      case '}': pushToken(TokenType.RBrace, advance()); continue;
      case '+': pushToken(TokenType.OpPlus, advance()); continue;
      case '-': pushToken(TokenType.OpMinus, advance()); continue;
      case '*': pushToken(TokenType.OpMul, advance()); continue;
      case '/': pushToken(TokenType.OpDiv, advance()); continue;
      case '%': pushToken(TokenType.OpMod, advance()); continue;
      case '<': pushToken(TokenType.OpLt, advance()); continue;
      case '>': pushToken(TokenType.OpGt, advance()); continue;
      case '!': pushToken(TokenType.OpNot, advance()); continue;
      default:
        throw new LexerError(`Unexpected character: "${c}"`, pos);
    }
  }

  tokens.push({ type: TokenType.EOF, value: '', pos, line, col });
  return tokens;
}

function isIdentStart(c: string): boolean {
  return /[a-zA-Z_$]/.test(c);
}

function isIdentPart(c: string): boolean {
  return /[a-zA-Z0-9_$]/.test(c);
}

function isDigit(c: string): boolean {
  return /[0-9]/.test(c);
}

function unescapeChar(c: string): string {
  switch (c) {
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case '\\': return '\\';
    case '"': return '"';
    case "'": return "'";
    case '0': return '\0';
    default: return c;
  }
}
