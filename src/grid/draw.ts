// Low-level canvas helpers: the `save → clip → … → restore` ceremony and the
// fill/text idioms that were repeated, with subtle variations, at every region and
// cell in the old `render()`. Collapsing them here removes that duplication (and the
// chance for the variations to drift) and lets the passes read as intent.

import { CELL_PAD_X } from './theme';
import type { Rect } from './types';

/** Run `fn` with the canvas clipped to `rect`, restoring the prior clip afterwards. */
export function withClip(ctx: CanvasRenderingContext2D, rect: Rect, fn: () => void): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  fn();
  ctx.restore();
}

export function fillRect(ctx: CanvasRenderingContext2D, rect: Rect, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
}

/** Left-aligned, vertically centred text, clipped to the cell so it can't bleed into
 *  the neighbour. For body values. */
export function drawCellText(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  text: string,
  color: string,
): void {
  withClip(ctx, rect, () => {
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, rect.x + CELL_PAD_X, rect.y + rect.h / 2);
  });
}

/** Centred text within a rect (no per-cell clip — the caller's region clip suffices).
 *  For the short gutter labels. */
export function fillCenteredText(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  text: string,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, rect.x + rect.w / 2, rect.y + rect.h / 2);
}
