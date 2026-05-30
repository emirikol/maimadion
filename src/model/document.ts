// The document-edit API — mirrors tech-design §10/§11. Owns the document truth (the
// in-memory Sheet, M7) plus the undo log and the computed cache, and is the single seam
// every write passes through: build an Op, apply it, log it, recompute. This is exactly
// the boundary the worker takes over in M9 (§11) — the view/interaction layers above
// never touch the sheet directly, so that swap stays contained and the renderer keeps
// reading a synchronous cache throughout.

import { flatsOverlap } from '../engine/fiber';
import type { CellInput, CellKey, Computed, Coord, Flat, Sheet } from '../engine/types';
import { ComputedCache } from './computed';
import { apply, invert, type Op } from './ops';
import {
  type CellRead,
  type CreateFlatResult,
  coordToCellKey,
  coveredExplicitKeys,
  findCoveringFlat,
  readCell,
  readCellInput,
} from './sheet';
import { UndoLog } from './undo';

export class DocumentStore {
  readonly sheet: Sheet;
  private readonly undoLog = new UndoLog();
  private readonly computed = new ComputedCache();

  constructor(sheet: Sheet) {
    this.sheet = sheet;
    this.computed.refresh(sheet); // value the seed formulas
  }

  // --- reads --------------------------------------------------------------------
  cellRead(coord: Coord): CellRead {
    return readCell(this.sheet, coord);
  }
  cellInput(coord: Coord): CellInput {
    return readCellInput(this.sheet, coord);
  }
  computedAt(coord: Coord): Computed {
    return this.computed.at(this.sheet, coord);
  }

  // --- undo / redo --------------------------------------------------------------
  get canUndo(): boolean {
    return this.undoLog.canUndo;
  }
  get canRedo(): boolean {
    return this.undoLog.canRedo;
  }
  undo(): boolean {
    const op = this.undoLog.takeUndo();
    if (!op) return false;
    apply(this.sheet, invert(op));
    this.computed.refresh(this.sheet);
    return true;
  }
  redo(): boolean {
    const op = this.undoLog.takeRedo();
    if (!op) return false;
    apply(this.sheet, op);
    this.computed.refresh(this.sheet);
    return true;
  }

  // --- edit verbs (UI intent → Op) ---------------------------------------------
  /**
   * Write a value to a coordinate (§16). A fiber-covered coordinate edits the *whole*
   * fiber — a non-empty value changes the shared value (every covered cell updates at
   * once), an empty value removes it (§9); otherwise it is an ordinary explicit-cell
   * write. The matching prior state is captured on the op so undo is exact.
   */
  setCellAt(coord: Coord, input: CellInput): void {
    const flat = findCoveringFlat(this.sheet, coord);
    if (flat) {
      if (input.kind === 'empty') this.dispatch({ t: 'DeleteFlat', flat, absorbed: [] });
      else this.dispatch({ t: 'EditFlat', id: flat.id, input, prev: flat.input });
      return;
    }
    const key = coordToCellKey(this.sheet.axes, coord);
    const prev: CellInput = this.sheet.cells.get(key) ?? { kind: 'empty' };
    this.dispatch({ t: 'SetCell', coord, input, prev });
  }

  /**
   * Create a fiber, enforcing the §9 invariants that keep read resolution order-free:
   * an overlap with an existing fiber is always rejected; covering existing explicit
   * cells is rejected unless `absorb` is set, in which case those cells are absorbed
   * (captured on the op so undo restores them). On success it dispatches a CreateFlat.
   */
  createFlat(flat: Flat, opts: { absorb?: boolean } = {}): CreateFlatResult {
    for (const existing of this.sheet.flats) {
      if (flatsOverlap(flat, existing)) return { ok: false, reason: 'fiber-overlap' };
    }
    const keys = coveredExplicitKeys(this.sheet, flat);
    if (keys.length > 0 && !opts.absorb) {
      return { ok: false, reason: 'explicit-collision', keys };
    }
    const absorbed = keys.map((k): [CellKey, CellInput] => [k, this.sheet.cells.get(k)!]);
    this.dispatch({ t: 'CreateFlat', flat, absorbed });
    return { ok: true };
  }

  // --- the seam -----------------------------------------------------------------
  private dispatch(op: Op): void {
    apply(this.sheet, op);
    this.undoLog.record(op);
    this.computed.refresh(this.sheet);
  }
}
