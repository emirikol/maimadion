// Lexer — mirrors tech-design §5. A formula is the text after a leading `=`. The
// load-bearing detail is the address token: the lexer recognizes an address by a
// leading `$` or a `<lowercase-letter><digit>` run and scans the whole
// `[$]?<letter><digits>(...)` sequence — including an embedded `:` and the §4 colon
// disambiguation — in one go, emitting a structured CellRef/RangeRef. The parser
// (parse.ts) therefore never sees a raw `:`. Uppercase identifiers are function
// names (e.g. SUM); lowercase letters begin an address only when a digit or `:`
// follows, otherwise they too are an identifier (a bare name → #NAME? in the parser).

import { AddressError, parseAddress } from './coord';
import type { Axis, CellRef, RangeRef } from './types';

export class LexError extends Error {}

export type Token =
  | { t: 'num'; n: number }
  | { t: 'str'; s: string }
  | { t: 'op'; op: '+' | '-' | '*' | '/' }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'comma' }
  | { t: 'ident'; name: string }
  | { t: 'ref'; ref: CellRef | RangeRef }
  | { t: 'eof' };

const isDigit = (c: string) => c >= '0' && c <= '9';
const isLower = (c: string) => c >= 'a' && c <= 'z';
const isLetter = (c: string) => isLower(c) || (c >= 'A' && c <= 'Z');
const isAddressChar = (c: string) => c === '$' || c === ':' || isLower(c) || isDigit(c);

export function lex(src: string, axes: Axis[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i]!;

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ t: 'op', op: c });
      i++;
      continue;
    }
    if (c === '(') {
      tokens.push({ t: 'lparen' });
      i++;
      continue;
    }
    if (c === ')') {
      tokens.push({ t: 'rparen' });
      i++;
      continue;
    }
    if (c === ',') {
      tokens.push({ t: 'comma' });
      i++;
      continue;
    }

    if (c === '"') {
      let s = '';
      i++; // opening quote
      while (i < src.length && src[i] !== '"') s += src[i++];
      if (i >= src.length) throw new LexError(`unterminated string in "${src}"`);
      i++; // closing quote
      tokens.push({ t: 'str', s });
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      const start = i;
      while (i < src.length && isDigit(src[i]!)) i++;
      if (src[i] === '.') {
        i++;
        while (i < src.length && isDigit(src[i]!)) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        while (i < src.length && isDigit(src[i]!)) i++;
      }
      tokens.push({ t: 'num', n: Number(src.slice(start, i)) });
      continue;
    }

    // A `$` always begins an address; a lowercase letter begins one only when a
    // digit or `:` follows the letter run (otherwise it's an identifier).
    let isAddress = c === '$';
    if (!isAddress && isLower(c)) {
      let j = i;
      while (j < src.length && isLower(src[j]!)) j++;
      const after = src[j] ?? '';
      isAddress = isDigit(after) || after === ':';
    }
    if (isAddress) {
      const start = i;
      while (i < src.length && isAddressChar(src[i]!)) i++;
      try {
        tokens.push({ t: 'ref', ref: parseAddress(src.slice(start, i), axes) });
      } catch (e) {
        if (e instanceof AddressError) throw new LexError(e.message);
        throw e;
      }
      continue;
    }

    if (isLetter(c)) {
      const start = i;
      while (i < src.length && isLetter(src[i]!)) i++;
      tokens.push({ t: 'ident', name: src.slice(start, i) });
      continue;
    }

    throw new LexError(`unexpected character ${JSON.stringify(c)} in "${src}"`);
  }

  tokens.push({ t: 'eof' });
  return tokens;
}
