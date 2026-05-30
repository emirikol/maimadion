// Dependency graph + recompute — mirrors tech-design §8, keyed by CellKey (identity).
//
// M5 does a *full* recompute: rebuild the formula→formula edges, evaluate in
// topological order, and mark every cell in (or downstream of) a cycle #CYCLE! —
// never hang (requirements AC §4.7). The incremental, range-descriptor-driven
// dirtying of §8 (and fibers as nodes, §9) is the worker's job and lands in M6/M7;
// this clear placeholder gives correct "recompute on edit" for the in-memory slice.

import { evaluate, type Read } from './eval';
import { resolveCell, resolveRange } from './resolve';
import type { Axis, CellKey, Computed, Expr } from './types';

/** Every storage key a formula reads — single refs and materialized range members. */
export function dependencyKeys(expr: Expr, axes: Axis[]): CellKey[] {
  const keys: CellKey[] = [];
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case 'ref': {
        const k = resolveCell(e.ref, axes);
        if (k !== '#REF!') keys.push(k);
        break;
      }
      case 'rangeRef': {
        const ks = resolveRange(e.ref, axes);
        if (ks !== '#REF!') keys.push(...ks);
        break;
      }
      case 'unary':
        walk(e.arg);
        break;
      case 'binary':
        walk(e.l);
        walk(e.r);
        break;
      case 'call':
        e.args.forEach(walk);
        break;
      // num / str / error contribute no dependencies
    }
  };
  walk(expr);
  return keys;
}

export interface RecomputeParams {
  formulaKeys: CellKey[];
  astOf: (key: CellKey) => Expr;
  axes: Axis[];
  // The value of a non-formula cell at a key (explicit literal / covering fiber /
  // empty). Formula cells are valued by this recompute, not by staticValue.
  staticValue: (key: CellKey) => Computed;
}

/**
 * Evaluate every formula cell, returning their computed values. A formula reads its
 * dependencies via `staticValue` (leaves) or this recompute's own results (other
 * formulas, available because evaluation is in topological order). Cells in a cycle —
 * and cells downstream of one — get #CYCLE!.
 */
export function recompute(p: RecomputeParams): Map<CellKey, Computed> {
  const F = new Set(p.formulaKeys);

  // Edges among formula cells only (leaf deps are read directly at eval time).
  const deps = new Map<CellKey, CellKey[]>();
  const dependents = new Map<CellKey, CellKey[]>();
  for (const f of F) {
    const formulaDeps = [...new Set(dependencyKeys(p.astOf(f), p.axes))].filter((k) => F.has(k));
    deps.set(f, formulaDeps);
    for (const g of formulaDeps) {
      if (!dependents.has(g)) dependents.set(g, []);
      dependents.get(g)!.push(f);
    }
  }

  // Kahn's algorithm: a formula is ready once all its formula-deps are evaluated.
  const indeg = new Map<CellKey, number>();
  const ready: CellKey[] = [];
  for (const f of F) {
    const d = deps.get(f)!.length;
    indeg.set(f, d);
    if (d === 0) ready.push(f);
  }

  const computed = new Map<CellKey, Computed>();
  const read: Read = (key) => computed.get(key) ?? p.staticValue(key);
  while (ready.length > 0) {
    const f = ready.pop()!;
    computed.set(f, evaluate(p.astOf(f), { axes: p.axes, read }));
    for (const dep of dependents.get(f) ?? []) {
      const n = indeg.get(dep)! - 1;
      indeg.set(dep, n);
      if (n === 0) ready.push(dep);
    }
  }

  // Whatever never became ready is part of, or downstream of, a cycle.
  if (computed.size < F.size) {
    for (const f of F) if (!computed.has(f)) computed.set(f, { error: '#CYCLE!' });
  }
  return computed;
}
