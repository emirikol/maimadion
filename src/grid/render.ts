// Canvas renderer — mirrors tech-design §13, for the M1 2-D slice. Owns no n-D logic:
// it draws an ordinary grid fed by the sheet via the placeholder read path. Uniform
// cell sizes for M1 (per-position resize is M9).
//
// This module is now just the frame setup and the pass pipeline; the coordinate model
// lives in `layout.ts` (inverse in `hitTest.ts`), windowing in `geometry.ts`, the
// canvas idioms in `draw.ts`, and each draw layer in `passes.ts`.

import { axisLetter } from '../engine/coord';
import type { Coord, Index, Sheet } from '../engine/types';
import type { CellSource } from '../model/sheet';
import { withClip } from './draw';
import { visibleRange } from './geometry';
import { bodyRect, LAYOUT, layoutAt, leftGutterRect, topGutterRect } from './layout';
import {
  drawActiveCell,
  drawCellValues,
  drawChrome,
  drawColumnGutter,
  drawFlatTints,
  drawGridlines,
  drawRowGutter,
  readWindow,
} from './passes';
import type { Projection } from './projection';
import { COLORS, FONT } from './theme';

export { LAYOUT };

export interface RenderParams {
  ctx: CanvasRenderingContext2D;
  cssWidth: number; // viewport size in CSS px
  cssHeight: number;
  dpr: number; // devicePixelRatio
  scrollLeft: number;
  scrollTop: number;
  sheet: Sheet;
  view: Projection; // the current visible binding + navigated positions (§12)
  // The display string (computed value, §7) and source of a coordinate. Supplied by
  // the controller so the renderer owns no value/formula logic.
  read: (coord: Coord) => { text: string; source: CellSource };
  // The active cell's 1-based indices on the two visible axes (§16 selection).
  active: { row: Index; col: Index };
}

/** Total grid size in CSS px (for the scroll spacer), for the given binding. */
export function contentSize(
  sheet: Sheet,
  view: Pick<Projection, 'rowAxisId' | 'colAxisId'>,
): { width: number; height: number } {
  const rows = axisOf(sheet, view.rowAxisId).positions.length;
  const cols = axisOf(sheet, view.colAxisId).positions.length;
  return {
    width: LAYOUT.headerW + cols * LAYOUT.colW,
    height: LAYOUT.headerH + rows * LAYOUT.rowH,
  };
}

function axisOf(sheet: Sheet, id: string) {
  const axis = sheet.axes.find((a) => a.id === id);
  if (!axis) throw new Error(`axis not found: ${id}`);
  return axis;
}

/** Reset the transform for HiDPI, clear to white, and set the shared text style. */
function beginFrame(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  cssWidth: number,
  cssHeight: number,
): void {
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = COLORS.pageBg;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
}

export function render(p: RenderParams): void {
  const { ctx, cssWidth, cssHeight, dpr, scrollLeft, scrollTop, sheet, view, read, active } = p;
  const L = layoutAt(scrollLeft, scrollTop);
  const activeRow0 = active.row - 1;
  const activeCol0 = active.col - 1;

  const rowAxisPos = sheet.axes.findIndex((a) => a.id === view.rowAxisId);
  const colAxisPos = sheet.axes.findIndex((a) => a.id === view.colAxisId);
  const rowLetter = axisLetter(rowAxisPos);
  const colLetter = axisLetter(colAxisPos);
  const rowCount = sheet.axes[rowAxisPos]!.positions.length;
  const colCount = sheet.axes[colAxisPos]!.positions.length;

  const body = bodyRect(LAYOUT, cssWidth, cssHeight);
  const range = visibleRange(LAYOUT, scrollLeft, scrollTop, body.w, body.h, rowCount, colCount);

  beginFrame(ctx, dpr, cssWidth, cssHeight);

  // Body: one read per visible cell, then tint → gridlines → values, clipped to body.
  const cells = readWindow(read, view, range, L);
  withClip(ctx, body, () => {
    drawFlatTints(ctx, cells);
    drawGridlines(ctx, L, range, cssWidth, cssHeight);
    drawCellValues(ctx, cells);
  });

  drawColumnGutter(ctx, L, topGutterRect(LAYOUT, cssWidth), range, colLetter, activeCol0);
  drawRowGutter(ctx, L, leftGutterRect(LAYOUT, cssHeight), range, rowLetter, activeRow0);
  drawChrome(ctx, L, cssWidth, cssHeight);
  drawActiveCell(ctx, L, body, activeRow0, activeCol0);

  ctx.restore(); // matches beginFrame's save
}
