// Core types — mirrors docs/tech-design.md §2.
//
// Pure: no DOM or Svelte imports. This file (and the rest of engine/, save the
// future worker entry) is the Rust/WASM port candidate, so it stays free of any
// platform dependency. Discriminated unions stand in for what would be Rust enums.

export type AxisId = string; // opaque stable id (e.g. nanoid)
export type PositionId = string; // opaque stable id
export type FlatId = string; // a fiber's id ("fiber" is user-facing; code uses Flat)
export type Index = number; // 1-based position index within an axis

export interface Position {
  id: PositionId;
}

export interface Axis {
  id: AxisId;
  name: string; // human-readable, renameable; never a key
  positions: PositionId[]; // ordered; 1-based index i ↔ positions[i - 1]
}

// Two distinct notions of "a coordinate" (the §1 spine):
//   - Coord: index-based, the world references live in (relative/absolute math).
//   - PositionCoord: identity-based, the world the cell store and persistence
//     live in (stable across structural edits and renames).
// The resolver maps Coord → PositionCoord via each axis's ordered position list.
export type Coord = Map<AxisId, Index>;
export type PositionCoord = Map<AxisId, PositionId>;

// Canonical string encoding of a PositionCoord; the sparse cell-store key and the
// persisted key. See coord.ts for the encoding.
export type CellKey = string;

export type CellInput =
  | { kind: 'empty' }
  | { kind: 'literal'; raw: string } // number or text, as typed
  | { kind: 'formula'; src: string; ast: Expr }; // src is fully-qualified (§6)

export type CellValue =
  | { kind: 'empty' }
  | { kind: 'number'; n: number }
  | { kind: 'text'; s: string };

export type CellError = '#REF!' | '#DIV/0!' | '#CYCLE!' | '#NAME?' | '#VALUE!';

// Session-only, derived — never persisted.
export type Computed = { value: CellValue } | { error: CellError };

// References are index-based (the §1 spine).
export interface RefComponent {
  axisId: AxisId;
  index: Index;
  absolute: boolean;
}

export interface CellRef {
  kind: 'cell';
  comps: RefComponent[]; // names every axis exactly once
}

export type Bound = { kind: 'index'; index: Index } | { kind: 'open' }; // open = start/end of axis

export interface RangeRef {
  kind: 'range';
  fixed: RefComponent[]; // every axis except the varying one
  varying: {
    axisId: AxisId;
    from: Bound;
    to: Bound;
    absFrom: boolean;
    absTo: boolean;
  };
}

export type Expr =
  | { kind: 'num'; n: number }
  | { kind: 'str'; s: string }
  | { kind: 'unary'; op: '-'; arg: Expr }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; l: Expr; r: Expr }
  | { kind: 'call'; fn: string; args: Expr[] }
  | { kind: 'ref'; ref: CellRef }
  | { kind: 'rangeRef'; ref: RangeRef };

// "Fiber" is the user-facing term; in code the technical name is `Flat` (a.k.a.
// AffineFlat — an axis-aligned affine subspace). Identifiers never say "fiber".
// One shared value across one or more entire axes (§9); every axis is in exactly
// one of pins/free.
export interface Flat {
  id: FlatId;
  pins: Map<AxisId, Index>; // axes pinned to one position
  free: Set<AxisId>; // axes spanned across their whole extent
  input: CellInput; // one shared input (literal or formula)
}

// §16: a 1-D region (one varying visible axis), a single coordinate, or a block
// spanning both visible axes (valid for copy/paste/bulk edit, not as a range ref).
export type Selection =
  | { kind: 'single'; coord: Coord }
  | { kind: 'range'; fixed: Coord; axisId: AxisId; from: Index; to: Index }
  | {
      kind: 'block';
      fixed: Coord; // the non-visible axes
      rowAxisId: AxisId;
      colAxisId: AxisId;
      rowFrom: Index;
      rowTo: Index;
      colFrom: Index;
      colTo: Index;
    };

export interface ViewportBinding {
  rowAxisId: AxisId;
  colAxisId: AxisId; // distinct from rowAxisId
  navigated: Map<AxisId, Index>; // every other axis → its navigated position
  activeCoord: Coord;
  selection: Selection;
  scroll: { row: number; col: number }; // index offsets per visible axis
}

// The v1 document is a single Sheet.
export interface Sheet {
  axes: Axis[]; // ordered — axis order assigns address letters (§4); not reorderable in v1
  cells: Map<CellKey, CellInput>; // sparse
  flats: Flat[];
  viewport: ViewportBinding;
  headerSizes: Map<AxisId, Map<PositionId, number>>; // per-position pixel sizes
}
