// Viewport projection — mirrors tech-design §12. Pure read: screen (row, col) →
// coordinate, taking the navigated position on every non-visible axis. Never writes.

import type { Coord, Index, ViewportBinding } from '../engine/types';

/** The coordinate shown at a screen cell, given 1-based row/column indices. */
export function coordAt(view: ViewportBinding, rowIndex: Index, colIndex: Index): Coord {
  const coord: Coord = new Map(view.navigated);
  coord.set(view.rowAxisId, rowIndex);
  coord.set(view.colAxisId, colIndex);
  return coord;
}
