import { describe, expect, it } from 'vitest';
import { covers, flatsOverlap } from './fiber';
import type { Coord, Flat } from './types';

// A fiber pinned on the given axes (each to an index), free on the rest.
const flat = (pins: [string, number][], free: string[]): Flat => ({
  id: `flat-${pins.map(([a, i]) => `${a}${i}`).join('-')}`,
  pins: new Map(pins),
  free: new Set(free),
  input: { kind: 'literal', raw: 'v' },
});
const coord = (entries: [string, number][]): Coord => new Map(entries);

describe('covers', () => {
  // Fiber: column y=3 held constant down every row, on page 1.
  const f = flat(
    [
      ['c', 3],
      ['z', 1],
    ],
    ['r'],
  );

  it('covers any coordinate matching the pinned axes (free axis varies)', () => {
    expect(covers(f, coord([['r', 1], ['c', 3], ['z', 1]]))).toBe(true);
    expect(covers(f, coord([['r', 99], ['c', 3], ['z', 1]]))).toBe(true);
  });

  it('does not cover a coordinate that differs on a pinned axis', () => {
    expect(covers(f, coord([['r', 1], ['c', 4], ['z', 1]]))).toBe(false); // wrong column
    expect(covers(f, coord([['r', 1], ['c', 3], ['z', 2]]))).toBe(false); // wrong page
  });
});

describe('flatsOverlap', () => {
  it('overlaps when no shared pinned axis disagrees', () => {
    // Both free on r; a pins c=3, b pins z=1 — disjoint pin sets, so they share
    // the coordinate {c:3, z:1, r:*}.
    const a = flat([['c', 3]], ['r', 'z']);
    const b = flat([['z', 1]], ['r', 'c']);
    expect(flatsOverlap(a, b)).toBe(true);
  });

  it('is disjoint when a shared pinned axis disagrees', () => {
    // Same shape, different page → no shared coordinate.
    const a = flat([['z', 1]], ['r', 'c']);
    const b = flat([['z', 2]], ['r', 'c']);
    expect(flatsOverlap(a, b)).toBe(false);
  });

  it('overlaps two identically-pinned fibers', () => {
    const a = flat([['c', 3], ['z', 1]], ['r']);
    const b = flat([['c', 3], ['z', 1]], ['r']);
    expect(flatsOverlap(a, b)).toBe(true);
  });
});
