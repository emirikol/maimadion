// Resolver — mirrors tech-design §6. Maps an index-based reference to the
// identity-based storage key(s) it names (the §1 spine), via each axis's ordered
// position list. A component whose index is out of range yields #REF!. A range
// resolves to the ordered list of member keys, walking the varying axis from→to with
// open bounds clamped to the axis ends. References reaching here are expected to be
// fully qualified (completed against context, §6); a missing axis is treated as #REF!.

import { encodeCellKey } from './coord';
import type { Axis, AxisId, Bound, CellKey, CellRef, PositionCoord, RangeRef } from './types';

export const REF_ERROR = '#REF!' as const;
export type RefError = typeof REF_ERROR;

const axisById = (axes: Axis[], id: AxisId) => axes.find((a) => a.id === id);

export function resolveCell(ref: CellRef, axes: Axis[]): CellKey | RefError {
  const pc: PositionCoord = new Map();
  for (const axis of axes) {
    const comp = ref.comps.find((c) => c.axisId === axis.id);
    if (!comp) return REF_ERROR; // a full ref names every axis
    const posId = axis.positions[comp.index - 1];
    if (posId === undefined) return REF_ERROR;
    pc.set(axis.id, posId);
  }
  return encodeCellKey(pc);
}

export function resolveRange(ref: RangeRef, axes: Axis[]): CellKey[] | RefError {
  const varyingAxis = axisById(axes, ref.varying.axisId);
  if (!varyingAxis) return REF_ERROR;
  const len = varyingAxis.positions.length;

  // Fixed components resolve once; they must cover every non-varying axis.
  const fixed: PositionCoord = new Map();
  for (const axis of axes) {
    if (axis.id === ref.varying.axisId) continue;
    const comp = ref.fixed.find((c) => c.axisId === axis.id);
    if (!comp) return REF_ERROR;
    const posId = axis.positions[comp.index - 1];
    if (posId === undefined) return REF_ERROR;
    fixed.set(axis.id, posId);
  }

  // Open bounds clamp to the axis ends; an explicit bound out of range is #REF!.
  const inRange = (b: Bound) => b.kind !== 'index' || (b.index >= 1 && b.index <= len);
  if (!inRange(ref.varying.from) || !inRange(ref.varying.to)) return REF_ERROR;
  const from = ref.varying.from.kind === 'index' ? ref.varying.from.index : 1;
  const to = ref.varying.to.kind === 'index' ? ref.varying.to.index : len;

  const keys: CellKey[] = [];
  for (let idx = from; idx <= to; idx++) {
    const pc = new Map(fixed);
    pc.set(ref.varying.axisId, varyingAxis.positions[idx - 1]!);
    keys.push(encodeCellKey(pc));
  }
  return keys; // a reversed (from > to) range yields no members
}
