# Technical Design

Status: pre-implementation. This is the layer **below `technology.md` and above
code**: concrete types, the operation set, the worker RPC contract, the parser
grammar and AST, eval/depgraph algorithms, fiber/coordinate encoding, the
persistence schema, and the renderer architecture. It is meant to be buildable
from directly, without re-deriving decisions.

Reads on top of `requirements.md` (what), `design.md` (conceptual model),
`technology.md` (stack), and `worked-example.md` (validation). Where those leave
a gap or a surface tension, this document resolves it explicitly and says so.
Code samples are illustrative TypeScript; the constraint that matters is the
shape (discriminated unions, identity vs. index keying), kept Rust-enum-ready per
`technology.md`.

---

## 1. The spine: reference (index) vs. storage (identity)

`design.md` §2/§5 model coordinates and references on **1-based position index**
(relative/absolute `$` is per-component index arithmetic). `technology.md`
persistence says the document is **identity-keyed** (axis-id, position-id) to
round-trip across renames/reorders. These pull in opposite directions on the
surface. The resolution — the backbone the rest of the design hangs off — is to
**factor them apart**:

- **Formula references** are index-based: per axis `{ axisId, index, absolute }`.
  Relative/absolute copy and range arithmetic are then plain offset math, exactly
  as a spreadsheet user expects.
- **The cell store and the persisted document** are keyed by stable identity: an
  ordered tuple of `PositionId` per axis. Storage and on-disk form round-trip
  across structural edits and across renames.
- **Resolution** (the read path) maps each reference component's `index` →
  `PositionId` via the axis's ordered position list, producing the storage key.
  An index out of range, or a component whose position was deleted, yields
  `#REF!`.

```
formula AST ref:  {axisId:Y, index:2, abs:false}{axisId:Z, index:4, abs:false}
                        │  resolve: index → PositionId via axis order
                        ▼
storage CellKey:  (Y→pos#a91)(Z→pos#c07)          ← sparse map & persistence key
```

This satisfies both source docs at once: references stay positional (so `$`,
relative copy, and ranges behave), while storage stays identity-keyed (so
persistence round-trips). It also localizes structural-edit complexity to one
place — see §3.

---

## 2. Core types

All in `engine/` (pure) unless noted. Discriminated unions everywhere a Rust enum
would go.

```ts
type AxisId     = string;   // opaque stable id (e.g. nanoid)
type PositionId = string;   // opaque stable id
type FlatId     = string;
type Index      = number;   // 1-based position index within an axis

interface Position { id: PositionId }            // a slot; its label is ordinary cell data
interface Axis {
  id: AxisId;
  name: string;                                  // renameable; never a key
  positions: PositionId[];                       // ordered; index i (1-based) ↔ positions[i-1]
}

// Storage / dependency / persistence key: identity tuple, axis-order independent.
// Canonical string form for map keys: axisIds sorted, "axisId:posId" joined by "|".
type CellKey = string;                           // canonical encoding of Map<AxisId,PositionId>

type CellInput =
  | { kind: "empty" }
  | { kind: "literal"; raw: string }             // number or text, as typed
  | { kind: "formula"; src: string; ast: Expr }; // src is fully-qualified (see §6)

type CellValue =
  | { kind: "empty" }
  | { kind: "number"; n: number }
  | { kind: "text"; s: string };

type CellError = "#REF!" | "#DIV/0!" | "#CYCLE!" | "#NAME?" | "#VALUE!";

type Computed = { value: CellValue } | { error: CellError };   // session-only, derived

// References are index-based (the spine, §1).
interface RefComponent { axisId: AxisId; index: Index; absolute: boolean }
interface CellRef  { kind: "cell";  comps: RefComponent[] }     // names every axis exactly once
interface RangeRef {
  kind: "range";
  fixed: RefComponent[];                          // every axis except the varying one
  varying: { axisId: AxisId; from: Bound; to: Bound; absFrom: boolean; absTo: boolean };
}
type Bound = { kind: "index"; index: Index } | { kind: "open" };  // open = start/end of axis

type Expr =
  | { kind: "num"; n: number }
  | { kind: "str"; s: string }
  | { kind: "unary"; op: "-"; arg: Expr }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; l: Expr; r: Expr }
  | { kind: "call"; fn: string; args: Expr[] }
  | { kind: "ref"; ref: CellRef }
  | { kind: "rangeRef"; ref: RangeRef };

interface Flat {                                  // a fiber (user-facing) — code name is stable
  id: FlatId;
  pins: Map<AxisId, Index>;                       // axes pinned to one position
  free: Set<AxisId>;                              // axes spanned across their whole extent
  input: CellInput;                               // one shared input (literal or formula)
}                                                 // every axis appears in exactly one of pins/free

interface ViewportBinding {
  rowAxisId: AxisId;
  colAxisId: AxisId;                              // distinct from rowAxisId
  navigated: Map<AxisId, Index>;                  // every other axis → its navigated position
  activeCoord: Map<AxisId, Index>;
  selection: Selection;                           // §16
  scroll: { row: number; col: number };           // index offsets per visible axis
}
```

