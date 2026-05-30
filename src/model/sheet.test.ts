import { describe, expect, it } from 'vitest';
import {
  computedAt,
  coordAddress,
  coordToCellKey,
  coveredExplicitKeys,
  createFlat,
  createSeedSheet,
  displayValue,
  editFlat,
  parseInput,
  rawToInput,
  readCell,
  readCellInput,
  recomputeSheet,
  removeFlat,
  setCell,
} from './sheet';
import type { Coord, Flat } from '../engine/types';

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

// Full n-D coordinate helper for the 3-axis seed.
const at = (r: number, c: number, p = 1): Coord =>
  new Map([
    ['axis-row', r],
    ['axis-col', c],
    ['axis-page', p],
  ]);

describe('readCell (order-free resolution: explicit → fiber → empty)', () => {
  const sheet = createSeedSheet();

  it('returns explicit values with source "explicit"', () => {
    expect(readCell(sheet, at(1, 1))).toEqual({
      input: { kind: 'literal', raw: 'maimadion' },
      source: 'explicit',
    });
  });

  it('resolves the seeded column fiber across every row, with source "flat"', () => {
    // The seed fiber pins col 12 / page 1, free on rows → same value in any row.
    expect(readCell(sheet, at(1, 12))).toEqual({
      input: { kind: 'literal', raw: 'shared' },
      source: 'flat',
    });
    expect(readCell(sheet, at(40, 12))).toEqual({
      input: { kind: 'literal', raw: 'shared' },
      source: 'flat',
    });
  });

  it('does not extend the fiber past its pinned axes', () => {
    expect(readCell(sheet, at(1, 12, 2)).source).toBe('empty'); // pinned to page 1
    expect(readCell(sheet, at(1, 11)).source).toBe('empty'); // pinned to col 12
  });
});

describe('createFlat invariants (§9)', () => {
  const newFlat = (id: string, pins: [string, number][], free: string[], raw: string): Flat => ({
    id,
    pins: new Map(pins),
    free: new Set(free),
    input: { kind: 'literal', raw },
  });

  it('creates a non-colliding fiber', () => {
    const sheet = createSeedSheet();
    const flat = newFlat('f1', [['axis-col', 13], ['axis-page', 1]], ['axis-row'], 'hdr');
    expect(createFlat(sheet, flat)).toEqual({ ok: true });
    expect(readCellInput(sheet, at(7, 13))).toEqual({ kind: 'literal', raw: 'hdr' });
  });

  it('rejects a fiber overlapping the seeded one (no override)', () => {
    const sheet = createSeedSheet();
    // Same column/page as the seed fiber → shares coordinates.
    const flat = newFlat('f2', [['axis-col', 12], ['axis-page', 1]], ['axis-row'], 'clash');
    expect(createFlat(sheet, flat)).toEqual({ ok: false, reason: 'fiber-overlap' });
    expect(sheet.flats).toHaveLength(2); // unchanged: the two seed fibers
  });

  it('rejects a fiber covering explicit cells, then absorbs them on overwrite', () => {
    const sheet = createSeedSheet();
    // Free on rows, col 1, page 1 → covers explicit (1,1)="maimadion".
    const flat = newFlat('f3', [['axis-col', 1], ['axis-page', 1]], ['axis-row'], 'label');
    const blocked = createFlat(sheet, flat);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok && blocked.reason === 'explicit-collision') {
      expect(blocked.keys.length).toBeGreaterThan(0);
    } else {
      throw new Error('expected explicit-collision');
    }
    // Overwrite: the colliding explicit cell is absorbed (deleted); the fiber wins.
    expect(createFlat(sheet, flat, { absorb: true })).toEqual({ ok: true });
    expect(readCell(sheet, at(1, 1))).toEqual({
      input: { kind: 'literal', raw: 'label' },
      source: 'flat',
    });
  });
});

