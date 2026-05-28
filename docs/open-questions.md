# Open Questions

Two kinds: decisions deferred to the **technology-evaluation** phase (the next
phase), and remaining **product** decisions. Settled decisions from the design
conversation are recorded for context so the next phase does not relitigate
them.

---

## A. For the technology-evaluation phase

Each is framed as a question plus its binding constraint, not an answer.

1. **Grid rendering.** How is a virtualised 2-D grid rendered to scroll smoothly
   over large visible axes, with frozen header gutters, resizable
   rows/columns, and an editor overlay? No imposed scale cap, so the renderer's
   practical ceiling is itself an output of this evaluation.
2. **Where the formula engine runs.** Foreground vs. a background context. The
   model is pure and side-effect-free either way; the question is the
   recompute-latency profile at large populated-cell counts.
3. **Dependency-graph representation.** Per-coordinate edges vs. per-range
   edges. Ranges may be very large; full materialisation is wasteful, but
   per-range edges complicate correctness when positions are inserted/deleted
   inside a range.
4. **State management.** How to segregate Document / Session / UI state
   (Design §1) so that undo/redo is granular and recompute is incremental
   (no full-document recompute per keystroke).
5. **Persistence mechanism.** A local-first store for potentially large
   documents that survives across sessions and is quota-aware.
6. **Computed-value caching.** Recompute everything on load (simpler, slower
   open) vs. persist last values (faster open, larger files, careful
   invalidation). "Do the right thing" — decide here.
7. **Formula parser.** Build vs. borrow. Any borrowed parser must support the
   n-D address and range grammar (Design §3–4); off-the-shelf spreadsheet
   parsers assume A1 and will not.
8. **Serialization / file format.** Must round-trip stably across axis and
   position renames and reorders (identities are the keys, not names).
9. **Open spreadsheet formats as storage.** Worth a brief look at established
   open formats (e.g. OpenDocument, Office Open XML, CSV) before committing to a
   native format — but every established format assumes two dimensions, so they
   are at best building blocks (one 2-D slice at a time), likely more work than
   a clean native format. Time-box this.
10. **Testing strategy** for evaluation correctness across an n-D address space.
11. **Runtime / browser support matrix** (deferred from non-functional reqs).

---

## B. Remaining product questions

1. **Axis & position creation UX.** How does a user create, rename, and reorder
   axes, and add/rename/delete positions? (A side panel, a modal, inline?) Not
   the core problem, but needed before build.
2. **Position deletion that breaks references.** Confirmed: deleting a
   referenced position turns dependents into `#REF!`. Confirm there is no undo
   subtlety beyond the normal undo stack.
3. **Range endpoint deletion.** When a position inside a referenced range is
   deleted, follow established spreadsheet behaviour (range shrinks); when an
   endpoint is deleted, `#REF!`. Confirm against a concrete reference product
   during build.
4. **Exponentiation.** Is `^` in the v1 arithmetic set, or is `+ - * /` plus
   parentheses and unary `-` sufficient for v1?
5. **Fiber sub-ranges vs. full-axis.** v1 fibers may span a sub-range of a free
   axis (the slider-drag-fill case) as well as the full axis. Confirm sub-range
   fibers are in v1 rather than deferred to the future constant-fill tool.
6. **Subtotal convention.** The model leaves subtotals as user-authored formula
   cells (no built-in). Confirm no built-in subtotal/total affordance is wanted
   for v1.
7. **Undo across sessions.** Session-only for v1; persisted undo is a later
   consideration. Confirm.

---

## C. Settled (for the record)

- **n is unbounded** — no policy cap on dimensions or axis size; only genuine
  technical limits apply.
- **Two axes on screen**, the rest navigated; navigation is a **pluggable
  subsystem** shipping **sliders** and **cell-as-dropdown** in v1; the
  standalone pinned-dropdown selector is dropped.
- **Active cell follows the screen** on navigation change.
- **Address syntax:** A1-style extended, single lowercase axis letters
  (`x y z m n`, then alphabetical, then `aa…`), 1-based, concatenated
  (`x3y6z2`).
- **1-D range syntax:** colon on the varying axis only, open-ended via
  trailing/leading colon, exactly one colon in v1, generalises to multi-colon
  rectangles later.
- **Partial references** are not cell references; pinned-matching components are
  display-elided but stored fully qualified.
- **Relative/absolute:** `$` per component, independent.
- **Insert-by-click** while editing a formula.
- **Fibers** (code: `Flat`): constant value over an axis-aligned region;
  immutable-by-override; unambiguous read resolution (explicit → unique fiber →
  empty). For genuinely-invariant values only; **copy** is a separate UI action
  for values that merely repeat.
- **Labels by convention** — no label type, no reserved positions; coordinate
  chrome stays; `SUM` ignores text; navigators carry hidden-axis legibility.
- **Selection** is a 1-D region (varying axis must be on screen); block
  selections are valid for copy/paste/bulk-edit but not as range references.
- **Single sheet per document** in v1.
- **Formula trigger** is `=`.
- **Fill handle with series detection** is v1.1; **reference highlighting** and
  **external TSV/CSV value paste** are deferred.
