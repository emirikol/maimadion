// Shared interaction state for the grid (tech-design §12/§13/§16).
//
// Owns the active cell, the in-flight edit buffer, and — new in M3 — the reactive
// viewport binding: which axes are on the visible row/column, and the navigated
// position of every hidden axis. Rebinding or navigating never mutates data (§12):
// it only changes which slice projects onto the screen, and the active cell follows
// the screen. Two revision counters drive repaint/re-read: `rev` on data writes,
// `navVersion` on view (binding/navigation) changes. Writes still go straight to the
// in-memory sheet — the discrete-op + undo system (§10) and the worker-owned store
// (§11) replace that in M7.
//
// M4 adds fibers: an edit on a fiber-covered cell edits the whole fiber, and the
// FlatDialog defines new ones from the active cell (§9, §14).

import type { AxisId, CellInput, Coord, Flat, Index, Sheet } from '../engine/types';
import { coordAt, type Projection } from '../grid/projection';
import {
  coordAddress,
  createFlat,
  type CreateFlatResult,
  displayValue,
  editFlat,
  findCoveringFlat,
  rawToInput,
  readCellInput,
  removeFlat,
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

  // The visible binding (§12). Reactive so rebinding re-projects the whole view.
  rowAxisId = $state<AxisId>('');
  colAxisId = $state<AxisId>('');
  // Navigated index per axis, kept for every axis (the entry for a currently-visible
  // axis is ignored by projection and reused if it later becomes hidden, so flipping
  // an axis on/off the screen restores where you were). Plain Map + a reactive
  // counter, mirroring the `rev` pattern; bumped on every navigate/rebind.
  private readonly nav = new Map<AxisId, Index>();
  navVersion = $state(0);

  // Whether the "define a constant (fiber)" dialog is open (§14 FlatDialog).
  flatDialogOpen = $state(false);

  // Registered by the Grid so active-cell changes can scroll into view / refocus.
  onEnsureVisible: (() => void) | undefined;
  onGridFocus: (() => void) | undefined;

  constructor(sheet: Sheet) {
    this.sheet = sheet;
    const { activeCoord, rowAxisId, colAxisId, navigated } = sheet.viewport;
    this.rowAxisId = rowAxisId;
    this.colAxisId = colAxisId;
    this.activeRow = activeCoord.get(rowAxisId) ?? 1;
    this.activeCol = activeCoord.get(colAxisId) ?? 1;
    for (const axis of sheet.axes) {
      this.nav.set(axis.id, navigated.get(axis.id) ?? 1);
    }
  }

  private axisOf(id: AxisId) {
    const axis = this.sheet.axes.find((a) => a.id === id);
    if (!axis) throw new Error(`axis not found: ${id}`);
    return axis;
  }
  private clampToAxis(axisId: AxisId, index: number): Index {
    return clamp(Math.round(index), 1, this.axisOf(axisId).positions.length);
  }

  get rowCount(): number {
    return this.axisOf(this.rowAxisId).positions.length;
  }
  get colCount(): number {
    return this.axisOf(this.colAxisId).positions.length;
  }

  /** The current visible binding + navigated positions (reactive to view changes). */
  projection(): Projection {
    void this.navVersion; // make projection reads reactive to navigation
    const navigated: Coord = new Map();
    for (const [id, idx] of this.nav) navigated.set(id, idx);
    return { rowAxisId: this.rowAxisId, colAxisId: this.colAxisId, navigated };
  }
  /** The navigated index on a hidden axis (reactive). */
  navigatedIndex(axisId: AxisId): Index {
    void this.navVersion;
    return this.nav.get(axisId) ?? 1;
  }

  activeCoord(): Coord {
    return coordAt(this.projection(), this.activeRow, this.activeCol);
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

  /**
   * Push the reactive view state back onto sheet.viewport so the persisted/worker
   * truth (§§10–11, §15) stays accurate even while the controller is the live
   * source. View-only ops are persisted but never enter the undo log (§10).
   */
  private syncViewport(): void {
    const v = this.sheet.viewport;
    v.rowAxisId = this.rowAxisId;
    v.colAxisId = this.colAxisId;
    v.navigated = this.projection().navigated;
    v.activeCoord = this.activeCoord();
    v.selection = { kind: 'single', coord: new Map(v.activeCoord) };
  }

  /** Move the active cell to a 1-based (row, col), clamped to the sheet. */
  select(row: Index, col: Index): void {
    this.activeRow = clamp(Math.round(row), 1, this.rowCount);
    this.activeCol = clamp(Math.round(col), 1, this.colCount);
    this.syncViewport();
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

  /**
   * Navigate a hidden axis to a position (§12). The active cell stays on its screen
   * (row, col); only the slice behind it changes. Commits any in-flight edit first
   * (§16) so it lands on the cell being edited, not the new slice.
   */
  navigate(axisId: AxisId, index: number): void {
    if (this.editing) this.commitBuffer();
    this.nav.set(axisId, this.clampToAxis(axisId, index));
    this.navVersion++;
    this.syncViewport();
  }

  /**
   * Bind the visible row/column axes (§12, §14). Axes must stay distinct. The active
   * cell follows the screen: its (row, col) are kept (clamped to the new axes). Any
   * axis pushed off-screen navigates to the position the active cell had on it, so
   * the visible slice still contains where you were.
   */
  rebind(rowAxisId: AxisId, colAxisId: AxisId): void {
    if (rowAxisId === colAxisId) return;
    if (this.editing) this.commitBuffer();
    const prev = this.activeCoord(); // full coord before the rebind
    this.rowAxisId = rowAxisId;
    this.colAxisId = colAxisId;
    for (const axis of this.sheet.axes) {
      if (axis.id === rowAxisId || axis.id === colAxisId) continue;
      const at = prev.get(axis.id);
      if (at !== undefined) this.nav.set(axis.id, this.clampToAxis(axis.id, at));
    }
    this.navVersion++;
    this.activeRow = clamp(this.activeRow, 1, this.rowCount);
    this.activeCol = clamp(this.activeCol, 1, this.colCount);
    this.syncViewport();
    this.onEnsureVisible?.();
    this.onGridFocus?.();
  }
  /** Swap the row and column axes (§14). */
  swap(): void {
    this.rebind(this.colAxisId, this.rowAxisId);
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
  /**
   * Write a value to a coordinate (§16). If the coordinate is covered by a fiber, the
   * write edits the *whole fiber* — a non-empty value changes the shared value (every
   * covered cell updates at once), an empty value removes the fiber. This is why
   * editing any member updates the whole fiber, and why a per-cell explicit override
   * of a fibered coordinate can't be created (a non-goal, §9). Otherwise it's an
   * ordinary explicit-cell write.
   */
  private write(coord: Coord, input: CellInput): void {
    const flat = findCoveringFlat(this.sheet, coord);
    if (flat) {
      if (input.kind === 'empty') removeFlat(this.sheet, flat.id);
      else editFlat(this.sheet, flat.id, input);
    } else {
      setCell(this.sheet, coord, input);
    }
    this.rev++;
  }

  /** Write the edit buffer to the active cell and leave edit mode (no focus move). */
  private commitBuffer(): void {
    this.write(this.activeCoord(), rawToInput(this.editBuffer));
    this.editing = false;
  }
  commitEdit(move?: Move): void {
    this.commitBuffer();
    if (move) this.moveBy(...MOVES[move]);
    this.onGridFocus?.();
  }
  /** Delete/Backspace on a selected cell: clear it without entering edit mode. */
  clearActive(): void {
    this.write(this.activeCoord(), { kind: 'empty' });
  }

  // --- Fibers (§9, §14) ---------------------------------------------------------

  openFlatDialog(): void {
    this.flatDialogOpen = true;
  }
  closeFlatDialog(): void {
    this.flatDialogOpen = false;
    this.onGridFocus?.();
  }

  /**
   * Define a fiber from the active cell: every axis is pinned to the active cell's
   * current index except those in `freeAxisIds`, which the fiber spans whole. The
   * shared value is `raw`. Returns the §9 invariant result so the dialog can surface
   * an overlap or offer to absorb colliding explicit cells (`absorb`).
   */
  createFiber(freeAxisIds: AxisId[], raw: string, absorb = false): CreateFlatResult {
    if (this.editing) this.commitBuffer();
    const coord = this.activeCoord();
    const pins = new Map<AxisId, Index>();
    const free = new Set<AxisId>();
    for (const axis of this.sheet.axes) {
      if (freeAxisIds.includes(axis.id)) free.add(axis.id);
      else pins.set(axis.id, coord.get(axis.id)!);
    }
    const flat: Flat = { id: crypto.randomUUID(), pins, free, input: rawToInput(raw) };
    const result = createFlat(this.sheet, flat, { absorb });
    if (result.ok) {
      this.rev++;
      this.flatDialogOpen = false;
      this.onGridFocus?.();
    }
    return result;
  }
}
