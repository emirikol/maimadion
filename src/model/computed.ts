// Computed-value cache — mirrors tech-design §2/§8. Session-only derived values (never
// persisted), refreshed after each document change. A *full* recompute today (the
// placeholder for §8's incremental, range-descriptor-driven recompute, M9); kept behind
// this small surface so the recompute strategy — and its owner, once it moves into the
// worker (§11) — can change without the view layer noticing.

import type { NodeId } from '../engine/depgraph';
import type { Computed, Coord, Sheet } from '../engine/types';
import { computedAt, recomputeSheet } from './sheet';

export class ComputedCache {
  private values = new Map<NodeId, Computed>();

  /** Re-evaluate every formula node from the current sheet state. */
  refresh(sheet: Sheet): void {
    this.values = recomputeSheet(sheet);
  }

  /** The computed value shown at a coordinate (a formula node's result, or a leaf). */
  at(sheet: Sheet, coord: Coord): Computed {
    return computedAt(sheet, this.values, coord);
  }
}