`DependencyGraph` (session, derived) is two reverse-indexed maps plus a
range-edge side table — see §8. None of `CellValue`/`Computed`/`DependencyGraph`
is persisted.

The **document** in v1 is one `Sheet`: `{ axes: Axis[], cells: Map<CellKey,
CellInput>, flats: Flat[], viewport: ViewportBinding, headerSizes }`. `axes` is
ordered — axis order assigns the address letters (§4) and is not reorderable in
v1.

---

## 3. Structural edits: reference adjustment and `#REF!`

Because references are index-based but storage is identity-keyed (§1), each
structural op touches the two layers differently. This is the only place the two
keyings interact, by design.

**Insert position** at index `k` on axis `A`:
- *Storage:* splice a fresh `PositionId` into `A.positions` at `k`. Cells (keyed
  by id) are untouched — none move.
- *References:* in every stored formula AST, any `RefComponent`/`Bound` on axis
  `A` with `index >= k` shifts `+1`. **Both relative and absolute components
  shift** — `$` protects against *copy*, not against structural insert, matching
  established spreadsheets. Open bounds are unaffected.

**Delete position** at index `k` on axis `A`:
- *Storage:* remove `A.positions[k-1]`; drop every cell whose `CellKey` contains
  that `PositionId`; drop/trim fibers pinned to it (a fiber pinned to the deleted
  position is deleted; a fiber free on `A` is unaffected).
- *References:* a component on `A` with `index === k` can no longer resolve → the
  whole reference becomes `#REF!` and the AST node is marked dead (re-display
  shows `#REF!` in that component). Components with `index > k` shift `-1`. A
  range whose span collapses to empty becomes `#REF!`.

**Append axis / rename axis / delete axis:** appending adds an axis to the end of
`axes` and rebuilds every cell key onto its first position (each populated cell
gains the new axis's first `PositionId`) — O(populated cells); the model permits a
lazy/background backfill (a missing trailing-axis component reads as the first
position until the rewrite lands) as a later optimization. Rename touches `name`
only (never a key — nothing to adjust). Deleting an axis is the inverse of append
and is allowed only when the axis is **unused** (only its first position holds
data): it drops that axis from every key and reference — a lossless collapse, no
`#REF!`. Reordering an axis, and deleting an axis that holds data, are deferred
(§18) — both a whole-sheet rebuild.

`#REF!` is produced at **resolve time** (§6) from these conditions, not stored as
a sentinel index — the AST keeps the dead marker so the source round-trips for
display, but evaluation short-circuits to `#REF!`.

---

## 4. Address & range codec

Pure functions in `engine/coord.ts`. The axis-letter alphabet is a property of
the sheet's axis order.

**Axis letters** (`design.md` §3): position `0..n-1` in `axes` maps to
`x, y, z, m, n`, then the remaining lowercase letters alphabetically
(`a, b, c, d, e, f, g, h, i, j, k, l, o, p, q, r, s, t, u, v, w`), then two-letter
`aa, ab, …`. Provide `letterForAxisIndex(i): string` and its inverse
`axisIndexForLetter(s): number`. The mapping is positional in `axes`; since axes
are not reorderable, a letter is stable for a sheet's lifetime. (Note: the
`worked-example.md` table uses mnemonic letters `i`/`f` for its 4th/5th axes; the
authoritative rule here would assign `m`/`n` — the example is illustrative.)

**Coordinate address** concatenates `<letter><index>` in axis order, 1-based:
`x3y6z2`. A well-formed full address names every axis exactly once.

**1-D range** (`design.md` §4): exactly one axis carries a colon; the rest appear
once. The colon-disambiguation rule is the load-bearing detail:

> After `:`, a **digit** is the upper bound; a **letter or end-of-address** means
> "to the end of this axis."

