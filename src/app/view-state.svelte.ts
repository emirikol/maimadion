// View/projection state — mirrors tech-design §12. Owns which axes are bound to the
// visible row/column, the navigated position of every hidden axis, and the active cell
// on the screen. Rebinding or navigating never mutates data (§12): it changes only which
// slice projects onto the screen, and the active cell follows the screen. `navVersion`
// is the view-change repaint signal (data changes signal via the controller's `rev`).
// Each change mirrors back onto the document's `viewport` so the persisted/worker truth
// (§§10–11, §15) stays accurate while the controller is the live source.

import type { Axis, AxisId, Coord, Index, ViewportBinding } from '../engine/types';
import { coordAt, type Projection } from '../grid/projection';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class ViewState {
  private readonly axes: Axis[];
  private readonly viewport: ViewportBinding;

  activeRow = $state(1);
  activeCol = $state(1);
  // The visible binding (§12). Reactive so rebinding re-projects the whole view.
  rowAxisId = $state<AxisId>('');
  colAxisId = $state<AxisId>('');
  // Navigated index per axis, kept for every axis (the entry for a currently-visible
  // axis is ignored by projection and reused if it later becomes hidden, so flipping
  // an axis on/off the screen restores where you were). Plain Map + a reactive counter,
  // bumped on every navigate/rebind.
  private readonly nav = new Map<AxisId, Index>();
  navVersion = $state(0);

  // Registered by the Grid so active-cell changes can scroll into view / refocus.
  onEnsureVisible: (() => void) | undefined;
  onGridFocus: (() => void) | undefined;

  constructor(axes: Axis[], viewport: ViewportBinding) {
    this.axes = axes;
    this.viewport = viewport;
    this.rowAxisId = viewport.rowAxisId;
    this.colAxisId = viewport.colAxisId;
    this.activeRow = viewport.activeCoord.get(viewport.rowAxisId) ?? 1;
    this.activeCol = viewport.activeCoord.get(viewport.colAxisId) ?? 1;
    for (const axis of axes) this.nav.set(axis.id, viewport.navigated.get(axis.id) ?? 1);
  }

  private axisOf(id: AxisId): Axis {
    const axis = this.axes.find((a) => a.id === id);
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

  /** Mirror the live view state back onto the document's viewport (§§10–11, §15). */
  private sync(): void {
    const v = this.viewport;
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
    this.sync();
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
   * (row, col); only the slice behind it changes.
   */
  navigate(axisId: AxisId, index: number): void {
    this.nav.set(axisId, this.clampToAxis(axisId, index));
    this.navVersion++;
    this.sync();
  }

  /**
   * Bind the visible row/column axes (§12, §14). Axes must stay distinct. The active
   * cell follows the screen: its (row, col) are kept (clamped to the new axes). Any axis
   * pushed off-screen navigates to the position the active cell had on it, so the visible
   * slice still contains where you were.
   */
  rebind(rowAxisId: AxisId, colAxisId: AxisId): void {
    if (rowAxisId === colAxisId) return;
    const prev = this.activeCoord(); // full coord before the rebind
    this.rowAxisId = rowAxisId;
    this.colAxisId = colAxisId;
    for (const axis of this.axes) {
      if (axis.id === rowAxisId || axis.id === colAxisId) continue;
      const at = prev.get(axis.id);
      if (at !== undefined) this.nav.set(axis.id, this.clampToAxis(axis.id, at));
    }
    this.navVersion++;
    this.activeRow = clamp(this.activeRow, 1, this.rowCount);
    this.activeCol = clamp(this.activeCol, 1, this.colCount);
    this.sync();
    this.onEnsureVisible?.();
    this.onGridFocus?.();
  }
  /** Swap the row and column axes (§14). */
  swap(): void {
    this.rebind(this.colAxisId, this.rowAxisId);
  }
}
