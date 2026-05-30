import { describe, expect, it } from 'vitest';
import type { Coord, Flat } from '../engine/types';
import { DocumentStore } from './document';
import { apply, invert, type Op } from './ops';
import { createSeedSheet } from './sheet';

// Full n-D coordinate helper for the 3-axis seed (row/col/page).
const at = (r: number, c: number, p = 1): Coord =>
  new Map([
    ['axis-row', r],
    ['axis-col', c],
    ['axis-page', p],
  ]);
const number = (n: number) => ({ value: { kind: 'number', n } });

describe('ops: apply / invert', () => {
  it('invert(SetCell) swaps input and prev', () => {
    const op: Op = {
      t: 'SetCell',
      coord: at(1, 1),
      input: { kind: 'literal', raw: 'b' },
      prev: { kind: 'literal', raw: 'a' },
    };
    expect(invert(op)).toEqual({
      t: 'SetCell',
      coord: at(1, 1),
      input: { kind: 'literal', raw: 'a' },
      prev: { kind: 'literal', raw: 'b' },
    });
  });

  it('apply then apply(invert) restores the sheet (SetCell round-trip)', () => {
    const sheet = createSeedSheet();
    const op: Op = {
      t: 'SetCell',
      coord: at(2, 3),
      input: { kind: 'literal', raw: 'typed' },
      prev: { kind: 'empty' },
    };
    apply(sheet, op);
    expect(sheet.cells.has('axis-col:axis-col-p3|axis-page:axis-page-p1|axis-row:axis-row-p2')).toBe(
      true,
    );
    apply(sheet, invert(op));
    expect(sheet.cells.has('axis-col:axis-col-p3|axis-page:axis-page-p1|axis-row:axis-row-p2')).toBe(
      false,
    );
  });
});

describe('DocumentStore: SetCell undo/redo', () => {
  it('undoes a fresh literal back to empty, then redoes it', () => {
    const doc = new DocumentStore(createSeedSheet());
    doc.setCellAt(at(2, 3), { kind: 'literal', raw: 'hello' });
    expect(doc.cellInput(at(2, 3))).toEqual({ kind: 'literal', raw: 'hello' });

    expect(doc.undo()).toBe(true);
    expect(doc.cellInput(at(2, 3))).toEqual({ kind: 'empty' });

    expect(doc.redo()).toBe(true);
    expect(doc.cellInput(at(2, 3))).toEqual({ kind: 'literal', raw: 'hello' });
  });

  it('restores the previous literal when an overwrite is undone', () => {
    const doc = new DocumentStore(createSeedSheet());
    // (1,1) holds the seed literal "maimadion".
    doc.setCellAt(at(1, 1), { kind: 'literal', raw: 'changed' });
    expect(doc.cellInput(at(1, 1))).toEqual({ kind: 'literal', raw: 'changed' });
    doc.undo();
    expect(doc.cellInput(at(1, 1))).toEqual({ kind: 'literal', raw: 'maimadion' });
  });

  it('tracks canUndo/canRedo and a fresh edit clears the redo branch', () => {
    const doc = new DocumentStore(createSeedSheet());
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);

    doc.setCellAt(at(2, 3), { kind: 'literal', raw: 'a' });
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(false);

    doc.undo();
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(true);

    // A new edit discards the redo branch.
    doc.setCellAt(at(2, 4), { kind: 'literal', raw: 'b' });
    expect(doc.canRedo).toBe(false);
    expect(doc.redo()).toBe(false);
  });
});

describe('DocumentStore: undo reflected in computed values', () => {
  it('recomputes dependents after undo/redo of a SUM member', () => {
    const doc = new DocumentStore(createSeedSheet());
    expect(doc.computedAt(at(13, 1))).toEqual(number(600)); // =SUM(x10:12) over 100,200,300

    doc.setCellAt(at(10, 1), { kind: 'literal', raw: '150' }); // 100 → 150
    expect(doc.computedAt(at(13, 1))).toEqual(number(650));
    expect(doc.computedAt(at(14, 1))).toEqual(number(1300)); // = SUM * 2

    doc.undo();
    expect(doc.computedAt(at(13, 1))).toEqual(number(600));
    expect(doc.computedAt(at(14, 1))).toEqual(number(1200));
  });
});

describe('DocumentStore: fiber ops undo/redo', () => {
  it('edits a fibered cell (EditFlat) and undoes the shared value', () => {
    const doc = new DocumentStore(createSeedSheet());
    // Column 12 / page 1 is the seeded "shared" literal fiber, free down the rows.
    doc.setCellAt(at(5, 12), { kind: 'literal', raw: 'renamed' });
    expect(doc.cellInput(at(1, 12))).toEqual({ kind: 'literal', raw: 'renamed' });
    doc.undo();
    expect(doc.cellInput(at(1, 12))).toEqual({ kind: 'literal', raw: 'shared' });
  });

  it('emptying a fibered cell deletes the fiber (DeleteFlat) and undo restores it', () => {
    const doc = new DocumentStore(createSeedSheet());
    doc.setCellAt(at(5, 12), { kind: 'empty' });
    expect(doc.cellRead(at(1, 12)).source).toBe('empty');
    doc.undo();
    expect(doc.cellRead(at(1, 12)).source).toBe('flat');
    expect(doc.cellInput(at(1, 12))).toEqual({ kind: 'literal', raw: 'shared' });
  });

  it('rejects an overlapping fiber and reports collisions before absorbing', () => {
    const doc = new DocumentStore(createSeedSheet());
    // Free on rows, col 6, page 1 → covers the explicit (2,6)="hello".
    const flat: Flat = {
      id: 'f-cov',
      pins: new Map([
        ['axis-col', 6],
        ['axis-page', 1],
      ]),
      free: new Set(['axis-row']),
      input: { kind: 'literal', raw: 'label' },
    };
    const blocked = doc.createFlat(flat);
    expect(blocked).toMatchObject({ ok: false, reason: 'explicit-collision' });
    if (!blocked.ok && blocked.reason === 'explicit-collision') {
      expect(blocked.keys.length).toBe(1);
    }
  });

  it('absorbs colliding explicit cells on CreateFlat, and undo restores them', () => {
    const doc = new DocumentStore(createSeedSheet());
    const flat: Flat = {
      id: 'f-cov',
      pins: new Map([
        ['axis-col', 6],
        ['axis-page', 1],
      ]),
      free: new Set(['axis-row']),
      input: { kind: 'literal', raw: 'label' },
    };
    expect(doc.createFlat(flat, { absorb: true })).toEqual({ ok: true });
    expect(doc.cellRead(at(2, 6))).toEqual({ input: { kind: 'literal', raw: 'label' }, source: 'flat' });

    doc.undo(); // removes the fiber and restores the absorbed explicit cell
    expect(doc.cellRead(at(2, 6))).toEqual({
      input: { kind: 'literal', raw: 'hello' },
      source: 'explicit',
    });

    doc.redo(); // re-absorbs
    expect(doc.cellRead(at(2, 6)).source).toBe('flat');
  });
});
