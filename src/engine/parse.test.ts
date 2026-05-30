import { describe, expect, it } from 'vitest';
import { parseFormula, ParseError } from './parse';
import type { Axis, Expr } from './types';

const AXES: Axis[] = ['x', 'y', 'z', 'm', 'n'].map((letter) => ({
  id: `a${letter}`,
  name: letter,
  positions: Array.from({ length: 20 }, (_, i) => `a${letter}-p${i + 1}`),
}));

const parse = (s: string): Expr => parseFormula(s, AXES);

describe('parseFormula — literals & arithmetic', () => {
  it('parses a number and a string', () => {
    expect(parse('42')).toEqual({ kind: 'num', n: 42 });
    expect(parse('"hi"')).toEqual({ kind: 'str', s: 'hi' });
  });

  it('honours * / over + - (precedence climbing)', () => {
    expect(parse('1+2*3')).toEqual({
      kind: 'binary',
      op: '+',
      l: { kind: 'num', n: 1 },
      r: { kind: 'binary', op: '*', l: { kind: 'num', n: 2 }, r: { kind: 'num', n: 3 } },
    });
  });

  it('is left-associative for equal precedence', () => {
    expect(parse('8-3-2')).toEqual({
      kind: 'binary',
      op: '-',
      l: { kind: 'binary', op: '-', l: { kind: 'num', n: 8 }, r: { kind: 'num', n: 3 } },
      r: { kind: 'num', n: 2 },
    });
  });

  it('parses unary minus and parentheses', () => {
    expect(parse('-5')).toEqual({ kind: 'unary', op: '-', arg: { kind: 'num', n: 5 } });
    expect(parse('(1+2)*3')).toEqual({
      kind: 'binary',
      op: '*',
      l: { kind: 'binary', op: '+', l: { kind: 'num', n: 1 }, r: { kind: 'num', n: 2 } },
      r: { kind: 'num', n: 3 },
    });
  });
});

describe('parseFormula — references & calls', () => {
  it('parses a cell reference', () => {
    expect(parse('z2')).toEqual({
      kind: 'ref',
      ref: { kind: 'cell', comps: [{ axisId: 'az', index: 2, absolute: false }] },
    });
  });

  it('parses a call with a range argument and a scalar', () => {
    const ast = parse('SUM(z2:9, 10)') as Extract<Expr, { kind: 'call' }>;
    expect(ast.kind).toBe('call');
    expect(ast.fn).toBe('SUM');
    expect(ast.args[0]!.kind).toBe('rangeRef');
    expect(ast.args[1]).toEqual({ kind: 'num', n: 10 });
  });

  it('parses an open-ended range (the worked-example SUM)', () => {
    const ast = parse('SUM(z2:)') as Extract<Expr, { kind: 'call' }>;
    expect(ast.args[0]).toMatchObject({
      kind: 'rangeRef',
      ref: { varying: { axisId: 'az', from: { kind: 'index', index: 2 }, to: { kind: 'open' } } },
    });
  });

  it('parses arithmetic over references', () => {
    expect(parse('x1y1z1 + 5')).toMatchObject({ kind: 'binary', op: '+' });
  });
});

describe('parseFormula — errors (→ #NAME? at the caller)', () => {
  it('rejects a bare function name without parentheses', () => {
    expect(() => parse('SUM')).toThrow(ParseError);
  });
  it('rejects trailing input and a dangling operator', () => {
    expect(() => parse('1 2')).toThrow(ParseError);
    expect(() => parse('1 +')).toThrow(ParseError);
  });
  it('rejects a malformed address (lexer error surfaces as a parse error)', () => {
    expect(() => parse('sum2')).toThrow(ParseError); // 3-letter "axis" sum
  });
});
