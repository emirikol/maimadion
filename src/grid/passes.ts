// The draw passes, in back-to-front order: cell backgrounds + values, gridlines,
// the two header gutters, the fixed corner/border chrome, and the active-cell
// overlay (tech-design §13 "draw layers"). Each is an isolated unit so a near-term
// feature lands in one place — selection wash and the fill handle extend the overlay
// pass, ref highlighting the cell-body pass, frozen panes the gutter passes — rather
// than threading through one ~200-line function.

import type { Coord } from '../engine/types';
import type { CellSource } from '../model/sheet';
import { drawCellText, fillCenteredText, fillRect, withClip } from './draw';
import {
  cellRect,
  colHeaderRect,
  colLeft,
  cornerRect,
  type Layout,
  pixelAlign,
  rowHeaderRect,
  rowTop,
} from './layout';
import { coordAt, type Projection } from './projection';
import { ACTIVE_OUTLINE, COLORS } from './theme';
import type { Rect, VisibleRange } from './types';

/** One visible cell, read once: its rect plus what the single read returned. The
 *  cell-body passes draw from this buffer so `read()` is called once per cell rather
 *  than once for the tint and again for the text. */
interface CellDraw {
  rect: Rect;
  text: string;
  isFlat: boolean;
}

/** Walk the visible window once, reading each cell a single time (§13). */
export function readWindow(
  read: (coord: Coord) => { text: string; source: CellSource },
  view: Projection,
  range: VisibleRange,
  L: Layout,
): CellDraw[] {
  const cells: CellDraw[] = [];
  for (let row = range.firstRow; row <= range.lastRow; row++) {
    for (let col = range.firstCol; col <= range.lastCol; col++) {
      const { text, source } = read(coordAt(view, row + 1, col + 1));
      cells.push({ rect: cellRect(L, row, col), text, isFlat: source === 'flat' });
    }
  }
  return cells;
}

/** Fiber-covered cells get a subtle background tint (§13), drawn under the gridlines
 *  so a constant reads as a continuous band across its spanned axis. */
export function drawFlatTints(ctx: CanvasRenderingContext2D, cells: CellDraw[]): void {
  for (const cell of cells) {
    if (cell.isFlat) fillRect(ctx, cell.rect, COLORS.flatBg);
  }
}

/** Cell gridlines across the visible window, including the trailing edge line. */
export function drawGridlines(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  range: VisibleRange,
  cssWidth: number,
  cssHeight: number,
): void {
  ctx.strokeStyle = COLORS.gridline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let col = range.firstCol; col <= range.lastCol + 1; col++) {
    const x = pixelAlign(colLeft(L, col));
    ctx.moveTo(x, L.m.headerH);
    ctx.lineTo(x, cssHeight);
  }
  for (let row = range.firstRow; row <= range.lastRow + 1; row++) {
    const y = pixelAlign(rowTop(L, row));
    ctx.moveTo(L.m.headerW, y);
    ctx.lineTo(cssWidth, y);
  }
  ctx.stroke();
}

/** Cell values, drawn over the gridlines. */
export function drawCellValues(ctx: CanvasRenderingContext2D, cells: CellDraw[]): void {
  for (const cell of cells) {
    if (cell.text) drawCellText(ctx, cell.rect, cell.text, COLORS.cellText);
  }
}

/** Shared body of the two header gutters: fill, per-index active highlight + label,
 *  and the separator hairlines. The two axes differ only in their rects and the
 *  orientation of the separator, passed in by the column/row wrappers below. */
function drawGutter(
  ctx: CanvasRenderingContext2D,
  opts: {
    region: Rect;
    first: number;
    last: number;
    active: number; // 0-based active index on this axis, or -1
    headerRect: (i: number) => Rect;
    label: (i: number) => string;
    separator: (i: number) => { from: [number, number]; to: [number, number] };
  },
): void {
  withClip(ctx, opts.region, () => {
    fillRect(ctx, opts.region, COLORS.gutterBg);
    ctx.strokeStyle = COLORS.gutterBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = opts.first; i <= opts.last; i++) {
      const rect = opts.headerRect(i);
      const isActive = i === opts.active;
      if (isActive) fillRect(ctx, rect, COLORS.accentBg);
      fillCenteredText(ctx, rect, opts.label(i), isActive ? COLORS.accent : COLORS.gutterText);
      const sep = opts.separator(i);
      ctx.moveTo(sep.from[0], sep.from[1]);
      ctx.lineTo(sep.to[0], sep.to[1]);
    }
    ctx.stroke();
  });
}

/** Top gutter: column headers (axis letter + 1-based index). */
export function drawColumnGutter(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  region: Rect,
  range: VisibleRange,
  letter: string,
  activeCol0: number,
): void {
  drawGutter(ctx, {
    region,
    first: range.firstCol,
    last: range.lastCol,
    active: activeCol0,
    headerRect: (c) => colHeaderRect(L, c),
    label: (c) => `${letter}${c + 1}`,
    separator: (c) => {
      const x = pixelAlign(colLeft(L, c));
      return { from: [x, 0], to: [x, L.m.headerH] };
    },
  });
}

/** Left gutter: row headers (axis letter + 1-based index). */
export function drawRowGutter(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  region: Rect,
  range: VisibleRange,
  letter: string,
  activeRow0: number,
): void {
  drawGutter(ctx, {
    region,
    first: range.firstRow,
    last: range.lastRow,
    active: activeRow0,
    headerRect: (r) => rowHeaderRect(L, r),
    label: (r) => `${letter}${r + 1}`,
    separator: (r) => {
      const y = pixelAlign(rowTop(L, r));
      return { from: [0, y], to: [L.m.headerW, y] };
    },
  });
}

/** The fixed corner where the gutters meet, plus the two border lines that separate
 *  the gutters from the body the full length of the viewport. */
export function drawChrome(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  cssWidth: number,
  cssHeight: number,
): void {
  fillRect(ctx, cornerRect(L.m), COLORS.gutterBg);
  ctx.strokeStyle = COLORS.gutterBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pixelAlign(L.m.headerW), 0);
  ctx.lineTo(pixelAlign(L.m.headerW), cssHeight);
  ctx.moveTo(0, pixelAlign(L.m.headerH));
  ctx.lineTo(cssWidth, pixelAlign(L.m.headerH));
  ctx.stroke();
}

/** The active-cell outline, clipped to the body region (§13). */
export function drawActiveCell(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  body: Rect,
  activeRow0: number,
  activeCol0: number,
): void {
  if (activeRow0 < 0 || activeCol0 < 0) return;
  withClip(ctx, body, () => {
    const rect = cellRect(L, activeRow0, activeCol0);
    const { inset, width } = ACTIVE_OUTLINE;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = width;
    ctx.strokeRect(
      Math.round(rect.x) + inset,
      Math.round(rect.y) + inset,
      rect.w - 2 * inset,
      rect.h - 2 * inset,
    );
  });
}
