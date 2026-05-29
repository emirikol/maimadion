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
 * A small 2-axis sheet with a few literals, to put first pixels on screen.
 * Rows are bound to axis `row` (letter x), columns to axis `col` (letter y).
 */
export function createSeedSheet(): Sheet {
  const row = makeAxis('axis-row', 'rows', 100);
  const col = makeAxis('axis-col', 'cols', 26);
  const axes = [row, col];

  const cells = new Map<CellKey, CellInput>();
  const put = (rowIndex: number, colIndex: number, raw: string) => {
    const coord: Coord = new Map([
      [row.id, rowIndex],
      [col.id, colIndex],
    ]);
    cells.set(coordToCellKey(axes, coord), { kind: 'literal', raw });
  };
  put(1, 1, 'maimadion');
  put(3, 2, '42');
  put(5, 4, '3.14159');
  put(2, 6, 'hello');
  put(8, 3, 'sparse grid');

  const viewport: ViewportBinding = {
    rowAxisId: row.id,
    colAxisId: col.id,
    navigated: new Map(),
    activeCoord: new Map([
      [row.id, 1],
      [col.id, 1],
    ]),
    selection: {
      kind: 'single',
      coord: new Map([
        [row.id, 1],
        [col.id, 1],
      ]),
    },
    scroll: { row: 0, col: 0 },
  };

  return { axes, cells, flats: [], viewport, headerSizes: new Map() };
}