```
y2z4:9   → varying z, from 4 to 9
y2z4:    → varying z, from 4 to end
y2z:9    → varying z, from start to 9
y2z:     → varying z, whole axis
y2z4:m1  → varying z from 4 to end, then m=1   (letter after ':' = open end + next axis)
```

Leading-open (`z:9`) sets `from = {open}`; trailing-open (`z4:`) sets
`to = {open}`. `engine/coord.ts` exposes `parseAddress(s): CellRef | RangeRef`
and `formatRef(ref, axes): string` (fully qualified; elision is a separate
display pass, §6).

---

## 5. Lexer + Pratt parser

`engine/lex.ts` + `engine/parse.ts`. A formula is the text after a leading `=`.
Hand-rolled per `technology.md` (off-the-shelf parsers assume A1).

**Tokens:** `NUMBER`, `STRING` (double-quoted), `PLUS MINUS STAR SLASH`,
`LPAREN RPAREN COMMA`, `IDENT` (function name, e.g. `SUM`), and the **address
token**. The lexer recognizes an address token by a leading `$` or
`<lowercase-letter><digit>` run and scans the whole `[$]?<letter><digits>(...)`
sequence including an embedded `:` and its disambiguation (§4) in one go, emitting
a structured `CellRef`/`RangeRef` payload. This keeps the colon rule entirely in
the lexer; the parser never sees raw `:`.

**Grammar (Pratt / precedence-climbing):**

```
expr    := binary(0)
binary(min) := unary { (op, bp) while bp >= min: op unary→fold }
unary   := '-' unary | primary
primary := NUMBER | STRING | ADDRESS | IDENT '(' args ')' | '(' expr ')'
args    := ε | expr (',' expr)*
```

Binding powers: `+ -` = 10, `* /` = 20, unary `-` = 30. `^` is **not in v1**;
it falls out of the Pratt loop trivially if later wanted (right-assoc, bp 40) but
is omitted now. A bare function name without `(`, an unparseable token, or a
partial address (§6) yields a parse error surfaced as `#NAME?`.

AST node kinds are the `Expr` union (§2).

---

## 6. Resolver + display elision

**Full qualification is required.** A reference must name every axis. A partial
address (one that omits an axis) is, like a bare `A` in a normal spreadsheet,
**not a cell reference** — it fails to parse → `#NAME?`. The stored `formula.src`
and `ast` are **always fully qualified**.

**Elision is a pure display transform**, not a storage concern. Two directions:

