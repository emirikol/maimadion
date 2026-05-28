# Requirements

Status: planning phase. Technology-independent. Where a default is proposed
rather than dictated by the user, it is marked _(proposed)_.

---

## 1. Functional requirements

### 1.1 Data model

- A **Sheet** has `n` named **Axes**, `n >= 1`. A conventional spreadsheet is
  the case `n = 2`.
- **No artificial cap on `n` or on axis size.** Dimensions and positions may be
  added until a genuine technical limit is reached (e.g. integer range). No
  policy limit is imposed.
- Each **Axis** has a stable identity (independent of its name) and an ordered
  list of **positions**. Positions are addressed by 1-based index.
- A **Coordinate** is one position per axis; it identifies exactly one cell.
- A **Cell** holds exactly one of: empty, a literal (number or text), or a
  formula. A formula may evaluate to a value or to an error.
- The sheet is **sparse**: the addressable space is the product of axis sizes
  (which may be astronomically large); only populated cells consume real state.
- A **Fiber** is a single value held constant across an axis-aligned region of
  the sheet (see Design §6). It is part of the data model.
- v1: a single Sheet per document.

### 1.2 Formulas

- A formula begins with `=`.
- **Arithmetic operators (v1):** `+`, `-`, `*`, `/`, unary `-`, and
  parentheses. Comparison and boolean operators are deferred.
- **Literals:** numbers and quoted text.
- **References:**
  - Single-cell reference to a coordinate (see Design §2).
  - One-dimensional **range**: a contiguous run along exactly one axis, all
    other axes fixed (see Design §3).
  - Relative and absolute references (`$` per axis component, see Design §5).
  - Multi-dimensional ranges are deferred.
- **Functions (v1):** `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`. These accept
  ranges and/or value lists. As in established spreadsheets, numeric
  aggregations ignore non-numeric cells.
- **Error states (v1):** `#REF!` (coordinate no longer exists), `#DIV/0!`,
  `#CYCLE!` (circular dependency), `#NAME?` (unknown function / unparseable),
  `#VALUE!` (type mismatch).
- **Recalculation:** any change to a cell, fiber, or axis triggers recompute of
  affected dependents, in dependency order, perceived as immediate.

### 1.3 Viewport and dimension navigation

- At any moment exactly two distinct axes are bound to the screen: a **row
  axis** and a **column axis**.
- Every other axis is held at a single position — its **navigated position**.
- **Dimension navigation is a pluggable subsystem.** v1 ships two navigators,
  both operating over the same underlying coordinate state:
  - **Sliders** — one per non-visible axis; the drag handle doubles as
    n-dimensional constant-fill.
  - **Cell-as-dropdown** — any cell can be opened along a perpendicular
    dimension to view, navigate, and edit its values on that axis.
  - The original standalone "pinned dropdown selector" is **not** a separate
    kept feature; the two navigators above subsume it.
- Re-binding axes or changing a navigated position **never mutates cell data or
  formulas** — it changes only which slice is projected.
- **Active cell on navigation change: follow-screen.** When a navigated
  position changes, the active cell stays at its on-screen row/column; its
  underlying coordinate changes accordingly.

### 1.4 Spreadsheet UX baseline

Each capability is marked **[v1]**, **[v1.1]**, or **[deferred]**.

