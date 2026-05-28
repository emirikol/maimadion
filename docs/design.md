# Design — Conceptual Model & Architecture

Technology-independent. This document defines *what the system is* and *how it
is modeled*, not what it is built with. Naming convention: the construct called
a **fiber** in user-facing terms is modeled in code as `Flat` (the user-facing
name is provisional and may change; the code name is stable).

---

## 1. State layers

State is divided into three layers; everything else follows from keeping these
distinct.

- **Document state** — the persisted truth: axes, positions, cells, fibers, and
  the last viewport. The only thing saved.
- **Session state** — derived and rebuildable: the dependency graph and the
  computed value/error of every formula cell.
- **UI state** — selection, focus, scroll, in-progress edit text, and which
  navigator widget is active and where.

Document edits are expressed as **discrete operations** (set-cell, create /
edit / delete fiber, insert / delete position, rename axis, rebind viewport,
navigate). This gives undo/redo a natural granularity and keeps persistence
simple.

---

## 2. Conceptual entities

```
Document
  └─ Sheet                      (one in v1)
       ├─ Axis[]  (ordered)
       │    ├─ id          stable identity
       │    ├─ name        human-readable, renameable
       │    └─ position[]  ordered; addressed by 1-based index
       ├─ Cells   sparse map: Coordinate → Cell
       │    └─ Cell { input, parsedFormula?, computedValue?, error? }
       ├─ Fibers  set of Flat regions (see §6)
       └─ ViewportBinding
            ├─ rowAxisId, colAxisId        (distinct)
            ├─ navigated: map axisId → position   (every other axis)
            ├─ activeCoord
            ├─ selection                   (a 1-D region or a single coord)
            └─ scroll per visible axis

DependencyGraph (session, derived)
  ├─ dependsOn:   Coordinate → set of Coordinates
  └─ dependents:  Coordinate → set of Coordinates   (reverse index)
```

**Invariants**

- A Coordinate keys on axis-ids and position-indices, never on names. Renaming
  an axis never invalidates a reference.
- Deleting a position or axis turns dependent references into `#REF!`.
- A Coordinate is covered by at most one fiber, and never by both a fiber and an
  explicit cell value (see §6).

---

## 3. Cell addressing

A1 notation does not generalise past two dimensions, so addresses are an
**A1-style extension to n dimensions**.

- **Axis letters** are single lowercase letters in a fixed order: `x`, `y`,
  `z`, `m`, `n` first (the conventional mathematical axis letters), then the
  remaining letters alphabetically, then two-letter names `aa`, `ab`, … once
  the single letters are exhausted. The order is a property of the sheet's axis
  list, assigned as axes are created.
- A **coordinate address** concatenates `<axisLetter><index>` for each axis,
  using **1-based** indices (matching established spreadsheets):

  ```
  x3y6z2          year=3, month=6, category=2
  ```

- Component order in an address is the axis order; a well-formed full address
  names every axis exactly once.

### Rejected alternatives

- *Extended A1 lettered columns* — positional, breaks when positions reorder,
  does not scale past 2-D.
- *Bare index tuples* `(3,6,2)` — unreadable, fragile under axis reorder.
- *Named-pair records* `{year=3, month=6}` — verbose; the A1-style form is
  terser and matches user muscle memory.

---

## 4. One-dimensional ranges

A 1-D range varies **exactly one axis** and fixes the rest. The varying axis —
and only it — carries a colon; fixed axes appear once. No coordinate is ever
repeated.

```
y2z4:9      y fixed at 2, z from 4 to 9
y2z4:       y fixed at 2, z from 4 to the end of axis z
y2z:9       y fixed at 2, z from the start to 9
y2z:        y fixed at 2, the whole of axis z      (whole-axis shorthand)
```

**Parsing rule for the colon:** after `:`, a **digit** is the upper bound; a
**letter or end-of-address** means "to the end of this axis." This keeps
open-ended ranges unambiguous even mid-address:

