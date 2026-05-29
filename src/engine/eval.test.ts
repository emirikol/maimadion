import { describe, expect, it } from 'vitest';
import { encodeCellKey } from './coord';
import { evaluate, type Read } from './eval';
import { parseFormula } from './parse';
import { resolveRange } from './resolve';
import type { Axis, CellKey, Computed } from './types';

// Three axes, 6 positions each. Fully-qualified addresses in the tests avoid needing
// context completion (that is exercised in coord.test.ts).
const AXES: Axis[] = ['x', 'y', 'z'].map((letter) => ({
  id: `a${letter}`,
  name: letter,
  positions: Array.from({ length: 6 }, (_, i) => `a${letter}-p${i + 1}`),
}));

const keyAt = (x: number, y: number, z: number): CellKey =>
  encodeCellKey(
    new Map([
      ['ax', `ax-p${x}`],
      ['ay', `ay-p${y}`],
      ['az', `az-p${z}`],
    ]),
  );

const num = (n: number): Computed => ({ value: { kind: 'number', n } });
const text = (s: string): Computed => ({ value: { kind: 'text', s } });

const values = new Map<CellKey, Computed>([
  [keyAt(1, 1, 1), num(10)],
  [keyAt(1, 1, 2), num(5)],
  [keyAt(1, 1, 3), text('hi')],
  // (1,1,4) intentionally absent → empty
  [keyAt(1, 1, 5), num(7)],
  [keyAt(2, 2, 2), { error: '#DIV/0!' }],
]);
const read: Read = (key) => values.get(key) ?? { value: { kind: 'empty' } };

const evalSrc = (src: string): Computed => evaluate(parseFormula(src, AXES), { axes: AXES, read });

describe('resolveRange', () => {
  it('materializes the ordered member keys, clamping an open end', () => {
    const ref = parseFormula('x1y1z2:', AXES);
    if (ref.kind !== 'rangeRef') throw new Error('expected a range');
    expect(resolveRange(ref.ref, AXES)).toEqual([
      keyAt(1, 1, 2),
      keyAt(1, 1, 3),
      keyAt(1, 1, 4),
      keyAt(1, 1, 5),
      keyAt(1, 1, 6),
    ]);
  });

  it('returns #REF! for an explicit index past the axis end', () => {
    const ref = parseFormula('x1y1z2:99', AXES);
    if (ref.kind !== 'rangeRef') throw new Error('expected a range');
    expect(resolveRange(ref.ref, AXES)).toBe('#REF!');
  });
});

describe('evaluate — arithmetic', () => {
  it('adds two referenced numbers', () => {
    expect(evalSrc('x1y1z1 + x1y1z2')).toEqual(num(15));
  });
  it('negates and respects precedence', () => {
    expect(evalSrc('-x1y1z1')).toEqual(num(-10));
    expect(evalSrc('1 + 2 * 3')).toEqual(num(7));
  });
  it('treats an empty operand as 0', () => {
    expect(evalSrc('x1y1z4 + 3')).toEqual(num(3)); // z4 empty
  });
  it('divides, and #DIV/0! on a zero divisor', () => {
    expect(evalSrc('x1y1z1 / x1y1z2')).toEqual(num(2));
    expect(evalSrc('x1y1z1 / 0')).toEqual({ error: '#DIV/0!' });
  });
  it('#VALUE! when text is used as a number', () => {
    expect(evalSrc('x1y1z3 + 1')).toEqual({ error: '#VALUE!' });
  });
  it('#REF! for an out-of-range reference', () => {
    expect(evalSrc('x1y9z1')).toEqual({ error: '#REF!' });
  });
  it('#VALUE! when a range is used as a scalar', () => {
    expect(evalSrc('x1y1z1:5 + 1')).toEqual({ error: '#VALUE!' });
  });
});

describe('evaluate — aggregations (skip empty/text, propagate errors)', () => {
  it('SUM over a range skips text and empty', () => {
    expect(evalSrc('SUM(x1y1z1:5)')).toEqual(num(22)); // 10 + 5 + (hi) + (empty) + 7
  });
  it('SUM mixes ranges and scalars; text scalars are skipped', () => {
    expect(evalSrc('SUM(x1y1z1:2, 100, "ignored")')).toEqual(num(115));
  });
  it('COUNT counts only numeric cells', () => {
    expect(evalSrc('COUNT(x1y1z1:5)')).toEqual(num(3));
  });
  it('AVERAGE = sum/count over numerics; #DIV/0! over none', () => {
    expect(evalSrc('AVERAGE(x1y1z1:5)')).toEqual(num(22 / 3));
    expect(evalSrc('AVERAGE(x1y1z3:4)')).toEqual({ error: '#DIV/0!' });
  });
  it('MIN/MAX over no numerics → 0', () => {
    expect(evalSrc('MIN(x1y1z3:4)')).toEqual(num(0));
    expect(evalSrc('MAX(x1y1z1:2)')).toEqual(num(10));
  });
  it('propagates a genuine error from a member cell', () => {
    expect(evalSrc('SUM(x2y2z2:2)')).toEqual({ error: '#DIV/0!' });
  });
  it('unknown function → #NAME?', () => {
    expect(evalSrc('FOO(1)')).toEqual({ error: '#NAME?' });
  });
});
