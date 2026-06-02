// Windowing: which 0-based rows and columns fall inside the body region, given the
// scroll offset and viewport size (tech-design §13). Split from the draw passes so
// that when sizing goes per-axis (M9) only this `floor(scroll / size)` arithmetic
// changes — to a prefix-sum / binary-search over cumulative offsets — and the passes
// that consume a `VisibleRange` stay untouched.

import type { GridMetrics } from './layout';
import type { VisibleRange } from './types';

export function visibleRange(
  m: GridMetrics,
  scrollLeft: number,
  scrollTop: number,
  bodyW: number,
  bodyH: number,
  rowCount: number,
  colCount: number,
): VisibleRange {
  return {
    firstRow: Math.max(0, Math.floor(scrollTop / m.rowH)),
    lastRow: Math.min(rowCount - 1, Math.floor((scrollTop + bodyH) / m.rowH)),
    firstCol: Math.max(0, Math.floor(scrollLeft / m.colW)),
    lastCol: Math.min(colCount - 1, Math.floor((scrollLeft + bodyW) / m.colW)),
  };
}