```
y2z4:m1     y=2, z from 4 to end, m=1
            (the 'm' after ':' signals open end + next axis)
```

**Why one colon, not two endpoints.** Established spreadsheets write
`D2:F2` because their ranges are 2-D rectangles, so both corners must be named.
A 1-D range varies a single axis by definition, so the second endpoint is pure
repetition. v1 enforces **exactly one colon**.

**Forward-compatible.** When multi-dimensional ranges are eventually allowed,
each varying axis simply carries its own colon — `x3:9y4:6z2` is a rectangle in
the x–y plane — so the syntax scales without redesign.

---

## 5. References: partial, relative, and interactive

### Omitted-axis components

A **partial** address (one that omits axes) is, like a bare `A` in a normal
spreadsheet, simply **not parsed as a cell reference**. References must resolve
to concrete coordinates.

For **display convenience**, when a stored reference's component matches the
current navigated position, that component is **elided** in the formula bar; the
stored form is always fully qualified and is re-qualified on commit. So a value
authored while viewing `x=1, m=1` may *show* as `z4:` but is *stored* with its
`x1` and `m1` components intact — its meaning never depends on what is currently
on screen.

### Relative and absolute (`$`)

Each axis component can independently be relative or absolute; `$` binds to the
single component that immediately follows it:

```
$x3$y6$z2     all three locked
x3$y6z2       only y locked
```

On copy/paste of a formula, unlocked components shift by the paste delta along
their axis; `$`-locked components stay put; axes orthogonal to the paste
direction are unaffected.

### Insert-by-click

While the formula bar is active, clicking a cell inserts its fully-qualified
address at the caret; click-drag inserts a 1-D range (subject to the same 1-D
constraint as selection, §8).

---

## 6. Fibers (`Flat`)

A **fiber** is a single value held constant across **one or more entire axes**:
each axis is either pinned to one position or free across its whole extent. A
fiber never spans a sub-range of an axis. A fiber is for values that are
**genuinely invariant across a dimension** — a year that is the same for every month and category, a
month name, a category name — and which remain ordinary computable values
(a year held in a fiber can still be summed or subtracted).

This is distinct from **copying**, which is a UI action producing independent
cells — including **slider-drag-fill** across a dimension, which writes
independent cells, not a fiber. Values that merely repeat but can diverge or
disappear over time (a rent amount, a debt line item that clears) are **copied,
not fibered**.

### Resolution: immutable-by-override

- Editing **any** member of a fiber edits the **whole** fiber — a visible cell
  is just a window onto the fiber's single value.
- Creating a fiber that **overlaps an existing fiber** is an error.
- Creating a fiber over **existing explicit values**, or writing an explicit
  value into a coordinate **already covered by a fiber**, is an error — with an
  optional *overwrite* that absorbs the colliding cells into the fiber.

Because of these invariants, a coordinate is covered by at most one fiber and
never by both a fiber and an explicit value. Cell read resolution is therefore
**unambiguous and order-free**:

```
read(coord) = explicit value, else the unique covering fiber, else empty
```

Carving a per-cell exception inside a fiber (one rogue cell that differs) is
intentionally **outside the domain of fibers** — not deferred work, but a
deliberate non-goal. A fiber is, by definition, a region of one shared value;
"a fiber with an exception" is a contradiction. Users who want almost-uniform
fill with manual overrides are served by a *separate, future n-dimensional
constant-fill tool*, which addresses that similar-but-distinct scenario without
compromising the fiber's order-free read resolution.

---

## 7. Viewport projection

Given `rowAxis`, `colAxis`, and a navigated position for every other axis, the
2-D view at screen cell `(r, c)` is the coordinate formed by taking position `r`
on the row axis, position `c` on the column axis, and the navigated position on
every other axis. This is a **pure read-side projection** — it never writes.

Re-binding (swap row/column, change which axis is visible, change a navigated
position):

- **Cell data and formulas are unchanged.** Formulas reference axis/position
  identities, not screen coordinates, so projection changes are invisible to
  them.
