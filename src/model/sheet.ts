// In-memory document — the placeholder the renderer reads directly.
//
// Stays DOM-free (this is destined for the worker later). The read path is the
// order-free resolution chain of §9: explicit cell → covering fiber → empty. Fiber
// `input`s are literals in M4; formula evaluation and fibers as dependency-graph
// nodes arrive in M5/M6. The writes here are still direct mutations (placeholder for
// the §10 discrete-op + undo system and the §11 worker-owned store, both M7).

import { axisLetter, decodeCellKey, encodeCellKey } from '../engine/coord';
import { covers, flatsOverlap } from '../engine/fiber';
import type {
  Axis,
  CellInput,
  CellKey,
  Coord,
  Flat,
  FlatId,
  PositionCoord,
  Sheet,
  ViewportBinding,
} from '../engine/types';

function makeAxis(id: string, name: string, count: number): Axis {
  return {
    id,
    name,
    positions: Array.from({ length: count }, (_, i) => `${id}-p${i + 1}`),
  };
}

/** Map an index-based Coord to the identity-based storage key (§1 spine). */
export function coordToCellKey(axes: Axis[], coord: Coord): CellKey {
  const pc: PositionCoord = new Map();
  for (const axis of axes) {
    const index = coord.get(axis.id);
    if (index === undefined) continue;
    const posId = axis.positions[index - 1];
    if (posId === undefined) {
      throw new Error(`index ${index} out of range on axis ${axis.id}`);
    }
    pc.set(axis.id, posId);
  }
  return encodeCellKey(pc);
}

// Where a cell's value comes from — drives the renderer's fiber affordance (§13).
export type CellSource = 'explicit' | 'flat' | 'empty';

export interface CellRead {
  input: CellInput;
  source: CellSource;
}

/** The unique fiber covering a coordinate, if any (§9 keeps it at most one). */
export function findCoveringFlat(sheet: Sheet, coord: Coord): Flat | undefined {
  return sheet.flats.find((flat) => covers(flat, coord));
}

/**
 * Order-free read resolution (§9): an explicit cell wins, else the covering fiber's
 * value, else empty. The create-time invariants (see {@link createFlat}) guarantee a
 * coordinate is never both explicit and fibered, so no precedence beyond this is
 * needed and the order of the two checks is immaterial.
 */
export function readCell(sheet: Sheet, coord: Coord): CellRead {
  const explicit = sheet.cells.get(coordToCellKey(sheet.axes, coord));
  if (explicit) return { input: explicit, source: 'explicit' };
  const flat = findCoveringFlat(sheet, coord);
  if (flat) return { input: flat.input, source: 'flat' };
  return { input: { kind: 'empty' }, source: 'empty' };
}

export function readCellInput(sheet: Sheet, coord: Coord): CellInput {
  return readCell(sheet, coord).input;
}

/**
 * Turn the raw text a user typed into a cell input. M2 is literals only:
 * blank clears the cell (empty), anything else is stored verbatim as a literal.
 * Formula recognition (a leading `=`) arrives with the engine in M5.
 */
export function rawToInput(raw: string): CellInput {
  return raw === '' ? { kind: 'empty' } : { kind: 'literal', raw };
}

/**
 * M2 placeholder write: mutate the in-memory cell store directly. The real
 * discrete-op + undo system (§10) and the worker-owned store (§11) replace this
 * in M7. Writing `empty` deletes the key so the store stays sparse.
 */
export function setCell(sheet: Sheet, coord: Coord, input: CellInput): void {
  const key = coordToCellKey(sheet.axes, coord);
  if (input.kind === 'empty') sheet.cells.delete(key);
  else sheet.cells.set(key, input);
}

/** Decode a storage key back to the index-based coordinate it names (inverse of §1). */
function cellKeyToCoord(sheet: Sheet, key: CellKey): Coord {
  const pc: PositionCoord = decodeCellKey(key);
  const coord: Coord = new Map();
  for (const axis of sheet.axes) {
    const posId = pc.get(axis.id);
    if (posId === undefined) continue;
    const idx = axis.positions.indexOf(posId);
    if (idx >= 0) coord.set(axis.id, idx + 1);
  }
  return coord;
}

/** The explicit cells that fall inside a fiber's coverage (the absorb candidates). */
export function coveredExplicitKeys(sheet: Sheet, flat: Flat): CellKey[] {
  const keys: CellKey[] = [];
  for (const key of sheet.cells.keys()) {
    if (covers(flat, cellKeyToCoord(sheet, key))) keys.push(key);
  }
  return keys;
}

export type CreateFlatResult =
  | { ok: true }
  | { ok: false; reason: 'fiber-overlap' }
  | { ok: false; reason: 'explicit-collision'; keys: CellKey[] };

/**
 * Create a fiber, enforcing the §9 invariants that keep read resolution order-free:
 *  - overlapping an existing fiber is always rejected (no override);
 *  - covering existing explicit cells is rejected unless `absorb` is set, in which
 *    case those explicit cells are deleted and the fiber's value wins.
 * Placeholder for the §10 `CreateFlat` op (M7); on success the fiber is appended.
 */