| Capability | Scope |
|---|---|
| Click to select a cell | v1 |
| Arrow / Tab / Shift+Tab / Enter / Shift+Enter navigation | v1 |
| Home / End, jump-to-edge | v1 |
| Type-to-overwrite; `F2` / double-click to edit in place | v1 |
| Formula bar mirroring and editing the active cell | v1 |
| Range selection (shift-click, shift-arrow, drag), constrained to 1-D | v1 |
| Click / click-drag in a cell to insert a reference while editing a formula | v1 |
| Copy / cut / paste of cells and 1-D ranges (in-app) | v1 |
| Relative/absolute reference adjustment on paste | v1 |
| Undo / redo at logical-edit granularity | v1 |
| Constant fill (incl. slider-drag fill across a dimension) | v1 |
| Automatic recalculation on every edit | v1 |
| Dependency-ordered recompute | v1 |
| In-cell error indicators | v1 |
| Frozen header gutters while scrolling | v1 |
| Row / column (position) resize | v1 |
| Insert / delete positions on an axis | v1 |
| Persistence across reload | v1 |
| **Fill handle with series detection** | **v1.1** (priority) |
| Reference highlighting while editing a formula | deferred |
| Paste of values from external TSV/CSV | deferred |
| Cell formatting (number format, colour, font, alignment) | deferred |
| Multiple sheets / tabs | deferred |
| Find & replace | deferred |
| Comments / notes | deferred |
| Charts | deferred |
| Real-time collaboration | deferred |
| Import / export of established spreadsheet formats | deferred |

---

## 2. Non-functional requirements

- **Scale:** no imposed limits on `n`, axis size, or populated-cell count. Aim
  for as much as the eventual implementation can bear; document limits as
  discovered. No specific latency target is set for v1 — _(proposed)_ keep
  interaction feeling immediate and revisit if anything drags.
- **Persistence:** local-first; data survives reload and tab close; saving is
  implicit with a visible "saved" indicator _(proposed)_.
- **Offline:** functional after initial load.
- **Privacy:** no sheet content leaves the device in v1.
- **Accessibility:** no formal target for the MVP; retained as a later
  consideration (a grid whose meaning depends on out-of-view navigated
  positions has non-trivial screen-reader implications).
- **Browser/runtime support:** _(proposed)_ current evergreen desktop browsers;
  mobile/touch deferred. To be settled in technology evaluation.

---

## 3. Non-goals (v1)

- Binding a non-visible axis to UI richer than the v1 navigators.
- Multi-dimensional ranges in formulas.
- Multiple sheets per document; cross-sheet references.
- Cell / conditional formatting.
- Collaboration, presence, comments.
- Charts and visualisations beyond the grid.
- Server-side persistence, accounts, sharing.
- Mobile/touch-first UX.
- Macros, scripting, custom functions.
- Native import/export of established spreadsheet file formats.
- A first-class "label" type or reserved label positions — labels are
  user-authored cell data by convention (see Design §10).

---

## 4. Acceptance criteria

A reviewer should be able to confirm each item.

1. Create a sheet with `n` axes (any `n`), each named, each with an ordered list
   of positions; add dimensions and positions freely.
2. Select any cell; edit by typing or via the formula bar; commit with Enter,
   cancel with Esc.
3. Enter a literal number, literal text, and a formula using `+ - * / ( )`.
4. Reference another cell by its n-D address; its value flows through.
5. Write a 1-D range and aggregate it with `SUM`, `AVERAGE`, `MIN`, `MAX`,
   `COUNT`, with correct results.
6. Editing a referenced cell updates all dependents in dependency order with no
   stale values once settled.
7. A circular reference is reported as `#CYCLE!` without hanging.
8. Choose the row and column axes; change either; the grid re-projects with no
   data loss.
9. For every non-visible axis, navigate its position (slider and
   cell-as-dropdown) and watch the projection change without mutating data.
10. Standard keyboard navigation, 1-D range selection, copy/paste with
    relative/absolute adjustment, and undo/redo all behave as in a familiar
    spreadsheet.
11. While editing a formula, click (or click-drag) a cell to insert its
    reference (or 1-D range).
12. Define a fiber (a value constant across a region); confirm it displays
    across that region, that editing any member edits the whole fiber, and that
    attempting to overlap it with existing data or another fiber is reported.
13. Header gutters stay visible while scrolling a large axis.
14. Close and reopen the app; the sheet is restored (axes, positions, cells,
    fibers, viewport binding, navigated positions).
15. Remove a referenced position or axis; dependents become `#REF!` while the
    rest of the sheet keeps working.
