// Pratt (precedence-climbing) parser — mirrors tech-design §5.
//
//   expr        := binary(0)
//   binary(min) := unary { (op,bp) while bp >= min: op unary → fold }
//   unary       := '-' unary | primary
//   primary     := NUMBER | STRING | ADDRESS | IDENT '(' args ')' | '(' expr ')'
//   args        := ε | expr (',' expr)*
//
// Binding powers: `+ -` = 10, `* /` = 20, unary `-` = 30. `^` is intentionally not
// in v1. A bare identifier without `(`, a stray token, or a malformed address (which
// the lexer already rejects) is a parse error → surfaced as #NAME? by the caller.

import { lex, LexError, type Token } from './lex';
import type { Axis, Expr } from './types';

export class ParseError extends Error {}

const BP: Record<string, number> = { '+': 10, '-': 10, '*': 20, '/': 20 };

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos]!;
  }
  private next(): Token {
    return this.tokens[this.pos++]!;
  }

  parse(): Expr {
    const expr = this.binary(0);
    if (this.peek().t !== 'eof') throw new ParseError('unexpected trailing input');
    return expr;
  }

  private binary(minBp: number): Expr {
    let left = this.unary();
    for (;;) {
      const tok = this.peek();
      if (tok.t !== 'op') break;
      const bp = BP[tok.op]!;
      if (bp < minBp) break;
      this.next();
      const right = this.binary(bp + 1); // left-associative
      left = { kind: 'binary', op: tok.op, l: left, r: right };
    }
    return left;
  }

  private unary(): Expr {
    const tok = this.peek();
    if (tok.t === 'op' && tok.op === '-') {
      this.next();
      return { kind: 'unary', op: '-', arg: this.unary() };
    }
    return this.primary();
  }

  private primary(): Expr {
    const tok = this.next();
    switch (tok.t) {
      case 'num':
        return { kind: 'num', n: tok.n };
      case 'str':
        return { kind: 'str', s: tok.s };
      case 'ref':
        return tok.ref.kind === 'cell'
          ? { kind: 'ref', ref: tok.ref }
          : { kind: 'rangeRef', ref: tok.ref };
      case 'ident': {
        if (this.peek().t !== 'lparen') {
          throw new ParseError(`"${tok.name}" is not a function call (missing "(")`);
        }
        this.next(); // '('
        const args = this.args();
        if (this.next().t !== 'rparen') throw new ParseError('expected ")"');
        return { kind: 'call', fn: tok.name, args };
      }
      case 'lparen': {
        const expr = this.binary(0);
        if (this.next().t !== 'rparen') throw new ParseError('expected ")"');
        return expr;
      }
      default:
        throw new ParseError(`unexpected token "${tok.t}"`);
    }
  }

  private args(): Expr[] {
    if (this.peek().t === 'rparen') return [];
    const list = [this.binary(0)];
    while (this.peek().t === 'comma') {
      this.next();
      list.push(this.binary(0));
    }
    return list;
  }
}

/**
 * Parse a formula body (the text after the leading `=`) into an AST. References are
 * left partial (only the axes named in the text); the caller completes them against
 * the authoring context (§6). Throws {@link ParseError} on any malformed input.
 */
export function parseFormula(body: string, axes: Axis[]): Expr {
  let tokens: Token[];
  try {
    tokens = lex(body, axes);
  } catch (e) {
    if (e instanceof LexError) throw new ParseError(e.message);
    throw e;
  }
  return new Parser(tokens).parse();
}