- *Author → store (expand):* the input typed in the formula bar may elide
  components that match the current navigated/active context. At commit, the
  resolver fills missing components from the **authoring-time** viewport
  (`navigated` + the active cell's own row/col positions) to produce the
  fully-qualified `src`/`ast`. After commit the formula's meaning is independent
  of the viewport.
- *Store → display (elide):* when showing a stored formula in the formula bar,
  components that match the **current** navigated/active context are hidden, so
  `=SUM(x1y4z2:)` displays as `=SUM(z2:)` when viewing `x=1, y=4`. This is the
  display form shown in `worked-example.md`.

`engine/resolve.ts`: `resolve(ref, axes): CellKey | RangeKey | "#REF!"` maps
index→PositionId (§1) for each component. A `RangeRef` resolves to the ordered
list of member `CellKey`s by walking the varying axis from `from`→`to` (open
bounds clamp to axis ends).

---

## 7. Evaluator

`engine/eval.ts`. Pure, bottom-up over `Expr`, given a `read(CellKey): Computed`
closure (which applies fiber resolution, §9).

- `num`/`str` → literal value.
- `ref` → `read(resolve(ref))`; unresolvable → `#REF!`.
- `rangeRef` → materialize the member list to `CellValue[]`; passed to aggregators
  as a flat value list.
- `unary -` / `binary + - * /` → numeric; `/` by zero → `#DIV/0!`; a text operand
  where a number is required → `#VALUE!`.
- `call` → `SUM, AVERAGE, MIN, MAX, COUNT`, accepting ranges and/or scalar args.
  **Numeric aggregations skip non-numeric and empty cells** (`requirements.md`
  §1.2); `COUNT` counts numeric cells; `AVERAGE` = sum/count over numerics (count
  0 → `#DIV/0!`); `MIN`/`MAX` over no numerics → `0` (document the choice).
  Unknown function name → `#NAME?`.
- **Error propagation:** any operand carrying a `CellError` propagates that error
  (first-encountered wins), except aggregators, which *skip* empties/text but
  still propagate a genuine `CellError` from a member cell.

Result is a `Computed`. The evaluator has no notion of viewport — resolution and
eval are viewport-independent (`design.md` §9).

---

## 8. Dependency graph + recompute

`engine/depgraph.ts`. Keyed by `CellKey` (identity, §1), so structural edits
don't churn the graph except where positions actually disappear.

**Edges.** Registered when a formula is (re)parsed:
- *Single ref* → a concrete edge `dependent ← dependency` in two maps:
  `dependsOn: CellKey → Set<CellKey>` and `dependents: CellKey → Set<CellKey>`.
- *Range ref* → a **range-descriptor edge** stored in a side table keyed by
  `(axisId, fixedKey)`: `{ dependent, from, to|open }`. Range edges are kept as
  descriptors, not expanded to per-cell edges, so that **(a)** writing a cell that
  falls inside the range and **(b)** structural changes to an open-ended axis tail
  both correctly dirty the dependent. On a write to `CellKey c`, dependents =
  concrete `dependents[c]` ∪ every range descriptor whose `fixedKey` matches `c`'s
  fixed components and whose `[from,to]` contains `c`'s varying index.

**Fibers participate as nodes** (§9): a reference resolving into a fiber-covered
coordinate registers its edge against the `FlatId`, so editing the fiber dirties
dependents.

**Recompute** (on any op that changes a value): seed the dirty set with the edited
key(s)/fiber, then walk reverse-dependents in **topological order** over the
affected subgraph only; cells unreachable from the edit are untouched.

**Cycle detection** during the walk: a back-edge to an in-progress node marks
**every node in the cycle** `#CYCLE!` (`requirements.md` §1.2, AC §4.7) — no hang.

After recompute, the worker returns the set of changed `(CellKey → Computed)`
intersected with the current viewport+margin (§11).

---

## 9. Fibers (`Flat`)

`engine/fiber.ts`. A fiber is one value held constant across one or more **entire**
axes (`design.md` §6) — never a sub-range. Representation: `pins` (axes fixed to
one index) + `free` (axes spanned whole) + one shared `input`.

**Coverage.** A coordinate is covered iff, for every pinned axis, the coord's index
equals the pin (free axes match anything). v1 lookup is a linear scan over the
(few) fibers checking pin-match; a coarse index by pinned-axis can be added if
fiber count ever grows.

**Read resolution is order-free** (`design.md` §6):

```
read(coord) = explicit cell value, else the unique covering fiber's value, else empty
```

This is total because of the create-time invariants:
- Creating a fiber that **overlaps another fiber** → error.
- Creating a fiber over **existing explicit cells**, or writing an explicit value
  into a **fiber-covered** coordinate → error, with an optional **overwrite** that
  absorbs the colliding explicit cells into the fiber (deletes them; the fiber's
  value wins).

So a coordinate is covered by at most one fiber and never by both a fiber and an
explicit value — no precedence rule needed. A fiber's `input` may itself be a
formula; it is computed once and shared, and it is a single depgraph node.
Per-cell exceptions inside a fiber are a **non-goal** (`design.md` §6), not
deferred.

---

## 10. Operations + undo log

`model/ops.ts`, `model/undo.ts`. Document edits are discrete, invertible
operations (`design.md` §1) — this *is* the edit model and the undo granularity.

```ts
type Op =
  | { t: "SetCell";        coord: Coord; input: CellInput;  prev: CellInput }
  | { t: "CreateFlat";     flat: Flat }
  | { t: "EditFlat";       id: FlatId; input: CellInput;   prev: CellInput }
  | { t: "DeleteFlat";     flat: Flat }
  | { t: "InsertPosition"; axisId: AxisId; index: Index;    posId: PositionId }
  | { t: "DeletePosition"; axisId: AxisId; index: Index;    removed: RemovedSlice }
  | { t: "CreateAxis";     axis: Axis }
  | { t: "RenameAxis";     axisId: AxisId; name: string;    prev: string }
  | { t: "DeleteAxis";     removed: RemovedAxis }
  // view-only ops below — applied, persisted with the doc, but NOT on the undo stack:
  | { t: "RebindViewport"; next: Partial<ViewportBinding>;  prev: Partial<ViewportBinding> }
  | { t: "Navigate";       axisId: AxisId; index: Index;    prev: Index }
  | { t: "ResizeHeader";   axisId: AxisId; size: number;    prev: number };
```

`Coord` here is the index-based authoring coordinate (`Map<AxisId,Index>`),
resolved to a `CellKey` on apply. Each op carries the data needed to invert it
(`prev`, `removed`). `apply(op)` and `invert(op)` are total. The undo log is a
linear redo/undo stack of **data** ops; **view-only ops are excluded from undo**
(a decision this doc fixes — navigating or resizing should not be an undo step) but
are still applied and persisted. Structural data ops carry the reference-adjustment
side effects of §3, which are part of `apply`/`invert` so undo is exact. Undo is
**session-only** in v1 (`open-questions.md`).

---

## 11. Worker boundary (Comlink RPC)

`engine/worker/`. Per `technology.md`: **the worker owns the document truth +
dependency graph + recompute + persistence.** The main thread is a thin
view/input layer. Typed RPC via Comlink.

```ts
interface WorkerApi {
  loadDocument(): Promise<DocMeta>;                 // restore from IndexedDB; recompute-on-load
  applyOperation(op: Op): Promise<OpResult>;        // mutate + recompute
  getSlice(req: SliceReq): Promise<SliceData>;      // values for a window
  undo(): Promise<OpResult>;
  redo(): Promise<OpResult>;
}

interface SliceReq  { rowAxisId; colAxisId; navigated; rowRange; colRange }  // + margin
interface SliceData { cells: Array<{ key: CellKey; computed: Computed; flat?: FlatId }>; meta }
interface OpResult  {
  changed: Array<{ key: CellKey; computed: Computed; flat?: FlatId }>;     // ∩ viewport+margin
  structural?: StructuralDelta;                     // axis/position adds/removes for chrome
  ok: true | { error: string };                     // e.g. fiber-overlap rejection
}
```

**Optimistic editing:** the main thread applies an edit to its local `SliceCache`
immediately and reconciles when `applyOperation` returns `changed`. The worker
returns only the changed cells that intersect the current viewport+margin, so the
payload stays small even for an enormous sheet. The worker tracks the current
viewport (set via `getSlice`) to compute that intersection.

---

## 12. Viewport projection + SliceCache

`grid/projection.ts` (main thread). Projection is a pure read (`design.md` §7):
screen cell `(r, c)` → coordinate = `rowAxis.index = scroll.row + r`,
`colAxis.index = scroll.col + c`, and `navigated[axis]` for every other axis.

**`SliceCache`** holds the current window (visible range + prefetch margin) as
`CellKey → { computed, fiber? }`, populated by `getSlice` and patched by
`OpResult.changed`. The renderer and chrome read it **synchronously** so scroll,
selection, and draw never await RPC. Navigating or scrolling beyond the margin
triggers a fresh `getSlice` (prefetchable). Re-binding axes / changing a navigated
position never mutates data — it changes only which slice is requested, and the
active cell **follows the screen** (`design.md` §7, AC §4.9).

---

## 13. Canvas renderer (`grid/`)

Bespoke Canvas 2D for the grid surface only; all chrome and the text editor stay
in DOM (`technology.md`). The renderer owns **zero n-D logic** — it draws an
ordinary 2-D grid fed by the `SliceCache`.

- **Windowing math:** from `scroll`, header sizes, and viewport pixel size,
  compute visible row/col index ranges and per-cell rects. Header sizes come from
  `ResizeHeader` ops; default uniform.
- **Scroll:** a DOM scroll container with a sized spacer (`totalRows*rowH ×
  totalCols*colW`, clamped to a safe max) supplies native scrollbars and momentum;
  the canvas repaints on scroll from the (synchronous) cache.
- **Draw layers, back-to-front:** cell backgrounds + values + gridlines → frozen
  header gutters (row index / column letter+index chrome, `design.md` §10) →
  overlays (selection rectangle, active-cell outline, fill-handle). Fiber-covered
  cells get a subtle distinct affordance.
- **HiDPI:** scale the backing store by `devicePixelRatio`; text truncation with
  ellipsis per column width.
- **Hit-testing:** `pixel → (r,c) → coord` for click/select; header bands for
  resize-drag.
- **Editor overlay:** a positioned DOM `<input>`/`<textarea>` over the active cell
  for typing and IME; the formula bar mirrors it. The canvas never receives text.
- **Keyboard nav:** arrows/Tab/Shift+Tab/Enter/Shift+Enter/Home/End/F2 per §16,
  handled on the container and translated to projection moves + edit state.

Crib rendering technique from `x-spreadsheet` and Glide Data Grid
(`technology.md`); our renderer is a subset.

---

## 14. Svelte chrome (`ui/`)

Plain Svelte 5 (runes) + Vite, no SvelteKit. UI state is runes-reactive; data
flows to/from the worker via the RPC client. Components:

- **FormulaBar** — mirrors and edits the active cell; shows the **elided** display
  form (§6); insert-by-click while editing inserts a fully-qualified address/range
  at the caret (§16).
- **AxisBindingControl** — pick the row and column axes (must stay distinct);
  swap.
- **Navigators** (pluggable, `requirements.md` §1.3): a **Slider** per hidden axis
  (drag = navigate; the handle doubles as constant-fill across that dimension,
  which writes **independent cells**, not a fiber); **cell-as-dropdown** — open any
  cell along a perpendicular dimension to view/navigate/edit its values there.
- **AxisPanel** — append/rename axes, delete an unused axis (no reorder); insert/
  delete positions (with §3 adjustment); lightweight in-app panel, not `prompt()`.
- **FlatDialog** — define/edit a fiber; surfaces overlap errors and the
  absorb-on-overwrite option (§9).
- **SavedIndicator** — reflects the debounced persistence state (§15).

---

## 15. Persistence (`persist/`)

IndexedDB, single-document v1. JSON shape keyed on **identities** so it
round-trips across renames (and forward-compat reorders):

```jsonc
{
  "schema": 1,
  "axes": [ { "id": "...", "name": "year", "positions": ["pos..", ...],
             "sizes": { "pos..": 96 } } ],
  "cells": [ { "key": [["axisId","posId"], ...], "input": { "kind": "..." } } ],
  "flats": [ { "id": "...", "pins": [["axisId", 3]], "free": ["axisId"],
               "input": { "kind": "..." } } ],
  "viewport": { "rowAxisId": "...", "colAxisId": "...",
                "navigated": [["axisId", 1]], "activeCoord": [...], "scroll": {...} }
}
```

- **Not persisted:** dependency graph, computed values, transient UI state.
- **Recompute-on-load for v1** (`technology.md`); a persisted value cache is a
  later optimization.
- **Debounced write on commit**, with a visible "saved" indicator
  (`requirements.md` §2).
- **Wrapper:** recommend **`idb`** over Dexie — the document is a single record, so
  no query/index layer is needed and `idb` is the lighter dependency. Left as the
  one remaining minor pick in `open-questions.md`.

---

## 16. Selection & interaction model

Per `design.md` §8.

- **Selection** is internally a **1-D region**: one varying axis (which must be a
  currently visible axis) with the rest fixed, or a single coordinate. A
  rectangular **block** spanning both visible axes is valid for copy/paste/bulk
  edit but is **not** a legal range-reference target (range refs are 1-D in v1).
- **Keyboard:** arrows move; `Tab`/`Shift+Tab` by column; `Enter`/`Shift+Enter` by
  row and commit; `Esc` cancels; `F2` or typing enters edit (typing overwrites);
  `Shift`+arrow extends along one axis (preserving the 1-D invariant unless the
  user explicitly drags a block); Home/End jump to edge.
- **Copy/paste with relative/absolute adjustment:** on paste, unlocked
  (`absolute:false`) reference components shift by the paste delta along their
  axis; `$`-locked components stay; orthogonal axes are unaffected (`design.md`
  §5) — pure index arithmetic on the AST (§1).
- **Constant fill & slider-drag-fill** write **independent cells**, not fibers
  (`design.md` §6).
- **Insert-by-click:** while the formula bar is active, clicking a cell inserts its
  fully-qualified address; click-drag inserts a 1-D range (subject to the 1-D
  constraint).
- **Navigated-position change mid-edit** commits the edit if it parses, then
  re-projects; the formula bar stays the source of truth for edit text.

---

## 17. Project layout & tooling

Vite + Svelte 5 + TypeScript, no SvelteKit (`technology.md`). Strict TS.

```
src/
  engine/          pure TS — coord, lex, parse, resolve, eval, depgraph, fiber. No DOM/Svelte.
    worker/        worker entry + Comlink surface (WorkerApi).
  model/           document model, discrete ops, undo log.
  grid/            canvas renderer, projection, hit-testing, SliceCache, editor overlay.
  ui/              Svelte chrome — formula bar, axis binding, navigators, panels, dialogs.
  persist/         IndexedDB (idb).
  app/             wiring + shell.
```

- **`engine/` stays DOM/Svelte-free**, enforced by a separate tsconfig project (no
  DOM lib) + a lint boundary rule. This is what preserves both the worker split and
  the future Rust/WASM port (`technology.md`).
- **Tests:** Vitest for the pure correctness surface (coord/parse/eval/depgraph/
  fiber/ops) — heavily unit-tested; Playwright for e2e. Because canvas cells aren't
  DOM-queryable, expose a **window test API** (read cell value at coord, dispatch
  keys, read selection) that e2e drives.

---

## 18. Roadmap (interleaved, pixels-first)

The same pieces as a bottom-up build, reordered into **vertical slices**: get a
static grid on screen fast, then walk up and down the stack so progress shows
across the board and usability problems surface early. Three rules set the order:
**(1)** get pixels — and an n-D capability — visible as soon as possible;
**(2)** don't perfect the UX (copy/paste, navigation niceties, axis management)
before formulas exist; **(3)** once the n-D engine is proven, validate the n-D
*interaction* — the usability that justifies the project — before hardening the
backend (worker, persistence). The document lives **in memory on the main thread**
through M8; edits become discrete ops behind a dispatch seam at **M7**, so the
worker milestone (M9) moves truth behind the worker in one behavior-preserving
swap and the renderer keeps reading a synchronous cache throughout. "Placeholder"
below means a simplified stand-in (direct mutation, uniform sizes, the doc used as
its own cache) that a later milestone replaces with the real §-spec.

```
layer \ milestone   M0  M1  M2  M3  M4  M5  M6  M7  M8  M9  M10  M11  M12
UI chrome            ·   ·   ●   ●   ●   ●   ·   ●   ●   ·   ·    ●    ◇
Grid renderer        ·   ●   ●   ●   ·   ·   ·   ·   ●   ·   ·    ●    ◇
Engine / Model       ●   ·   ●   ·   ●   ●   ●   ●   ●   ●   ·    ·    ◇
Worker / Persist     ·   ·   ·   ·   ·   ·   ·   ·   ·   ●   ●    ·    ◇

● primary build   ◇ exercised by e2e   · untouched
headlines:  M1 first pixels · M3–M4 n-D features · M5 formulas live · M8 n-D interaction set · M11 validated & polished
```

The `●` cluster zig-zags — bottom (M0) → up to the renderer (M1) → up to chrome
(M2–M3) → engine + chrome for the n-D features and formulas (M4–M6) → ops/undo and
controller decomposition (M7) → the n-D interaction set across chrome/grid/engine
(M8) → down to the worker and persistence (M9–M10) → up to chrome/grid for polish
(M11) → e2e (M12). Each milestone ends in something runnable to demo.

**M0 — Types (abstract).** Scaffold (Vite/Svelte/TS, Vitest, Playwright, the
`engine/` tsconfig boundary). Core types of §2 + the `CellKey` encoding and
axis-letter codec (§4). No pixels yet; the only purely-abstract phase.

**M1 — A grid with one value (first pixels).** In-memory 2-axis seed document;
canvas renderer (windowing, cells, gridlines, frozen gutters, HiDPI) reading the
doc directly — `SliceCache` is the doc itself (placeholder), cell sizes uniform
(placeholder). *Demo: a grid with n-D coordinate gutters and one literal showing.*

**M2 — Edit literals (full vertical slice).** DOM editor overlay, click-select,
type/`F2` to edit, Enter/Esc; formula bar mirrors the active cell (literals only).
`SetCell` as a direct in-memory write (placeholder for the §10 op/undo system).
*Demo: a usable 2-D sheet of literals.*

**M3 — Navigate a third dimension (first n-D feature).** Add a 3rd+ axis to the
seed; generalize projection to n-D (§12); `AxisBindingControl` to pick row/col
axes and a `Slider` navigator for hidden axes; active cell follows the screen.
*Demo: rebind axes and drag a slider to watch the slice change — the first
distinctly-maimadion thing on screen.*

**M4 — Literal fibers (second n-D feature).** A `Flat` whose `input` is a literal
— most of §9 without needing the engine: the `pins`/`free` representation,
order-free read resolution (explicit → fiber → empty) folded into the placeholder
`read(coord)`, create-time invariants (no fiber/fiber or fiber/explicit overlap,
absorb-on-overwrite), and the `FlatDialog`. This is the heading/label use a fiber
is mostly for — a value typed once and held constant across a whole axis. *Demo:
define a heading constant across a dimension; edit any member and the whole fiber
updates.*

**M5 — Formulas (substrate, surfaced at once).** Engine core: lex → parse →
resolve → eval (§§4–7); then depgraph + topo recompute + cycle detect (§8).
`SetCell` routes `=` inputs through the engine; formula bar shows source with
elision (§6). *Demo: references, `SUM` over a 1-D range, recompute on edit,
`#CYCLE!` — the worked-example formulas evaluate.*

**M6 — Fibers complete.** The remainder of §9 now that the engine exists: a fiber
`input` may itself be a formula, and fibers participate as depgraph nodes so
editing a fiber recomputes its dependents. *Demo: a formula-valued fiber; a
formula that reads a fibered cell recomputes when the fiber changes.*

**M7 — Operations, undo & controller decomposition.** Formalize edits as the
discrete `Op` set with `invert` + a linear undo log + §3 reference adjustment
(§10), replacing the direct in-memory writes, and route every write through a
single op-dispatch seam. Decompose `SheetController` into focused units — view/
projection state, interaction/selection state, a document-edit API, and the
computed cache — so the seam has a clear home and the M9 worker swap stays
contained. The document still applies ops in memory on the main thread. *Demo:
unchanged behavior + undo/redo at logical-edit granularity.*

**M8 — n-D interaction & structural editing.** The interaction set that proves the
n-D UX, now that edits are ops: the **cell-as-dropdown** navigator (the second v1
navigator) — open any cell along a perpendicular dimension to view/navigate/edit;
**insert-by-click** references while editing a formula (§16); the **AxisPanel** —
append and rename axes, delete an unused axis, insert/delete positions with §3
reference adjustment (§14); **copy/paste** with relative/absolute adjustment and
**constant/slider-drag fill** (§16); header resize. Appending an axis rebuilds the
cell keys onto its first position (§3). *Demo: drive the n-D sheet end-to-end —
open a cell along a hidden axis, manage axes and positions, copy a formula with
`$`-adjustment, all undoable.*

**M9 — Worker boundary.** Move the document truth behind the worker (§11): Comlink
`WorkerApi`, the real `SliceCache`, optimistic apply/reconcile, and incremental
range-descriptor-driven recompute (§8). The M7 op-dispatch seam makes this a
behavior-preserving swap; the renderer keeps reading a synchronous cache. *Demo:
unchanged behavior; heavy state off the UI thread, large sheets stay smooth.*

**M10 — Persistence.** IndexedDB (`idb`) schema, debounced save with a visible
saved indicator, recompute-on-load (§15). *Demo: close and reopen; the sheet is
restored.*

**M11 — UI polish & validation.** With the full n-D interaction set real, evaluate
and refine the usability that justifies the project: self-evaluation against
`worked-example.md`, human feedback, and iterative improvement of the navigators,
axis/position management, selection, and fill. Pull in the deferred niceties that
prove out (fill handle with series detection, §13). *Demo: the v1 interaction set,
refined against real use.*

**M12 — e2e & acceptance.** Window test API; drive Playwright through every
acceptance criterion (§19, `requirements.md` §4).

---

## 19. Acceptance-criteria traceability

Maps `requirements.md` §4 (1–15) to the realizing section(s).

| AC | Criterion (abbrev.) | Sections |
|---|---|---|
| 1 | Create n axes, named, ordered positions; add freely | §2, §10, §14 |
| 2 | Select/edit a cell; commit/cancel | §13, §16 |
| 3 | Literal number/text and `+ - * / ( )` formula | §5, §7 |
| 4 | Reference another cell by n-D address; value flows | §1, §4, §6, §8 |
| 5 | 1-D range + `SUM/AVERAGE/MIN/MAX/COUNT` | §4, §7 |
| 6 | Edit propagates in dependency order, no stale | §8, §11 |
| 7 | Circular ref → `#CYCLE!`, no hang | §8 |
| 8 | Choose/change row & column axes; re-project, no loss | §11, §12 |
| 9 | Navigate each hidden axis (slider, cell-dropdown), no mutation | §12, §14 |
| 10 | Keyboard nav, 1-D selection, copy/paste $-adjust, undo/redo | §10, §16 |
| 11 | Insert reference by click/drag while editing | §16 |
| 12 | Define a fiber; edits whole; overlap reported | §9, §14 |
| 13 | Frozen header gutters while scrolling | §13 |
| 14 | Reload restores axes/positions/cells/fibers/viewport | §15 |
| 15 | Remove a referenced position → `#REF!`, rest works | §3, §6 |
