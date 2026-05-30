// Discrete document operations — mirrors tech-design §10. Every document edit is one
// invertible Op: `apply` mutates the sheet, `invert` returns the Op that exactly undoes
// it. This *is* the edit model and the undo granularity (design.md §1). Routing all
// writes through this seam (see model/document.ts) is what lets the worker own the
// document later (§11, M9) without the view layer changing.
//
// M7 covers the data ops the app issues today: SetCell and the three fiber ops. The
// structural ops (insert/delete position, axis edits) and their §3 reference adjustment
// join in M8, when the AxisPanel can issue them; view-only ops (navigate/rebind/resize,
// §10) stay off the undo stack and remain direct view-state updates.

import type { CellInput, CellKey, Coord, Flat, FlatId, Sheet } from '../engine/types';
import { editFlat, removeFlat, setCell } from './sheet';

// Each op carries the data needed to invert it (`prev`, `absorbed`). Fiber creation may
// absorb colliding explicit cells (§9); those `[key, input]` pairs travel on the op so
// undo restores them exactly.
export type Op =
  | { t: 'SetCell'; coord: Coord; input: CellInput; prev: CellInput }
  | { t: 'CreateFlat'; flat: Flat; absorbed: Array<[CellKey, CellInput]> }
  | { t: 'EditFlat'; id: FlatId; input: CellInput; prev: CellInput }
  | { t: 'DeleteFlat'; flat: Flat; absorbed: Array<[CellKey, CellInput]> };

/** Apply an op to the sheet in place. Total over the Op union. */
export function apply(sheet: Sheet, op: Op): void {
  switch (op.t) {
    case 'SetCell':
      setCell(sheet, op.coord, op.input);
      return;
    case 'CreateFlat':
      for (const [key] of op.absorbed) sheet.cells.delete(key); // absorb: fiber value wins
      sheet.flats.push(op.flat);
      return;
    case 'EditFlat':
      editFlat(sheet, op.id, op.input);
      return;
    case 'DeleteFlat':
      removeFlat(sheet, op.flat.id);
      for (const [key, input] of op.absorbed) sheet.cells.set(key, input); // restore absorbed
      return;
  }
}

/** The op that exactly undoes `op`. `apply(sheet, invert(op))` reverses `apply(sheet, op)`. */
export function invert(op: Op): Op {
  switch (op.t) {
    case 'SetCell':
      return { t: 'SetCell', coord: op.coord, input: op.prev, prev: op.input };
    case 'CreateFlat':
      return { t: 'DeleteFlat', flat: op.flat, absorbed: op.absorbed };
    case 'EditFlat':
      return { t: 'EditFlat', id: op.id, input: op.prev, prev: op.input };
    case 'DeleteFlat':
      return { t: 'CreateFlat', flat: op.flat, absorbed: op.absorbed };
  }
}
