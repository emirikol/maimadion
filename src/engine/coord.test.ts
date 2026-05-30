import { describe, expect, it } from 'vitest';
import {
  axisLetter,
  axisPositionForLetter,
  completeRef,
  decodeCellKey,
  encodeCellKey,
  formatRef,
  parseAddress,
} from './coord';
import type { Axis, Coord, PositionCoord } from './types';

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

// Axes x, y, z, m, n (positions 0–4), each long enough for the test indices.
const AXES: Axis[] = ['x', 'y', 'z', 'm', 'n'].map((letter) => ({
  id: `a${letter}`,
  name: letter,
  positions: Array.from({ length: 20 }, (_, i) => `a${letter}-p${i + 1}`),
}));

describe('parseAddress (cells)', () => {
  it('parses a fully-qualified coordinate into one component per axis', () => {
    const ref = parseAddress('x3y6z2', AXES);
    expect(ref).toEqual({
      kind: 'cell',
      comps: [
        { axisId: 'ax', index: 3, absolute: false },
        { axisId: 'ay', index: 6, absolute: false },
        { axisId: 'az', index: 2, absolute: false },
      ],
    });
  });

  it('parses a partial address (named axes only) for later completion', () => {
    const ref = parseAddress('z2', AXES);
    expect(ref).toEqual({ kind: 'cell', comps: [{ axisId: 'az', index: 2, absolute: false }] });
  });

  it('records $ as an absolute component', () => {
    expect(parseAddress('$x3', AXES)).toEqual({
      kind: 'cell',
      comps: [{ axisId: 'ax', index: 3, absolute: true }],
    });
  });

  it('rejects a letter with no index and an unknown axis letter', () => {
    expect(() => parseAddress('x', AXES)).toThrow();
    expect(() => parseAddress('q2', [AXES[0]!])).toThrow(); // only x exists
  });
});

describe('parseAddress (the §4 colon rule)', () => {
  const varying = (s: string) => (parseAddress(s, AXES) as { varying: unknown }).varying;

  it('digit after ":" is the upper bound', () => {
    expect(varying('y2z4:9')).toEqual({
      axisId: 'az',
      from: { kind: 'index', index: 4 },
      to: { kind: 'index', index: 9 },
      absFrom: false,
      absTo: false,
    });
  });

  it('trailing ":" means open to the end of the axis', () => {
    expect(varying('y2z4:')).toEqual({
      axisId: 'az',
      from: { kind: 'index', index: 4 },
      to: { kind: 'open' },
      absFrom: false,
      absTo: false,
    });
  });

  it('leading-open ":" means from the start of the axis', () => {
    expect(varying('y2z:9')).toMatchObject({ from: { kind: 'open' }, to: { kind: 'index', index: 9 } });
  });

  it('bare "axis:" is the whole axis', () => {
    expect(varying('y2z:')).toMatchObject({ from: { kind: 'open' }, to: { kind: 'open' } });
  });

  it('a letter after ":" is an open end, then the next axis segment', () => {
    const ref = parseAddress('y2z4:m1', AXES) as { kind: 'range'; fixed: unknown[]; varying: { to: unknown } };
    expect(ref.varying.to).toEqual({ kind: 'open' });
    expect(ref.fixed).toEqual([
      { axisId: 'ay', index: 2, absolute: false },
      { axisId: 'am', index: 1, absolute: false },
    ]);
  });

  it('rejects two varying axes', () => {
    expect(() => parseAddress('y2:4z3:9', AXES)).toThrow();
  });
});

describe('formatRef + completeRef', () => {
  // Active-cell context. z=5 differs from the z2 references below, so z2 stays
  // visible while the matching axes (x,y,m,n) elide — a reference to a different
  // z than the formula's own cell.
  const ctx: Coord = new Map([
    ['ax', 1],
    ['ay', 4],
    ['az', 5],
    ['am', 1],
    ['an', 1],
  ]);

  it('round-trips a fully-qualified cell and range', () => {
    for (const s of ['x3y6z2', 'y2z4:9', 'y2z4:', 'y2z:9', 'y2z4:m1']) {
      expect(formatRef(parseAddress(s, AXES), AXES)).toBe(s);
    }
  });

  it('completes a partial reference from the authoring context, in axis order', () => {
    const full = completeRef(parseAddress('z2', AXES), ctx, AXES);
    expect(formatRef(full, AXES)).toBe('x1y4z2m1n1');
  });

  it('elides relative components that match the context (display form)', () => {
    const full = completeRef(parseAddress('z2', AXES), ctx, AXES);
    expect(formatRef(full, AXES, ctx)).toBe('z2'); // x,y,m,n match context → hidden
  });

  it('does not elide an absolute component even when it matches context', () => {
    const full = completeRef(parseAddress('$x1z2', AXES), ctx, AXES);
    expect(formatRef(full, AXES, ctx)).toBe('$x1z2'); // $x1 kept despite matching
  });

  it('keeps the varying axis of a range even when it would match context', () => {
    const full = completeRef(parseAddress('z2:', AXES), ctx, AXES);
    expect(formatRef(full, AXES, ctx)).toBe('z2:');
  });
});