- **Active cell follows the screen** (§1.3): it keeps its on-screen row/column;
  its underlying coordinate changes with the new navigated positions.
- **Selection** survives if its varying axis is still one of the two visible
  axes; otherwise it collapses to the active cell (§8).

---

## 8. Selection & interaction

- A selection is internally a **1-D region**: one varying axis (which must be
  the current row or column axis) with the other axes fixed; or a single
  coordinate when nothing varies.
- A rectangular **block** selection that spans both visible axes is valid for
  copy/paste and bulk edits, but is **not** a legal target for a range
  reference (range references are 1-D in v1).
- `Shift`+arrow extends the selection along one axis only, preserving the 1-D
  invariant unless the user explicitly drags a block.
- Keyboard model: arrows move; `Tab`/`Shift+Tab` move by column; `Enter`/
  `Shift+Enter` move by row and commit an edit; `Esc` cancels; `F2` or direct
  typing enters edit mode (typing overwrites, `F2` edits in place).
- Changing a navigated position mid-edit commits the edit if it parses, then
  re-projects; the formula bar remains the source of truth for the edit text.

---

## 9. Formula evaluation model

Pipeline per cell:

1. **Lex / parse** the formula text into an AST.
2. **Normalise** any display-elided components back to full qualification using
   the navigated positions captured at authoring time.
3. **Resolve** each reference to a coordinate (single cell) or a set of
   coordinates (range). Resolution is independent of the current viewport — a
   reference resolves the same whether or not its axes are currently on screen.
4. **Register dependency edges** from this cell to every coordinate it reads
   (for ranges, to each member coordinate).
5. **Evaluate** the AST bottom-up; ranges materialise as value lists; numeric
   aggregations skip non-numeric cells; errors propagate.
6. **Store** the computed value or error.
7. **Propagate**: enqueue reverse-dependents for recompute.

- **Recompute order** is a topological walk over the affected sub-graph; cells
  unreachable from the edit are untouched.
- **Cycles** are detected during the walk (a back-edge to an in-progress node);
  every cell in the cycle is marked `#CYCLE!`.
- Whether evaluation runs on the foreground thread or in a background context is
  a technology-evaluation question (see open questions); the model is pure and
  side-effect-free so it can run in either.

---

## 10. Labels by convention

There is **no first-class label type and no reserved positions.** Every cell is
a plain cell. A user labels things exactly as in a normal spreadsheet — by
typing `2016` or `debt` into a cell and treating it as a label — and is
responsible for keeping label cells out of aggregation ranges. The coordinate
chrome (`x1`, `y2`, `z3` shown in the gutters) is the addressing scheme and is
always present; it is not the same thing as a label.

This stays clean for two reasons:

- **Numeric aggregations ignore text**, so accidentally sweeping a text label
  (`"debt"`) into a `SUM` is harmless. Only a *numeric* label (a year) needs the
  same care it would need in any spreadsheet — consistent with treating years as
  data, not metadata.
- **Hidden-axis legibility** — the gap that pure convention leaves in 2-D
  (a label cell on a navigated axis is off-screen) is closed by the navigators:
  a **slider** lets the user watch the visible label cell change as the slice
  moves, and **cell-as-dropdown** opens the labelling cell directly. Neither
  requires the system to know which cells are labels.

A value that genuinely *is* constant across a dimension (a year) is expressed as
a **fiber** (§6), which keeps it both legible in navigators and computable.

---

## 11. Persistence (conceptual)

**Persisted (document state):** axis identities, names, and ordered positions;
the sparse map of cell inputs; fibers; the last viewport (row/column axes,
navigated positions, active coordinate, scroll); a schema/version tag.

**Not persisted:** the dependency graph and computed values (derivable —
recompute-on-load vs. cached-on-disk is a technology-evaluation decision);
transient UI state.

The serialization format and storage mechanism are settled in `technology.md`.
The conceptual requirement: it must round-trip stably across axis renames (which
is why axis **identity**, not name, is the key). Axes are not reorderable in v1.
