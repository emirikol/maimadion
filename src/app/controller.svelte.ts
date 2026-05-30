// Top-level orchestration for the grid — the main-thread view/interaction layer that
// composes three focused units (tech-design §10/§12/§16):
//   - DocumentStore: the document truth + the discrete-op/undo seam + the computed cache
//     (§10) — the unit the worker takes over in M9 (§11);
//   - ViewState: the projection/binding/active-cell (§12);
//   - EditState: the in-flight edit (§16).
// Every write goes through the DocumentStore's op seam, so the M9 worker swap replaces
// only that unit while the view/interaction layers — and the renderer's synchronous
// reads — stay put. `rev` is the data-change repaint signal; `navVersion` (on ViewState)
// the view-change one. Undo/redo replay the op log at logical-edit granularity; view-only
// changes (navigate/rebind) never enter it (§10).
//
// This class is a thin facade: it preserves the public surface the Svelte components and
// the e2e window API depend on, delegating each member to the unit that owns it.

import { displayFormula } from '../engine/formula';
import type { AxisId, CellInput, Coord, Flat, Index, Sheet } from '../engine/types';
import { formatComputed } from '../engine/value';
import type { Projection } from '../grid/projection';
import { DocumentStore } from '../model/document';
import {
  type CellSource,
  type CreateFlatResult,
  coordAddress,
  displayValue,
  parseInput,
} from '../model/sheet';
import { EditState, type EditSource } from './edit-state.svelte';
import { ViewState } from './view-state.svelte';

type Move = 'down' | 'up' | 'right' | 'left';

const MOVES: Record<Move, [number, number]> = {
  down: [1, 0],
  up: [-1, 0],
  right: [0, 1],
  left: [0, -1],
};

export class SheetController {
  private readonly doc: DocumentStore;
  private readonly view: ViewState;
  private readonly edit: EditState;

  // Bumped on every data change (write / undo / redo); the renderer's $effect reads it to
  // repaint and derived views (formula bar) re-read the cell. View changes signal via
  // ViewState.navVersion instead.
  rev = $state(0);

  constructor(sheet: Sheet) {
    this.doc = new DocumentStore(sheet);
    this.view = new ViewState(sheet.axes, sheet.viewport);
    this.edit = new EditState();
  }

  get sheet(): Sheet {
    return this.doc.sheet;
  }

  // --- view / projection (ViewState) -------------------------------------------
  get activeRow(): Index {
    return this.view.activeRow;
  }
  get activeCol(): Index {
    return this.view.activeCol;
  }
  get rowAxisId(): AxisId {
    return this.view.rowAxisId;
  }
  get colAxisId(): AxisId {
    return this.view.colAxisId;
  }
  get navVersion(): number {
    return this.view.navVersion;
  }
  get rowCount(): number {
    return this.view.rowCount;
  }
  get colCount(): number {
    return this.view.colCount;
  }
  get onEnsureVisible(): (() => void) | undefined {
    return this.view.onEnsureVisible;
  }
  set onEnsureVisible(fn: (() => void) | undefined) {
    this.view.onEnsureVisible = fn;
  }
  get onGridFocus(): (() => void) | undefined {
    return this.view.onGridFocus;
  }
  set onGridFocus(fn: (() => void) | undefined) {
    this.view.onGridFocus = fn;
  }

  projection(): Projection {
    return this.view.projection();
  }
  navigatedIndex(axisId: AxisId): Index {
    return this.view.navigatedIndex(axisId);
  }
  activeCoord(): Coord {
    return this.view.activeCoord();
  }

  // --- interaction / edit state (EditState) ------------------------------------
  get editing(): boolean {
    return this.edit.editing;
  }
  get editSource(): EditSource {
    return this.edit.editSource;
  }
  get editBuffer(): string {
    return this.edit.editBuffer;
  }
  set editBuffer(v: string) {
    this.edit.editBuffer = v;
  }
  get flatDialogOpen(): boolean {
    return this.edit.flatDialogOpen;
  }

