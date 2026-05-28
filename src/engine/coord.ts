// Address & storage-key codecs — mirrors docs/tech-design.md §4 (the parts in M0:
// the axis-letter scheme and the CellKey encoding). Address-string parsing lives
// in the lexer/parser (a later milestone), not here.

import type { CellKey, PositionCoord } from './types';

// Axis letters (§4 / design.md §3): x, y, z, m, n first (the conventional
// mathematical axis letters), then the remaining lowercase letters
// alphabetically, then two-letter names. The mapping is positional in the sheet's
// axis list; since axes are not reorderable, a letter is stable for a sheet's life.
const PRIORITY = ['x', 'y', 'z', 'm', 'n'];
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
const SINGLE: readonly string[] = [
  ...PRIORITY,
  ...ALPHABET.filter((c) => !PRIORITY.includes(c)),
];
const A = 'a'.charCodeAt(0);

/**
 * The address letter for a 0-based axis position (its index in the sheet's axis
 * list). Positions 0–25 use the single-letter scheme above; 26+ use two-letter
 * names `aa, ab, … zz` (standard a–z ordering for the overflow). Beyond `zz`
 * throws — a codec limit, not a policy cap; extend if a sheet ever needs >702 axes.
 */
export function axisLetter(position: number): string {
  if (!Number.isInteger(position) || position < 0) {
    throw new Error(`axis position must be a non-negative integer, got ${position}`);
  }
  if (position < SINGLE.length) return SINGLE[position]!;
  const j = position - SINGLE.length;
  if (j < 26 * 26) {
    return String.fromCharCode(A + Math.floor(j / 26)) + String.fromCharCode(A + (j % 26));
  }
  throw new Error(`axis position ${position} exceeds the codec's two-letter range`);
}

/** Inverse of {@link axisLetter}: the 0-based axis position for an address letter. */
export function axisPositionForLetter(letter: string): number {
  if (/^[a-z]$/.test(letter)) {
    const i = SINGLE.indexOf(letter);
    if (i < 0) throw new Error(`unreachable: single letter not in table: ${letter}`);
    return i;
  }
  if (/^[a-z]{2}$/.test(letter)) {
    const first = letter.charCodeAt(0) - A;
    const second = letter.charCodeAt(1) - A;
    return SINGLE.length + first * 26 + second;
  }
  throw new Error(`not a valid axis letter: ${JSON.stringify(letter)}`);
}

// CellKey: canonical string form of a PositionCoord — axisIds sorted, each pair
// rendered "axisId:posId", joined by "|". Axis/position ids are opaque url-safe
// tokens (no ':' or '|'), so the encoding is unambiguous. Sorting makes the key
// independent of insertion order, so two equal coordinates always collide.
const PAIR_SEP = '|';
const KV_SEP = ':';

export function encodeCellKey(coord: PositionCoord): CellKey {
  return [...coord.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([axisId, posId]) => `${axisId}${KV_SEP}${posId}`)
    .join(PAIR_SEP);
}

export function decodeCellKey(key: CellKey): PositionCoord {
  const coord: PositionCoord = new Map();
  if (key === '') return coord;
  for (const part of key.split(PAIR_SEP)) {
    const i = part.indexOf(KV_SEP);
    if (i < 0) throw new Error(`malformed CellKey segment: ${JSON.stringify(part)}`);
    coord.set(part.slice(0, i), part.slice(i + 1));
  }
  return coord;
}
