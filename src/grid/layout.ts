// The grid's coordinate model (tech-design §13 "windowing math"): the single place
// that turns a 0-based (row, col) into CSS-pixel rects, given header sizes and the
// scroll offset. Every draw site goes through here, so per-axis sizing (M9) becomes
// a change to `colLeft`/`rowTop` (prefix-sum lookups instead of `index * size`)
// rather than an edit at six inlined call sites. `hitTest.ts` is the inverse.

import type { Rect } from './types';

/** Per-axis cell sizes and header gutter sizes, in CSS px. Uniform for now (M9 makes
 *  these per-position); kept as a struct so the rest of the module reads sizes by name. */
export interface GridMetrics {
  rowH: number; // body cell height
  colW: number; // body cell width
  headerW: number; // left gutter (row headers) width
  headerH: number; // top gutter (column headers) height
}

export const LAYOUT: GridMetrics = {
  rowH: 24,
  colW: 96,
  headerW: 56,
  headerH: 24,
};

/** Metrics plus the current scroll offset — the full context a coordinate transform
 *  needs. Bundled so draw passes thread one value instead of four. */
export interface Layout {
  readonly m: GridMetrics;
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

export function layoutAt(scrollLeft: number, scrollTop: number, m: GridMetrics = LAYOUT): Layout {
  return { m, scrollLeft, scrollTop };
}

/** Left edge (CSS px) of the column at 0-based index `col` — the one horizontal
 *  index→pixel transform, used by cells, gridlines, and the top gutter. */
export function colLeft(L: Layout, col: number): number {
  return L.m.headerW + col * L.m.colW - L.scrollLeft;
}

/** Top edge (CSS px) of the row at 0-based index `row`. */
export function rowTop(L: Layout, row: number): number {
  return L.m.headerH + row * L.m.rowH - L.scrollTop;
}

/** The body-cell rect for a 0-based (row, col). */
export function cellRect(L: Layout, row: number, col: number): Rect {
  return { x: colLeft(L, col), y: rowTop(L, row), w: L.m.colW, h: L.m.rowH };
}

/** The top-gutter header rect for a 0-based column. */
export function colHeaderRect(L: Layout, col: number): Rect {
  return { x: colLeft(L, col), y: 0, w: L.m.colW, h: L.m.headerH };
}

/** The left-gutter header rect for a 0-based row. */
export function rowHeaderRect(L: Layout, row: number): Rect {
  return { x: 0, y: rowTop(L, row), w: L.m.headerW, h: L.m.rowH };
}

/** The body region (where cells and overlays are clipped), given viewport size. */
export function bodyRect(m: GridMetrics, cssWidth: number, cssHeight: number): Rect {
  return { x: m.headerW, y: m.headerH, w: cssWidth - m.headerW, h: cssHeight - m.headerH };
}

/** The top-gutter region (column headers). */
export function topGutterRect(m: GridMetrics, cssWidth: number): Rect {
  return { x: m.headerW, y: 0, w: cssWidth - m.headerW, h: m.headerH };
}

/** The left-gutter region (row headers). */
export function leftGutterRect(m: GridMetrics, cssHeight: number): Rect {
  return { x: 0, y: m.headerH, w: m.headerW, h: cssHeight - m.headerH };
}

/** The fixed corner where the two gutters meet. */
export function cornerRect(m: GridMetrics): Rect {
  return { x: 0, y: 0, w: m.headerW, h: m.headerH };
}

/** Snap a coordinate to a crisp 1px hairline: a 1px-wide stroke centred on an integer
 *  straddles two device rows, so paths are drawn on the half-pixel instead. */
export function pixelAlign(v: number): number {
  return Math.round(v) + 0.5;
}
