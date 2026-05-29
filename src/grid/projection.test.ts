import { describe, expect, it } from 'vitest';
import { coordAt } from './projection';
import type { ViewportBinding } from '../engine/types';

function view(navigated: [string, number][] = []): ViewportBinding {
  return {
    rowAxisId: 'r',
    colAxisId: 'c',
    navigated: new Map(navigated),
    activeCoord: new Map(),
    selection: { kind: 'single', coord: new Map() },
    scroll: { row: 0, col: 0 },
  };
}

describe('coordAt', () => {
  it('places the row/column indices on the bound axes', () => {
    const coord = coordAt(view(), 4, 7);
    expect(coord.get('r')).toBe(4);
    expect(coord.get('c')).toBe(7);
    expect(coord.size).toBe(2);
  });

  it('carries the navigated position on every other axis', () => {
    const coord = coordAt(view([['z', 3]]), 1, 1);
    expect(coord.get('z')).toBe(3);
    expect(coord.get('r')).toBe(1);
    expect(coord.get('c')).toBe(1);
  });
});
