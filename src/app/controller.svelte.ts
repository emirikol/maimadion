// Shared interaction state for the M2 "edit literals" slice (tech-design §13/§16).
//
// Holds the active cell, the in-flight edit buffer, and a revision counter the
// canvas watches to repaint after data writes. Writes go straight to the
// in-memory sheet via setCell — the discrete-op + undo system (§10) and the
// worker-owned store (§11) replace this in M7. Grid and FormulaBar both drive and
// observe this one instance, so the formula bar truly mirrors the active cell.

import type { CellInput, Coord, Index, Sheet } from '../engine/types';
import { coordAt } from '../grid/projection';
import {
  coordAddress,
  displayValue,
  rawToInput,
  readCellInput,
  setCell,
} from '../model/sheet';

type EditSource = 'grid' | 'bar';
type Move = 'down' | 'up' | 'right' | 'left';

const MOVES: Record<Move, [number, number]> = {
  down: [1, 0],
  up: [-1, 0],
  right: [0, 1],
  left: [0, -1],
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class SheetController {
  readonly sheet: Sheet;

  activeRow = $state(1);
  activeCol = $state(1);
  editing = $state(false);
  editSource = $state<EditSource>('grid');
  editBuffer = $state('');
  // Bumped on every data write; the renderer's $effect reads it to repaint, and
  // derived views (formula bar) re-read the cell.
  rev = $state(0);

  // Registered by the Grid so active-cell changes can scroll into view / refocus.
  onEnsureVisible: (() => void) | undefined;
  onGridFocus: (() => void) | undefined;

  constructor(sheet: Sheet) {
    this.sheet = sheet;
    const { activeCoord, rowAxisId, colAxisId } = sheet.viewport;
    this.activeRow = activeCoord.get(rowAxisId) ?? 1;
    this.activeCol = activeCoord.get(colAxisId) ?? 1;
  }

  private axisOf(id: string) {
    const axis = this.sheet.axes.find((a) => a.id === id);
    if (!axis) throw new Error(`axis not found: ${id}`);
    return axis;
  }

  get rowCount(): number {
    return this.axisOf(this.sheet.viewport.rowAxisId).positions.length;
  }
  get colCount(): number {
    return this.axisOf(this.sheet.viewport.colAxisId).positions.length;
  }

  activeCoord(): Coord {
    return coordAt(this.sheet.viewport, this.activeRow, this.activeCol);
  }
  activeInput(): CellInput {
    void this.rev; // make reads reactive to writes inside an effect/derived
    return readCellInput(this.sheet, this.activeCoord());
  }
  activeText(): string {
    return displayValue(this.activeInput());
  }
  activeAddress(): string {
    return coordAddress(this.sheet.axes, this.activeCoord());
  }

  /** Move the active cell to a 1-based (row, col), clamped to the sheet. */
  select(row: Index, col: Index): void {
    this.activeRow = clamp(Math.round(row), 1, this.rowCount);
    this.activeCol = clamp(Math.round(col), 1, this.colCount);
    const view = this.sheet.viewport;
    view.activeCoord = this.activeCoord();
    view.selection = { kind: 'single', coord: new Map(view.activeCoord) };
    this.onEnsureVisible?.();
  }
  moveBy(dRow: number, dCol: number): void {
    this.select(this.activeRow + dRow, this.activeCol + dCol);
  }
  home(): void {
    this.select(this.activeRow, 1);
  }
  end(): void {
    this.select(this.activeRow, this.colCount);
  }

  beginEdit(initial?: string, source: EditSource = 'grid'): void {
    this.editBuffer = initial ?? this.activeText();
    this.editSource = source;
    this.editing = true;
  }
  cancelEdit(): void {
    this.editing = false;
    this.onGridFocus?.();
  }
  commitEdit(move?: Move): void {
    setCell(this.sheet, this.activeCoord(), rawToInput(this.editBuffer));
    this.rev++;
    this.editing = false;
    if (move) this.moveBy(...MOVES[move]);
    this.onGridFocus?.();
  }
  /** Delete/Backspace on a selected cell: clear it without entering edit mode. */
  clearActive(): void {
    setCell(this.sheet, this.activeCoord(), { kind: 'empty' });
    this.rev++;
  }
}