describe('coveredExplicitKeys', () => {
  it('lists exactly the explicit cells inside a fiber coverage', () => {
    const sheet = createSeedSheet();
    setCell(sheet, at(3, 20), rawToInput('a'));
    setCell(sheet, at(9, 20), rawToInput('b'));
    setCell(sheet, at(9, 21), rawToInput('c')); // different column — not covered
    const flat: Flat = {
      id: 'cov',
      pins: new Map([['axis-col', 20], ['axis-page', 1]]),
      free: new Set(['axis-row']),
      input: { kind: 'literal', raw: 'x' },
    };
    const keys = coveredExplicitKeys(sheet, flat);
    expect(new Set(keys)).toEqual(
      new Set([coordToCellKey(sheet.axes, at(3, 20)), coordToCellKey(sheet.axes, at(9, 20))]),
    );
  });
});

describe('editFlat / removeFlat', () => {
  it('editing a fiber updates every covered cell at once', () => {
    const sheet = createSeedSheet();
    editFlat(sheet, 'flat-seed-col', { kind: 'literal', raw: 'renamed' });
    expect(readCellInput(sheet, at(1, 12))).toEqual({ kind: 'literal', raw: 'renamed' });
    expect(readCellInput(sheet, at(50, 12))).toEqual({ kind: 'literal', raw: 'renamed' });
  });

  it('removing a fiber reverts its coordinates to empty', () => {
    const sheet = createSeedSheet();
    removeFlat(sheet, 'flat-seed-col');
    expect(readCell(sheet, at(1, 12)).source).toBe('empty');
    expect(sheet.flats.find((f) => f.id === 'flat-seed-col')).toBeUndefined();
    expect(sheet.flats).toHaveLength(1); // the M6 formula fiber remains
  });
});

describe('parseInput', () => {
  const sheet = createSeedSheet();
  it('maps blank → empty, plain text → literal, "=" → formula', () => {
    expect(parseInput('', at(1, 1), sheet.axes)).toEqual({ kind: 'empty' });
    expect(parseInput('42', at(1, 1), sheet.axes)).toEqual({ kind: 'literal', raw: '42' });
    expect(parseInput('=1+2', at(1, 1), sheet.axes)).toMatchObject({ kind: 'formula' });
  });
  it('stores a malformed formula as an error formula (#NAME?)', () => {
    expect(parseInput('=oops(', at(1, 1), sheet.axes)).toMatchObject({
      kind: 'formula',
      ast: { kind: 'error', code: '#NAME?' },
    });
  });
});

describe('formulas: recompute + computedAt', () => {
  const number = (n: number) => ({ value: { kind: 'number', n } });

  it('values the seeded SUM over a 1-D range and its dependent product', () => {
    const sheet = createSeedSheet();
    const computed = recomputeSheet(sheet);
    expect(computedAt(sheet, computed, at(13, 1))).toEqual(number(600)); // SUM(100,200,300)
    expect(computedAt(sheet, computed, at(14, 1))).toEqual(number(1200)); // = SUM * 2
  });

  it('recomputes dependents in order when a referenced cell changes', () => {
    const sheet = createSeedSheet();
    setCell(sheet, at(10, 1), { kind: 'literal', raw: '150' }); // was 100
    const computed = recomputeSheet(sheet);
    expect(computedAt(sheet, computed, at(13, 1))).toEqual(number(650));
    expect(computedAt(sheet, computed, at(14, 1))).toEqual(number(1300));
  });

  it('surfaces #DIV/0! and a circular reference as #CYCLE!', () => {
    const sheet = createSeedSheet();
    setCell(sheet, at(20, 1), parseInput('=1/0', at(20, 1), sheet.axes));
    setCell(sheet, at(21, 1), parseInput('=x22y1z1', at(21, 1), sheet.axes));
    setCell(sheet, at(22, 1), parseInput('=x21y1z1', at(22, 1), sheet.axes));
    const computed = recomputeSheet(sheet);
    expect(computedAt(sheet, computed, at(20, 1))).toEqual({ error: '#DIV/0!' });
    expect(computedAt(sheet, computed, at(21, 1))).toEqual({ error: '#CYCLE!' });
    expect(computedAt(sheet, computed, at(22, 1))).toEqual({ error: '#CYCLE!' });
  });

  it('reads a fibered cell from inside a formula', () => {
    const sheet = createSeedSheet();
    // The seed fiber holds the text "shared" down column 12; a formula referencing a
    // numeric fiber would sum it — here we just confirm the fiber value is readable.
    editFlat(sheet, 'flat-seed-col', { kind: 'literal', raw: '50' });
    setCell(sheet, at(30, 1), parseInput('=x1y12z1 + 5', at(30, 1), sheet.axes));
    const computed = recomputeSheet(sheet);
    expect(computedAt(sheet, computed, at(30, 1))).toEqual(number(55));
  });
});

