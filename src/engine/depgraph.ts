// Dependency graph + recompute — mirrors tech-design §8.
//
// A *full* recompute: rebuild the formula→formula edges, evaluate in topological
// order, and mark every node in (or downstream of) a cycle #CYCLE! — never hang
// (requirements AC §4.7). The incremental, range-descriptor-driven dirtying of §8 is
// the worker's job and lands in M9; this clear placeholder gives correct "recompute
// on edit" for the in-memory slice.
//
// A *node* is any formula-bearing thing: an explicit formula cell or a formula-valued
// fiber (§9). The engine is identity-agnostic — a node is an opaque `NodeId` string,
// and the caller supplies `nodeForKey` to say which node (if any) produces the value
// at a coordinate the formulas read. That indirection is exactly §8's "a reference
// resolving into a fiber-covered coordinate registers its edge against the FlatId":
// a fiber is a single node, so editing it dirties every dependent.

import { evaluate, type Read } from './eval';
import { resolveCell, resolveRange } from './resolve';
import type { Axis, CellKey, Computed, Expr } from './types';

// A graph node's identity: a formula cell's CellKey, or a formula-valued fiber's
// FlatId (§9). Opaque to this module — only `nodeForKey` interprets it.
export type NodeId = string;

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
  /** Every formula-bearing node: explicit formula cells and formula-valued fibers (§9). */
  nodes: NodeId[];
  /** The formula AST at a node. */
  astOf: (node: NodeId) => Expr;
  axes: Axis[];
  /**
   * The node that produces the value at a coordinate the formulas read — an explicit
   * formula cell there, else a covering formula-valued fiber (§9). `undefined` for a
   * leaf (literal cell, literal fiber, or empty), whose value comes from `staticValue`.
   * A coordinate is never both explicit and fiber-covered (§9), so this is unambiguous.
   */
  nodeForKey: (key: CellKey) => NodeId | undefined;
  /**
   * The value of a non-formula coordinate (explicit literal / covering literal fiber /
   * empty). Formula nodes are valued by this recompute, not by staticValue.
   */
  staticValue: (key: CellKey) => Computed;
}

/**
 * Evaluate every formula node, returning their computed values keyed by `NodeId`. A
 * formula reads each dependency coordinate via the producing node's result (available
 * because evaluation is in topological order) or `staticValue` (leaves). Nodes in a
 * cycle — and nodes downstream of one — get #CYCLE!.
 */
export function recompute(p: RecomputeParams): Map<NodeId, Computed> {
  const N = new Set(p.nodes);

  // Edges among formula nodes only (leaf deps are read directly at eval time). A
  // node's dependencies are the producing nodes of the coordinates its formula reads.
  const deps = new Map<NodeId, NodeId[]>();
  const dependents = new Map<NodeId, NodeId[]>();
  for (const n of N) {
    const nodeDeps = new Set<NodeId>();
    for (const key of dependencyKeys(p.astOf(n), p.axes)) {
      const d = p.nodeForKey(key);
      if (d !== undefined && N.has(d)) nodeDeps.add(d);
    }
    deps.set(n, [...nodeDeps]);
    for (const g of nodeDeps) {
      if (!dependents.has(g)) dependents.set(g, []);
      dependents.get(g)!.push(n);
    }
  }

  // Kahn's algorithm: a node is ready once all its node-deps are evaluated.
  const indeg = new Map<NodeId, number>();
  const ready: NodeId[] = [];
  for (const n of N) {
    const d = deps.get(n)!.length;
    indeg.set(n, d);
    if (d === 0) ready.push(n);
  }

  const computed = new Map<NodeId, Computed>();
  // Reading a coordinate yields its producing node's computed value if there is one
  // (and it's been evaluated), else the static leaf value.
  const read: Read = (key) => {
    const n = p.nodeForKey(key);
    if (n !== undefined) {
      const c = computed.get(n);
      if (c !== undefined) return c;
    }
    return p.staticValue(key);
  };
  while (ready.length > 0) {
    const n = ready.pop()!;
    computed.set(n, evaluate(p.astOf(n), { axes: p.axes, read }));
    for (const dep of dependents.get(n) ?? []) {
      const k = indeg.get(dep)! - 1;
      indeg.set(dep, k);
      if (k === 0) ready.push(dep);
    }
  }

  // Whatever never became ready is part of, or downstream of, a cycle.
  if (computed.size < N.size) {
    for (const n of N) if (!computed.has(n)) computed.set(n, { error: '#CYCLE!' });
  }
  return computed;
}
