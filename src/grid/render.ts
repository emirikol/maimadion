// Canvas renderer — mirrors tech-design §13, for the M1 2-D slice. Owns no n-D
// logic: it draws an ordinary grid fed by the sheet via the placeholder read path.
// Uniform cell sizes for M1 (per-position resize is M9).

import { axisLetter } from '../engine/coord';
import type { Index, Sheet } from '../engine/types';
import { displayValue, readCell } from '../model/sheet';
import { coordAt, type Projection } from './projection';

export const LAYOUT = {
  rowH: 24, // body cell height
  colW: 96, // body cell width
  headerW: 56, // left gutter (row headers) width
  headerH: 24, // top gutter (column headers) height
} as const;

const COLORS = {
  cellText: '#1a1a1a',
  gridline: '#e3e3e3',
  gutterBg: '#f6f6f6',
  gutterText: '#555',
  gutterBorder: '#cfcfcf',
  accent: '#1a73e8', // active-cell outline + active header
  accentBg: '#e8f0fe', // active header background
  flatBg: '#fef7e0', // subtle tint marking a fiber-covered cell (§13)
} as const;

export interface RenderParams {
  ctx: CanvasRenderingContext2D;
  cssWidth: number; // viewport size in CSS px
  cssHeight: number;
  dpr: number; // devicePixelRatio
  scrollLeft: number;
  scrollTop: number;
  sheet: Sheet;
  view: Projection; // the current visible binding + navigated positions (§12)
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

export function render(p: RenderParams): void {
  const { ctx, cssWidth, cssHeight, dpr, scrollLeft, scrollTop, sheet, view, active } = p;
  const { rowH, colW, headerW, headerH } = LAYOUT;
  const activeRow0 = active.row - 1;
  const activeCol0 = active.col - 1;

  const rowAxisPos = sheet.axes.findIndex((a) => a.id === view.rowAxisId);
  const colAxisPos = sheet.axes.findIndex((a) => a.id === view.colAxisId);
  const rowLetter = axisLetter(rowAxisPos);
  const colLetter = axisLetter(colAxisPos);
  const rowCount = sheet.axes[rowAxisPos]!.positions.length;
  const colCount = sheet.axes[colAxisPos]!.positions.length;

  const bodyW = cssWidth - headerW;
  const bodyH = cssHeight - headerH;

  const firstRow = Math.max(0, Math.floor(scrollTop / rowH));
  const lastRow = Math.min(rowCount - 1, Math.floor((scrollTop + bodyH) / rowH));
  const firstCol = Math.max(0, Math.floor(scrollLeft / colW));
  const lastCol = Math.min(colCount - 1, Math.floor((scrollLeft + bodyW) / colW));

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.font = '13px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'middle';

  // --- Body: values + gridlines, clipped to the body region ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(headerW, headerH, bodyW, bodyH);
  ctx.clip();

  // Fiber-covered cells get a subtle background tint (§13), drawn under the
  // gridlines so a constant is visible as a band across its spanned axis.
  ctx.fillStyle = COLORS.flatBg;
  for (let r = firstRow; r <= lastRow; r++) {
    const y = headerH + r * rowH - scrollTop;
    for (let c = firstCol; c <= lastCol; c++) {
      if (readCell(sheet, coordAt(view, r + 1, c + 1)).source !== 'flat') continue;
      const x = headerW + c * colW - scrollLeft;
      ctx.fillRect(x, y, colW, rowH);
    }
  }

  ctx.strokeStyle = COLORS.gridline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = firstCol; c <= lastCol + 1; c++) {
    const x = Math.round(headerW + c * colW - scrollLeft) + 0.5;
    ctx.moveTo(x, headerH);
    ctx.lineTo(x, cssHeight);
  }
  for (let r = firstRow; r <= lastRow + 1; r++) {
    const y = Math.round(headerH + r * rowH - scrollTop) + 0.5;
    ctx.moveTo(headerW, y);
    ctx.lineTo(cssWidth, y);
  }
  ctx.stroke();

  ctx.fillStyle = COLORS.cellText;
  ctx.textAlign = 'left';
  for (let r = firstRow; r <= lastRow; r++) {
    const y = headerH + r * rowH - scrollTop;
    for (let c = firstCol; c <= lastCol; c++) {
      const text = displayValue(readCell(sheet, coordAt(view, r + 1, c + 1)).input);
      if (!text) continue;
      const x = headerW + c * colW - scrollLeft;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, colW, rowH);
      ctx.clip();
      ctx.fillText(text, x + 6, y + rowH / 2);
      ctx.restore();
    }
  }
  ctx.restore();

  // --- Top gutter: column headers (axis letter + 1-based index) ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(headerW, 0, bodyW, headerH);
  ctx.clip();
  ctx.fillStyle = COLORS.gutterBg;
  ctx.fillRect(headerW, 0, bodyW, headerH);
  ctx.textAlign = 'center';
  ctx.strokeStyle = COLORS.gutterBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = firstCol; c <= lastCol; c++) {
    const x = headerW + c * colW - scrollLeft;
    if (c === activeCol0) {
      ctx.fillStyle = COLORS.accentBg;
      ctx.fillRect(x, 0, colW, headerH);
    }
    ctx.fillStyle = c === activeCol0 ? COLORS.accent : COLORS.gutterText;
    ctx.fillText(`${colLetter}${c + 1}`, x + colW / 2, headerH / 2);
    const bx = Math.round(x) + 0.5;
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx, headerH);
  }
  ctx.stroke();
  ctx.restore();

  // --- Left gutter: row headers ---
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, headerH, headerW, bodyH);
  ctx.clip();
  ctx.fillStyle = COLORS.gutterBg;
  ctx.fillRect(0, headerH, headerW, bodyH);
  ctx.textAlign = 'center';
  ctx.strokeStyle = COLORS.gutterBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = firstRow; r <= lastRow; r++) {
    const y = headerH + r * rowH - scrollTop;
    if (r === activeRow0) {
      ctx.fillStyle = COLORS.accentBg;
      ctx.fillRect(0, y, headerW, rowH);
    }
    ctx.fillStyle = r === activeRow0 ? COLORS.accent : COLORS.gutterText;
    ctx.fillText(`${rowLetter}${r + 1}`, headerW / 2, y + rowH / 2);
    const by = Math.round(y) + 0.5;
    ctx.moveTo(0, by);
    ctx.lineTo(headerW, by);
  }
  ctx.stroke();
  ctx.restore();

  // --- Corner + gutter outlines ---
  ctx.fillStyle = COLORS.gutterBg;
  ctx.fillRect(0, 0, headerW, headerH);
  ctx.strokeStyle = COLORS.gutterBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(headerW + 0.5, 0);
  ctx.lineTo(headerW + 0.5, cssHeight);
  ctx.moveTo(0, headerH + 0.5);
  ctx.lineTo(cssWidth, headerH + 0.5);
  ctx.stroke();

  // --- Overlay: active-cell outline (§13), clipped to the body region ---
  if (activeRow0 >= 0 && activeCol0 >= 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(headerW, headerH, bodyW, bodyH);
    ctx.clip();
    const ax = headerW + activeCol0 * colW - scrollLeft;
    const ay = headerH + activeRow0 * rowH - scrollTop;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(ax) + 1, Math.round(ay) + 1, colW - 2, rowH - 2);
    ctx.restore();
  }

  ctx.restore();
}
