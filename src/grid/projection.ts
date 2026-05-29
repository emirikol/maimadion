// Viewport projection — mirrors tech-design §12. Pure read: screen (row, col) →
// coordinate, taking the navigated position on every non-visible axis. Never writes.

import type { Axis, Coord, Index, ViewportBinding } from '../engine/types';

// The slice of a ViewportBinding projection actually needs: which axes are on the
// two visible axes and where every other (navigated) axis is pinned. Keeping the
// param this narrow lets the reactive controller pass a lightweight object while a
// full ViewportBinding still satisfies it structurally.
export type Projection = Pick<ViewportBinding, 'rowAxisId' | 'colAxisId' | 'navigated'>;

/** The coordinate shown at a screen cell, given 1-based row/column indices. */
export function coordAt(view: Projection, rowIndex: Index, colIndex: Index): Coord {
  const coord: Coord = new Map(view.navigated);
  coord.set(view.rowAxisId, rowIndex);
  coord.set(view.colAxisId, colIndex);
  return coord;
}

/**
 * The axes that are neither the row nor the column axis — every one of these gets a
 * navigator (§14). Returned in sheet axis order so the controls render stably.
 */
export function hiddenAxes(
  axes: Axis[],
  view: Pick<Projection, 'rowAxisId' | 'colAxisId'>,
): Axis[] {
  return axes.filter((a) => a.id !== view.rowAxisId && a.id !== view.colAxisId);
}
