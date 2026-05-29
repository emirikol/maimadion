import { describe, expect, it } from 'vitest';
import {
  coordAddress,
  coordToCellKey,
  createSeedSheet,
  displayValue,
  rawToInput,
  readCellInput,
  setCell,
} from './sheet';
import type { Coord } from '../engine/types';

describe('coordToCellKey', () => {
  it('maps a full index coordinate to a stable identity key', () => {
    const sheet = createSeedSheet();
    const coord: Coord = new Map([
      ['axis-row', 1],
      ['axis-col', 1],
    ]);
    // row index 1 → axis-row-p1, col index 1 → axis-col-p1; sorted by axisId.
    expect(coordToCellKey(sheet.axes, coord)).toBe('axis-col:axis-col-p1|axis-row:axis-row-p1');
  });

  it('throws on an out-of-range index', () => {
    const sheet = createSeedSheet();
    const coord: Coord = new Map([
      ['axis-row', 999_999],
      ['axis-col', 1],
    ]);
    expect(() => coordToCellKey(sheet.axes, coord)).toThrow();
  });
});

describe('readCellInput', () => {
  const sheet = createSeedSheet();
  // Full n-D coordinate — every axis (incl. the hidden page axis) named.
  const at = (r: number, c: number, p = 1): Coord =>
    new Map([
      ['axis-row', r],
      ['axis-col', c],
      ['axis-page', p],
    ]);

  it('returns the seeded literal at a populated coordinate', () => {
    expect(readCellInput(sheet, at(1, 1))).toEqual({ kind: 'literal', raw: 'maimadion' });
    expect(readCellInput(sheet, at(3, 2))).toEqual({ kind: 'literal', raw: '42' });
  });

  it('reads a different value on another page (the navigated dimension)', () => {
    expect(readCellInput(sheet, at(1, 1, 2))).toEqual({ kind: 'literal', raw: 'page two' });
    expect(readCellInput(sheet, at(2, 2, 2))).toEqual({ kind: 'literal', raw: 'alpha' });
    // (1,1) on z=1 differs from (1,1) on z=2 — proof the page axis is part of the key.
    expect(readCellInput(sheet, at(1, 1, 1))).not.toEqual(readCellInput(sheet, at(1, 1, 2)));
  });

  it('returns empty at an unpopulated coordinate (sparse)', () => {
    expect(readCellInput(sheet, at(10, 10))).toEqual({ kind: 'empty' });
    expect(readCellInput(sheet, at(3, 2, 2))).toEqual({ kind: 'empty' }); // 42 lives only on z=1
  });
});

describe('displayValue', () => {
  it('renders each input kind', () => {
    expect(displayValue({ kind: 'empty' })).toBe('');
    expect(displayValue({ kind: 'literal', raw: '42' })).toBe('42');
    expect(displayValue({ kind: 'formula', src: '=1+2', ast: { kind: 'num', n: 3 } })).toBe('=1+2');
  });
});

describe('rawToInput', () => {
  it('maps blank text to empty and clears the cell', () => {
    expect(rawToInput('')).toEqual({ kind: 'empty' });
  });

  it('stores anything else as a literal verbatim (no formula parsing in M2)', () => {
    expect(rawToInput('42')).toEqual({ kind: 'literal', raw: '42' });
    expect(rawToInput('=1+2')).toEqual({ kind: 'literal', raw: '=1+2' });
  });
});

describe('setCell', () => {
  const at = (r: number, c: number, p = 1): Coord =>
    new Map([
      ['axis-row', r],
      ['axis-col', c],
      ['axis-page', p],
    ]);

  it('writes a literal that reads back at the same coordinate', () => {
    const sheet = createSeedSheet();
    setCell(sheet, at(10, 10), rawToInput('typed'));
    expect(readCellInput(sheet, at(10, 10))).toEqual({ kind: 'literal', raw: 'typed' });
  });

  it('overwrites an existing literal', () => {
    const sheet = createSeedSheet();
    setCell(sheet, at(1, 1), rawToInput('changed'));
    expect(readCellInput(sheet, at(1, 1))).toEqual({ kind: 'literal', raw: 'changed' });
  });

  it('clears a cell (and the sparse key) when given empty', () => {
    const sheet = createSeedSheet();
    const before = sheet.cells.size;
    setCell(sheet, at(1, 1), { kind: 'empty' });
    expect(readCellInput(sheet, at(1, 1))).toEqual({ kind: 'empty' });
    expect(sheet.cells.size).toBe(before - 1);
  });
});

describe('coordAddress', () => {
  it('renders <letter><index> per axis in axis order', () => {
    const sheet = createSeedSheet();
    // axis-row is position 0 (letter x), axis-col position 1 (letter y).
    expect(coordAddress(sheet.axes, new Map([['axis-row', 2], ['axis-col', 3]]))).toBe('x2y3');
  });
});