export function createFlat(
  sheet: Sheet,
  flat: Flat,
  opts: { absorb?: boolean } = {},
): CreateFlatResult {
  for (const existing of sheet.flats) {
    if (flatsOverlap(flat, existing)) return { ok: false, reason: 'fiber-overlap' };
  }
  const collisions = coveredExplicitKeys(sheet, flat);
  if (collisions.length > 0 && !opts.absorb) {
    return { ok: false, reason: 'explicit-collision', keys: collisions };
  }
  for (const key of collisions) sheet.cells.delete(key); // absorb: fiber value wins (§9)
  sheet.flats.push(flat);
  return { ok: true };
}

/** Change a fiber's shared value — every covered cell updates at once (§9). */
export function editFlat(sheet: Sheet, id: FlatId, input: CellInput): void {
  const flat = sheet.flats.find((f) => f.id === id);
  if (flat) flat.input = input;
}

/** Remove a fiber; its covered coordinates revert to empty. */
export function removeFlat(sheet: Sheet, id: FlatId): void {
  sheet.flats = sheet.flats.filter((f) => f.id !== id);
}

/**
 * Fully-qualified display address for a coordinate: `<letter><index>` per axis in
 * axis order, e.g. `x2y3`. Letters come from the axis-position codec (§4). Axes
 * absent from the coord are skipped (none are, for a full coordinate).
 */
export function coordAddress(axes: Axis[], coord: Coord): string {
  return axes
    .map((axis, position) => {
      const index = coord.get(axis.id);
      return index === undefined ? '' : `${axisLetter(position)}${index}`;
    })
    .join('');
}

/** The string a cell shows. M1 has no evaluation, so a formula shows its source. */
export function displayValue(input: CellInput): string {
  switch (input.kind) {
    case 'empty':
      return '';
    case 'literal':
      return input.raw;
    case 'formula':
      return input.src;
  }
}

/**
 * A small n-axis seed, to put first pixels and the first n-D feature on screen.
 * Three axes: `row` (letter x), `col` (letter y), and `page` (letter z) — the third
 * is hidden behind a slider navigator (§14). Each page layer holds distinct
 * literals so dragging the slider visibly changes the slice (the M3 demo). The
 * z=1 layer keeps the original M1/M2 literals so those slices look unchanged.
 *
 * It also seeds one literal fiber (M4): a value held constant down a whole column
 * — `free` on the row axis, pinned to column 12 on page 1 — so the column reads the
 * same in every row, and editing any of those cells updates them all.
 */
export function createSeedSheet(): Sheet {
  const row = makeAxis('axis-row', 'rows', 100);
  const col = makeAxis('axis-col', 'cols', 26);
  const page = makeAxis('axis-page', 'pages', 5);
  const axes = [row, col, page];

  const cells = new Map<CellKey, CellInput>();
  const put = (rowIndex: number, colIndex: number, pageIndex: number, raw: string) => {
    const coord: Coord = new Map([
      [row.id, rowIndex],
      [col.id, colIndex],
      [page.id, pageIndex],
    ]);
    cells.set(coordToCellKey(axes, coord), { kind: 'literal', raw });
  };
  // z=1 — the original M1/M2 literals.
  put(1, 1, 1, 'maimadion');
  put(3, 2, 1, '42');
  put(5, 4, 1, '3.14159');
  put(2, 6, 1, 'hello');
  put(8, 3, 1, 'sparse grid');
  // z=2..5 — distinct per-layer content so navigating is unmistakable.
  put(1, 1, 2, 'page two');
  put(2, 2, 2, 'alpha');
  put(4, 4, 2, 'beta');
  put(6, 1, 2, 'gamma');
  put(1, 1, 3, 'page three');
  put(3, 3, 3, 'x marks');
  put(5, 5, 3, 'deep');
  put(1, 1, 4, 'page four');
  put(2, 2, 4, '2026');
  put(1, 1, 5, 'page five');
  put(4, 2, 5, 'last layer');

  const viewport: ViewportBinding = {
    rowAxisId: row.id,
    colAxisId: col.id,
    navigated: new Map([[page.id, 1]]),
    activeCoord: new Map([
      [row.id, 1],
      [col.id, 1],
      [page.id, 1],
    ]),
    selection: {
      kind: 'single',
      coord: new Map([
        [row.id, 1],
        [col.id, 1],
        [page.id, 1],
      ]),
    },
    scroll: { row: 0, col: 0 },
  };

  // A literal fiber: column y12, page 1, held constant across every row.
  const columnLabel: Flat = {
    id: 'flat-seed-col',
    pins: new Map([
      [col.id, 12],
      [page.id, 1],
    ]),
    free: new Set([row.id]),
    input: { kind: 'literal', raw: 'shared' },
  };

  return { axes, cells, flats: [columnLabel], viewport, headerSizes: new Map() };
}