describe('M6: formula-valued fibers (fiber-as-node, §9)', () => {
  const number = (n: number) => ({ value: { kind: 'number', n } });

  it('computes the seeded formula fiber once and shares it down the spanned axis', () => {
    const sheet = createSeedSheet();
    const computed = recomputeSheet(sheet);
    // Column 9, page 1, free on rows: the column-1 SUM (600) held constant down it.
    expect(computedAt(sheet, computed, at(1, 9))).toEqual(number(600));
    expect(computedAt(sheet, computed, at(40, 9))).toEqual(number(600));
    expect(readCell(sheet, at(40, 9)).source).toBe('flat'); // a fiber, not an explicit cell
    // The seeded reader x16y1z1 = x1y9z1 + 1 follows the fiber.
    expect(computedAt(sheet, computed, at(16, 1))).toEqual(number(601));
  });

  it('recomputes the fiber and its readers when a dependency of its formula changes', () => {
    const sheet = createSeedSheet();
    setCell(sheet, at(10, 1), { kind: 'literal', raw: '150' }); // 100 → 150 lifts the SUM to 650
    const computed = recomputeSheet(sheet);
    expect(computedAt(sheet, computed, at(13, 1))).toEqual(number(650)); // the SUM
    expect(computedAt(sheet, computed, at(1, 9))).toEqual(number(650)); // the fiber follows
    expect(computedAt(sheet, computed, at(16, 1))).toEqual(number(651)); // the reader follows
  });

  it('turns a literal fiber into a formula fiber when its value is edited to a formula', () => {
    const sheet = createSeedSheet();
    // Give the column-12 "shared" fiber a formula instead: half the column-1 SUM.
    editFlat(sheet, 'flat-seed-col', parseInput('=x13y1z1 / 2', at(1, 12), sheet.axes));
    const computed = recomputeSheet(sheet);
    expect(computedAt(sheet, computed, at(1, 12))).toEqual(number(300)); // 600 / 2
    expect(computedAt(sheet, computed, at(50, 12))).toEqual(number(300)); // held down the column
    expect(readCell(sheet, at(50, 12)).source).toBe('flat'); // still a single fiber
  });

  it('recomputes a formula that reads a fibered cell when the fiber input changes', () => {
    const sheet = createSeedSheet();
    editFlat(sheet, 'flat-seed-col', parseInput('=40 + 2', at(1, 12), sheet.axes)); // fiber = 42
    setCell(sheet, at(30, 1), parseInput('=x1y12z1 + 8', at(30, 1), sheet.axes)); // reads the fiber
    expect(computedAt(sheet, recomputeSheet(sheet), at(30, 1))).toEqual(number(50));
    // Change the fiber's formula → the reader recomputes.
    editFlat(sheet, 'flat-seed-col', parseInput('=100', at(1, 12), sheet.axes));
    expect(computedAt(sheet, recomputeSheet(sheet), at(30, 1))).toEqual(number(108));
  });

  it('reports a cycle running through a fiber as #CYCLE! without hanging', () => {
    const sheet = createSeedSheet();
    // The fiber's formula reads x50y1z1; that cell reads the fibered column 12 → cycle.
    editFlat(sheet, 'flat-seed-col', parseInput('=x50y1z1', at(1, 12), sheet.axes));
    setCell(sheet, at(50, 1), parseInput('=x1y12z1', at(50, 1), sheet.axes));
    const computed = recomputeSheet(sheet);
    expect(computedAt(sheet, computed, at(1, 12))).toEqual({ error: '#CYCLE!' });
    expect(computedAt(sheet, computed, at(50, 1))).toEqual({ error: '#CYCLE!' });
  });
});
