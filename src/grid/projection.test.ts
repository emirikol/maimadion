import { describe, expect, it } from 'vitest';
import { coordAt, hiddenAxes } from './projection';
import type { Axis, ViewportBinding } from '../engine/types';

const axis = (id: string): Axis => ({ id, name: id, positions: [`${id}-p1`] });

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

  it('lets the row/column indices win over any navigated entry on a visible axis', () => {
    // A stale navigated entry on the row axis must not override the screen index.
    const coord = coordAt(view([['r', 9]]), 4, 7);
    expect(coord.get('r')).toBe(4);
    expect(coord.get('c')).toBe(7);
  });
});

describe('hiddenAxes', () => {
  const axes = [axis('r'), axis('c'), axis('z'), axis('m')];

  it('returns the axes that are neither the row nor the column axis, in order', () => {
    const hidden = hiddenAxes(axes, { rowAxisId: 'r', colAxisId: 'c' });
    expect(hidden.map((a) => a.id)).toEqual(['z', 'm']);
  });

  it('reflects a rebinding: a newly-visible axis drops out, the displaced one appears', () => {
    const hidden = hiddenAxes(axes, { rowAxisId: 'r', colAxisId: 'z' });
    expect(hidden.map((a) => a.id)).toEqual(['c', 'm']);
  });

  it('is empty for a 2-axis sheet', () => {
    expect(hiddenAxes([axis('r'), axis('c')], { rowAxisId: 'r', colAxisId: 'c' })).toEqual([]);
  });
});
