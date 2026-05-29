// Fibers (`Flat`) — pure logic, mirrors tech-design §9. A fiber holds one shared
// value constant across one or more *entire* axes (never a sub-range, design.md §6):
// `pins` fix some axes to a single index, `free` spans the rest whole. Every axis is
// in exactly one of the two. No DOM/Svelte — this is Rust/WASM-port territory.
//
// M4 covers coverage + the create-time invariants that keep read resolution
// order-free. A fiber's `input` is a literal in M4; formula-valued fibers and their
// dependency-graph participation arrive in M6.

import type { Coord, Flat } from './types';

/**
 * Whether an (index-based) coordinate is covered by a fiber: it matches on every
 * pinned axis (free axes match anything). The coord must name every pinned axis —
 * full coordinates from the projection always do.
 */
export function covers(flat: Flat, coord: Coord): boolean {
  for (const [axisId, index] of flat.pins) {
    if (coord.get(axisId) !== index) return false;
  }
  return true;
}

/**
 * Whether two fibers share any coordinate. A shared coordinate must satisfy both
 * fibers' pins; on an axis only one pins, the other (free) accepts that pin, and an
 * axis both leave free accepts anything. So they overlap iff every axis they *both*
 * pin agrees — a single disagreeing shared pin makes them disjoint (e.g. two fibers
 * pinned to different pages). Used to reject overlapping fibers at create time (§9),
 * which is what makes a coordinate covered by at most one fiber.
 */
export function flatsOverlap(a: Flat, b: Flat): boolean {
  for (const [axisId, index] of a.pins) {
    const other = b.pins.get(axisId);
    if (other !== undefined && other !== index) return false;
  }
  return true;
}
