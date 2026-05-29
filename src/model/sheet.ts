// In-memory document for M1 — the placeholder the renderer reads directly.
//
// Stays DOM-free (this is destined for the worker later). The read path here is a
// deliberate placeholder: explicit literals only. The real resolution chain
// (explicit → covering Flat → empty), formula evaluation, and #REF! arrive with
// M4–M6; until then there are no formulas or flats in the seed.

import { axisLetter, encodeCellKey } from '../engine/coord';
import type {
  Axis,
  CellInput,
  CellKey,
  Coord,
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

/** M1 placeholder read: explicit cell, else empty. No flats/formulas yet. */
export function readCellInput(sheet: Sheet, coord: Coord): CellInput {
  return sheet.cells.get(coordToCellKey(sheet.axes, coord)) ?? { kind: 'empty' };
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

  return { axes, cells, flats: [], viewport, headerSizes: new Map() };
}
