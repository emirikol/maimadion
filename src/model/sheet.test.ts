import { describe, expect, it } from 'vitest';
import { coordToCellKey, createSeedSheet, displayValue, readCellInput } from './sheet';
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
  const at = (r: number, c: number): Coord =>
    new Map([
      ['axis-row', r],
      ['axis-col', c],
    ]);

  it('returns the seeded literal at a populated coordinate', () => {
    expect(readCellInput(sheet, at(1, 1))).toEqual({ kind: 'literal', raw: 'maimadion' });
    expect(readCellInput(sheet, at(3, 2))).toEqual({ kind: 'literal', raw: '42' });
  });

  it('returns empty at an unpopulated coordinate (sparse)', () => {
    expect(readCellInput(sheet, at(10, 10))).toEqual({ kind: 'empty' });
  });
});

describe('displayValue', () => {
  it('renders each input kind', () => {
    expect(displayValue({ kind: 'empty' })).toBe('');
    expect(displayValue({ kind: 'literal', raw: '42' })).toBe('42');
    expect(displayValue({ kind: 'formula', src: '=1+2', ast: { kind: 'num', n: 3 } })).toBe('=1+2');
  });
});
