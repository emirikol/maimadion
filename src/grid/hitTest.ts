// The inverse of `layout.ts`: a CSS-pixel point (relative to the canvas top-left)
// back to the 0-based body cell under it (tech-design §13 "hit-testing"). Kept beside
// the forward transform so the two never drift; `Grid.svelte` calls this instead of
// re-deriving the arithmetic. Returns null over the gutters/corner or past the last
// populated cell.

import type { Layout } from './layout';
import type { GridCell } from './types';

export function cellAt(
  L: Layout,
  px: number,
  py: number,
  rowCount: number,
  colCount: number,
): GridCell | null {
  if (px < L.m.headerW || py < L.m.headerH) return null;
  const col = Math.floor((px - L.m.headerW + L.scrollLeft) / L.m.colW);
  const row = Math.floor((py - L.m.headerH + L.scrollTop) / L.m.rowH);
  if (row < 0 || col < 0 || row >= rowCount || col >= colCount) return null;
  return { row, col };
}