  // --- reads (reactive to data writes via rev) ---------------------------------
  activeInput(): CellInput {
    void this.rev;
    return this.doc.cellInput(this.view.activeCoord());
  }
  /** What the formula bar shows/edits: a formula's elided source (§6), else the literal. */
  activeText(): string {
    const coord = this.view.activeCoord();
    void this.rev;
    const input = this.doc.cellInput(coord);
    if (input.kind === 'formula') return displayFormula(input, coord, this.sheet.axes);
    return displayValue(input);
  }
  activeAddress(): string {
    return coordAddress(this.sheet.axes, this.view.activeCoord());
  }
  /** What a grid cell shows: the computed value, plus its source for the fiber tint (§13). */
  cellDisplay(coord: Coord): { text: string; source: CellSource } {
    void this.rev;
    return {
      text: formatComputed(this.doc.computedAt(coord)),
      source: this.doc.cellRead(coord).source,
    };
  }

  // --- selection / movement (view) ---------------------------------------------
  select(row: Index, col: Index): void {
    this.view.select(row, col);
  }
  moveBy(dRow: number, dCol: number): void {
    this.view.moveBy(dRow, dCol);
  }
  home(): void {
    this.view.home();
  }
  end(): void {
    this.view.end();
  }

  // --- navigation / binding (commit any in-flight edit first, §16) -------------
  navigate(axisId: AxisId, index: number): void {
    this.commitIfEditing();
    this.view.navigate(axisId, index);
  }
  rebind(rowAxisId: AxisId, colAxisId: AxisId): void {
    this.commitIfEditing();
    this.view.rebind(rowAxisId, colAxisId);
  }
  swap(): void {
    this.commitIfEditing();
    this.view.swap();
  }

  // --- editing -----------------------------------------------------------------
  beginEdit(initial?: string, source: EditSource = 'grid'): void {
    this.edit.begin(initial ?? this.activeText(), source);
  }
  cancelEdit(): void {
    this.edit.finish();
    this.view.onGridFocus?.();
  }
  commitEdit(move?: Move): void {
    this.commitBuffer();
    if (move) this.view.moveBy(...MOVES[move]);
    this.view.onGridFocus?.();
  }
  /** Delete/Backspace on a selected cell: clear it without entering edit mode. */
  clearActive(): void {
    this.applyWrite(this.view.activeCoord(), { kind: 'empty' });
  }

  private commitIfEditing(): void {
    if (this.edit.editing) this.commitBuffer();
  }
  /**
   * Write the edit buffer to the active cell and leave edit mode (no focus move). A `=`
   * buffer parses as a formula expanded against the active coordinate (§5/§6); whether
   * the cell is plain or fibered is handled by the document's setCellAt (§9, §16).
   */
  private commitBuffer(): void {
    const coord = this.view.activeCoord();
    const input = parseInput(this.edit.editBuffer, coord, this.sheet.axes);
    this.applyWrite(coord, input);
    this.edit.finish();
  }
  private applyWrite(coord: Coord, input: CellInput): void {
    this.doc.setCellAt(coord, input);
    this.rev++;
  }

  // --- undo / redo (data-op granularity, §10) ----------------------------------
  get canUndo(): boolean {
    return this.doc.canUndo;
  }
  get canRedo(): boolean {
    return this.doc.canRedo;
  }
  undo(): void {
    if (this.doc.undo()) this.rev++;
  }
  redo(): void {
    if (this.doc.redo()) this.rev++;
  }

  // --- fibers (§9, §14) --------------------------------------------------------
  openFlatDialog(): void {
    this.edit.openDialog();
  }
  closeFlatDialog(): void {
    this.edit.closeDialog();
    this.view.onGridFocus?.();
  }

  /**
   * Define a fiber from the active cell: every axis is pinned to the active cell's
   * current index except those in `freeAxisIds`, which the fiber spans whole. The shared
   * value is `raw` — a literal, or a `=` formula expanded against the active coordinate
   * (§9). Returns the §9 invariant result so the dialog can surface an overlap or offer
   * to absorb colliding explicit cells (`absorb`).
   */
  createFiber(freeAxisIds: AxisId[], raw: string, absorb = false): CreateFlatResult {
    this.commitIfEditing();
    const coord = this.view.activeCoord();
    const pins = new Map<AxisId, Index>();
    const free = new Set<AxisId>();
    for (const axis of this.sheet.axes) {
      if (freeAxisIds.includes(axis.id)) free.add(axis.id);
      else pins.set(axis.id, coord.get(axis.id)!);
    }
    const input = parseInput(raw, coord, this.sheet.axes);
    const flat: Flat = { id: crypto.randomUUID(), pins, free, input };
    const result = this.doc.createFlat(flat, { absorb });
    if (result.ok) {
      this.rev++;
      this.edit.closeDialog();
      this.view.onGridFocus?.();
    }
    return result;
  }
}
