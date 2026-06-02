// Geometry primitives for the canvas renderer (tech-design §13). The renderer works
// in 0-based grid indices throughout; the 1-based convention lives only at the read
// boundary, where `coordAt` takes 1-based row/column indices. Keeping these as named
// types means the coordinate transform has one home (`layout.ts`) and its inverse one
// home (`hitTest.ts`) rather than being re-derived inline at every draw site.

/** A rectangle in CSS pixels, relative to the canvas top-left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point in CSS pixels, relative to the canvas top-left. */
export interface ScreenPos {
  x: number;
  y: number;
}

/** A 0-based cell address on the two currently visible axes. */
export interface GridCell {
  row: number;
  col: number;
}

/** An inclusive 0-based window of the rows and columns currently on screen. */
export interface VisibleRange {
  firstRow: number;
  lastRow: number;
  firstCol: number;
  lastCol: number;
}
