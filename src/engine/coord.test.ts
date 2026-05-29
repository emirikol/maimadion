import { describe, expect, it } from 'vitest';
import { axisLetter, axisPositionForLetter, decodeCellKey, encodeCellKey } from './coord';
import type { PositionCoord } from './types';

describe('axisLetter', () => {
  it('assigns the conventional letters x, y, z, m, n to the first five axes', () => {
    expect([0, 1, 2, 3, 4].map(axisLetter)).toEqual(['x', 'y', 'z', 'm', 'n']);
  });

  it('continues with the remaining letters alphabetically (skipping x y z m n)', () => {
    expect(axisLetter(5)).toBe('a');
    expect(axisLetter(6)).toBe('b');
    expect(axisLetter(16)).toBe('l');
    expect(axisLetter(17)).toBe('o'); // m and n already used
    expect(axisLetter(25)).toBe('w'); // last single letter
  });

  it('uses two-letter names once single letters are exhausted', () => {
    expect(axisLetter(26)).toBe('aa');
    expect(axisLetter(27)).toBe('ab');
    expect(axisLetter(26 + 26)).toBe('ba');
    expect(axisLetter(26 + 26 * 26 - 1)).toBe('zz');
  });

  it('rejects negative or non-integer positions and overflow past zz', () => {
    expect(() => axisLetter(-1)).toThrow();
    expect(() => axisLetter(1.5)).toThrow();
    expect(() => axisLetter(26 + 26 * 26)).toThrow();
  });
});

describe('axisPositionForLetter', () => {
  it('inverts axisLetter for representative letters', () => {
    expect(axisPositionForLetter('x')).toBe(0);
    expect(axisPositionForLetter('n')).toBe(4);
    expect(axisPositionForLetter('a')).toBe(5);
    expect(axisPositionForLetter('w')).toBe(25);
    expect(axisPositionForLetter('aa')).toBe(26);
    expect(axisPositionForLetter('zz')).toBe(26 + 26 * 26 - 1);
  });

  it('round-trips with axisLetter across the whole supported range', () => {
    for (let p = 0; p < 26 + 26 * 26; p++) {
      expect(axisPositionForLetter(axisLetter(p))).toBe(p);
    }
  });

  it('rejects malformed letters', () => {
    expect(() => axisPositionForLetter('')).toThrow();
    expect(() => axisPositionForLetter('A')).toThrow();
    expect(() => axisPositionForLetter('x1')).toThrow();
    expect(() => axisPositionForLetter('aaa')).toThrow();
  });
});

describe('CellKey codec', () => {
  it('encodes pairs sorted by axisId, independent of insertion order', () => {
    const a: PositionCoord = new Map([
      ['ay', 'p2'],
      ['ax', 'p1'],
    ]);
    const b: PositionCoord = new Map([
      ['ax', 'p1'],
      ['ay', 'p2'],
    ]);
    expect(encodeCellKey(a)).toBe('ax:p1|ay:p2');
    expect(encodeCellKey(a)).toBe(encodeCellKey(b)); // canonical
  });

  it('round-trips encode → decode', () => {
    const coord: PositionCoord = new Map([
      ['axis-year', 'pos-2026'],
      ['axis-month', 'pos-apr'],
      ['axis-cat', 'pos-debt'],
    ]);
    const decoded = decodeCellKey(encodeCellKey(coord));
    expect(decoded).toEqual(coord);
  });

  it('handles the empty coordinate', () => {
    const empty: PositionCoord = new Map();
    expect(encodeCellKey(empty)).toBe('');
    expect(decodeCellKey('')).toEqual(empty);
  });

  it('rejects a malformed key segment', () => {
    expect(() => decodeCellKey('no-colon-here')).toThrow();
  });
});
