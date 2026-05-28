# Open Questions

Almost everything is decided. This file records the settled decisions and the
few genuinely minor picks left for implementation. It is intentionally short —
items are not added here unless a real choice remains open.

---

## Settled — product

- **n is unbounded** — no policy cap on dimensions or axis size; only genuine
  technical limits apply.
- **Two axes on screen**, the rest navigated; navigation ships **sliders** and
  **cell-as-dropdown** in v1 (no standalone pinned-dropdown selector).
- **Active cell follows the screen** on a navigation change.
- **Address syntax:** A1-style extended, single lowercase axis letters
  (`x y z m n`, then alphabetical, then `aa…`), 1-based, concatenated (`x3y6z2`).
- **1-D range syntax:** colon on the varying axis only; open-ended via
  trailing/leading colon; exactly one colon in v1; generalises to multi-colon
  rectangles later.
- **Partial references** are not cell references; pinned-matching components are
  display-elided but stored fully qualified.
- **Relative/absolute:** `$` per component, independent.
- **Insert-by-click** while editing a formula.
- **Fibers** (code: `Flat`): one value constant across one or more **entire**
  axes, pinned on the rest — never a sub-range. Immutable-by-override;
  unambiguous read resolution (explicit → unique fiber → empty). For
  genuinely-invariant values only. **Copying** — including slider-drag-fill — is
  a separate UI action that writes independent cells.
- **Labels by convention** — no label type, no reserved positions; coordinate
  chrome stays; `SUM` ignores text; navigators carry hidden-axis legibility.
- **Subtotals/totals** are ordinary user-authored formula cells, not a feature.
- **Selection** is a 1-D region (varying axis must be on screen); block
  selections are valid for copy/paste/bulk-edit but not as range references.
- **Single sheet per document** in v1.
- **Formula trigger** is `=`. **Exponentiation `^`** is not in v1 unless it
  falls out of the parser for free.
- **Axis/position management:** lightweight in-app UI (panel/dialog, not a
  browser prompt); axes are created/renamed/deleted but **not reordered**;
  positions are added/deleted with spreadsheet-standard reference adjustment
  (deleting a referenced position → `#REF!`).
- **Fill handle with series detection** is v1.1; **reference highlighting** and
  **external TSV/CSV value paste** are deferred.
- **Undo** is session-only in v1; persisted undo is a later consideration.

## Settled — technology

See `technology.md`. Decided there: the stack, rendering (Canvas 2D grid surface
+ DOM chrome/editor), engine location (TypeScript in a Web Worker, Rust-ready),
state layering, persistence (IndexedDB, identity-keyed JSON), parser
(hand-rolled Pratt), and **document source-of-truth** (the worker owns the truth;
the main thread caches the current viewport).

## Deferred to implementation (minor)

- **Dexie vs. `idb`** for the IndexedDB wrapper.
- Test-suite specifics and the supported-browser matrix.
