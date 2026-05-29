// Address & storage-key codecs — mirrors docs/tech-design.md §4: the axis-letter
// scheme, the CellKey encoding (M0), and address parsing/printing (M5). The address
// scanner here is what the lexer delegates to (§5); the printer supports both the
// fully-qualified stored form and the context-elided display form (§6).

import type {
  Axis,
  CellKey,
  CellRef,
  Coord,
  PositionCoord,
  RangeRef,
  RefComponent,
} from './types';

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

// --- Address parsing & printing (§4, §6) ------------------------------------------

export class AddressError extends Error {}

/**
 * Parse a fully- or partially-qualified address into a (possibly partial) reference.
 * Each `[$]?<letter><digits>` segment names its axis by letter (so segment order is
 * free); a single segment may carry a `:` making it the range's varying axis, with
 * the §4 colon rule: after `:`, digits are the upper bound, while a letter or the end
 * of the address means "to the end of this axis" (an open bound). A partial address
 * (omitting some axes) is completed against the authoring context by {@link completeRef}
 * before storage (§6); this scanner does no completion.
 */
export function parseAddress(s: string, axes: Axis[]): CellRef | RangeRef {
  const comps: RefComponent[] = [];
  let varying: RangeRef['varying'] | null = null;
  let i = 0;

  const axisIdForLetter = (letter: string): string => {
    const pos = axisPositionForLetter(letter); // throws on a non-letter
    const axis = axes[pos];
    if (!axis) throw new AddressError(`no axis for letter "${letter}"`);
    return axis.id;
  };
  const readDollarDigits = (): { absolute: boolean; digits: string } => {
    let absolute = false;
    if (s[i] === '$') {
      absolute = true;
      i++;
    }
    const start = i;
    while (i < s.length && s[i] >= '0' && s[i] <= '9') i++;
    return { absolute, digits: s.slice(start, i) };
  };

  while (i < s.length) {
    let absolute = false;
    if (s[i] === '$') {
      absolute = true;
      i++;
    }
    const letterStart = i;
    while (i < s.length && s[i] >= 'a' && s[i] <= 'z') i++;
    const letter = s.slice(letterStart, i);
    if (letter.length < 1 || letter.length > 2) {
      throw new AddressError(`expected an axis letter at ${letterStart} in "${s}"`);
    }
    const axisId = axisIdForLetter(letter);

    const from = readDollarDigits();
    if (s[i] === ':') {
      if (varying) throw new AddressError(`a range varies on only one axis: "${s}"`);
      i++; // consume ':'
      const to = readDollarDigits();
      varying = {
        axisId,
        from: from.digits === '' ? { kind: 'open' } : { kind: 'index', index: Number(from.digits) },
        to: to.digits === '' ? { kind: 'open' } : { kind: 'index', index: Number(to.digits) },
        absFrom: absolute || from.absolute,
        absTo: to.absolute,
      };
    } else {
      if (from.digits === '') {
        throw new AddressError(`axis "${letter}" needs an index (or a ':' range) in "${s}"`);
      }
      comps.push({ axisId, index: Number(from.digits), absolute: absolute || from.absolute });
    }
  }

  if (varying) return { kind: 'range', fixed: comps, varying };
  return { kind: 'cell', comps };
}

/**
 * Complete a (possibly partial) reference against an authoring context — the active
 * cell's full coordinate — filling every unnamed axis with a relative component at
 * the context's index (§6 author→store). The result names every axis.
 */
export function completeRef<R extends CellRef | RangeRef>(ref: R, context: Coord, axes: Axis[]): R {
  const named = new Set(
    ref.kind === 'cell'
      ? ref.comps.map((c) => c.axisId)
      : [ref.varying.axisId, ...ref.fixed.map((c) => c.axisId)],
  );
  const filled: RefComponent[] = [];
  for (const axis of axes) {
    if (named.has(axis.id)) continue;
    const index = context.get(axis.id);
    if (index === undefined) continue;
    filled.push({ axisId: axis.id, index, absolute: false });
  }
  if (ref.kind === 'cell') return { ...ref, comps: [...ref.comps, ...filled] };
  return { ...ref, fixed: [...ref.fixed, ...filled] };
}

const compText = (c: RefComponent, pos: number): string =>
  `${c.absolute ? '$' : ''}${axisLetter(pos)}${c.index}`;

/**
 * Print a reference. With no `context` the output is fully qualified (the stored
 * `src` form); with a context, relative components whose index matches the context
 * are elided (the formula-bar display form, §6). The varying axis of a range is never
 * elided. Components are emitted in axis order so the §4 colon rule round-trips.
 */
export function formatRef(ref: CellRef | RangeRef, axes: Axis[], context?: Coord): string {
  const posOf = new Map(axes.map((a, p) => [a.id, p]));
  const elide = (c: RefComponent): boolean =>
    context !== undefined && !c.absolute && context.get(c.axisId) === c.index;

  if (ref.kind === 'cell') {
    return axes
      .map((axis) => {
        const c = ref.comps.find((x) => x.axisId === axis.id);
        return c && !elide(c) ? compText(c, posOf.get(axis.id)!) : '';
      })
      .join('');
  }

  const { varying } = ref;
  return axes
    .map((axis) => {
      const pos = posOf.get(axis.id)!;
      if (axis.id === varying.axisId) {
        const from = varying.from.kind === 'index' ? `${varying.absFrom ? '$' : ''}${varying.from.index}` : '';
        const to = varying.to.kind === 'index' ? `${varying.absTo ? '$' : ''}${varying.to.index}` : '';
        return `${axisLetter(pos)}${from}:${to}`;
      }
      const c = ref.fixed.find((x) => x.axisId === axis.id);
      return c && !elide(c) ? compText(c, pos) : '';
    })
    .join('');
}
