import { describe, expect, it } from 'vitest';
import { encodeCellKey } from './coord';
import { dependencyKeys, recompute } from './depgraph';
import { parseFormula } from './parse';
import type { Axis, CellKey, Computed } from './types';

const AXES: Axis[] = ['x', 'y', 'z'].map((letter) => ({
  id: `a${letter}`,
  name: letter,
  positions: Array.from({ length: 6 }, (_, i) => `a${letter}-p${i + 1}`),
}));

const keyAt = (x: number, y: number, z: number): CellKey =>
  encodeCellKey(
    new Map([
      ['ax', `ax-p${x}`],
      ['ay', `ay-p${y}`],
      ['az', `az-p${z}`],
    ]),
  );

// Build a recompute from a map of formula-cell source and a map of leaf values. Each
// formula cell's node id is its own key, so a coordinate read resolves to that cell.
function run(formulas: Record<string, string>, leaves: Map<CellKey, Computed>) {
  const F = new Set(Object.keys(formulas));
  return recompute({
    nodes: Object.keys(formulas),
    astOf: (k) => parseFormula(formulas[k]!, AXES),
    axes: AXES,
    nodeForKey: (k) => (F.has(k) ? k : undefined),
    staticValue: (k) => leaves.get(k) ?? { value: { kind: 'empty' } },
  });
}

describe('dependencyKeys', () => {
  it('collects single-ref and range-member dependencies', () => {
    const ast = parseFormula('x1y1z1 + SUM(x1y1z2:4)', AXES);
    expect(new Set(dependencyKeys(ast, AXES))).toEqual(
      new Set([keyAt(1, 1, 1), keyAt(1, 1, 2), keyAt(1, 1, 3), keyAt(1, 1, 4)]),
    );
  });
});

describe('recompute — topological evaluation', () => {
  it('evaluates a dependency chain in order', () => {
    // A = B + 1, B = C + 1, C = 10 (a leaf literal).
    const A = keyAt(1, 1, 1);
    const B = keyAt(1, 1, 2);
    const C = keyAt(1, 1, 3);
    const out = run(
      { [A]: 'x1y1z2 + 1', [B]: 'x1y1z3 + 1' },
      new Map([[C, { value: { kind: 'number', n: 10 } }]]),
    );
    expect(out.get(B)).toEqual({ value: { kind: 'number', n: 11 } });
    expect(out.get(A)).toEqual({ value: { kind: 'number', n: 12 } });
  });

  it('sums a range of leaf cells', () => {
    const total = keyAt(1, 1, 1);
    const leaves = new Map<CellKey, Computed>([
      [keyAt(1, 1, 2), { value: { kind: 'number', n: 3 } }],
      [keyAt(1, 1, 3), { value: { kind: 'number', n: 4 } }],
      [keyAt(1, 1, 4), { value: { kind: 'number', n: 5 } }],
    ]);
    const out = run({ [total]: 'SUM(x1y1z2:)' }, leaves);
    expect(out.get(total)).toEqual({ value: { kind: 'number', n: 12 } });
  });
});

describe('recompute — cycles (#CYCLE!, no hang)', () => {
  it('marks a two-cell cycle', () => {
    const A = keyAt(1, 1, 1);
    const B = keyAt(1, 1, 2);
    const out = run({ [A]: 'x1y1z2', [B]: 'x1y1z1' }, new Map());
    expect(out.get(A)).toEqual({ error: '#CYCLE!' });
    expect(out.get(B)).toEqual({ error: '#CYCLE!' });
  });

  it('marks a self-reference', () => {
    const A = keyAt(1, 1, 1);
    expect(run({ [A]: 'x1y1z1 + 1' }, new Map()).get(A)).toEqual({ error: '#CYCLE!' });
  });

  it('marks a cell downstream of a cycle, but spares unrelated cells', () => {
    const A = keyAt(1, 1, 1); // cycle with B
    const B = keyAt(1, 1, 2);
    const D = keyAt(1, 1, 3); // depends on A → downstream of the cycle
    const E = keyAt(2, 2, 2); // independent leaf-math
    const out = run(
      { [A]: 'x1y1z2', [B]: 'x1y1z1', [D]: 'x1y1z1 + 1', [E]: '2 + 2' },
      new Map(),
    );
    expect(out.get(D)).toEqual({ error: '#CYCLE!' });
    expect(out.get(E)).toEqual({ value: { kind: 'number', n: 4 } });
  });
});

describe('recompute — a non-cell node participates in the graph (fiber-as-node, §8/§9)', () => {
  const number = (n: number) => ({ value: { kind: 'number', n } });

  // A fiber is a single node whose id is not a coordinate key; `nodeForKey` routes the
  // coordinates it covers to it. Here node F covers keyAt(1,1,1), and cell A reads it.
  it('routes a covered-coordinate read to the fiber node and orders through it', () => {
    const F = 'flat-F'; // a formula fiber's id (no ':' — never a CellKey)
    const A = keyAt(2, 2, 2); // a formula cell reading the fibered coordinate
    const covered = keyAt(1, 1, 1);
    const out = recompute({
      nodes: [F, A],
      astOf: (n) => parseFormula(n === F ? '10 + 5' : 'x1y1z1 + 1', AXES),
      axes: AXES,
      nodeForKey: (k) => (k === covered ? F : k === A ? A : undefined),
      staticValue: () => ({ value: { kind: 'empty' } }),
    });
    expect(out.get(F)).toEqual(number(15)); // the fiber computes once
    expect(out.get(A)).toEqual(number(16)); // A = F + 1, evaluated after F
  });

  it('marks a cycle that runs through a fiber node', () => {
    // F reads a coordinate covered by A; A reads the coordinate covered by F → cycle.
    const F = 'flat-F';
    const A = keyAt(2, 2, 2);
    const coveredByF = keyAt(1, 1, 1);
    const coveredByA = keyAt(3, 3, 3);
    const out = recompute({
      nodes: [F, A],
      astOf: (n) => parseFormula(n === F ? 'x3y3z3' : 'x1y1z1', AXES),
      axes: AXES,
      nodeForKey: (k) => (k === coveredByF ? F : k === coveredByA ? A : undefined),
      staticValue: () => ({ value: { kind: 'empty' } }),
    });
    expect(out.get(F)).toEqual({ error: '#CYCLE!' });
    expect(out.get(A)).toEqual({ error: '#CYCLE!' });
  });
});
