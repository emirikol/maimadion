# Backlog

Lightweight tracker for **meta-tasks** — work that isn't a product feature but
keeps the project healthy. Four categories: feature follow-ups, doc upkeep,
refactoring review, and open process questions.

This is the cheap place to write things down so they don't get lost between
PRs. It is **not** an issue tracker — items should be brief, dated by their
source PR/milestone, and either acted on or pruned at each milestone boundary.

## How to use this

- **Notice something while doing something else** → add it here.
- **Finish a feature** → add any known shortcomings or follow-ups.
- **Do a code review** → file structural findings here, not in PR comments
  that disappear.
- **Notice doc drift** → list the doc and the divergence.
- **Have a process gripe** → write the question, not the answer.
- **At each milestone boundary** → triage. Promote items to PRs or remove
  them. Items left untouched across several milestones probably aren't real
  work; cut them.

Deferred product features get their own spec under `docs/features/` and do
not belong here.

Per-item format: a short title; **Source** (the PR, milestone, or review that
surfaced it); a one- or two-sentence rationale; optionally **Severity** and a
**Next action**.

---

## Feature follow-ups

_Things noted while building a feature that didn't make that feature's scope
but should be addressed later._

_(none currently — populate as features ship with known shortcomings.)_

---

## Doc upkeep

_Docs that have drifted from reality, sections needing updates after code
changes, or known gaps._

_(none currently flagged — populate when drift is noticed.)_

---

## Refactoring review

_Structural findings from review of existing code. Each entry should include
where the smell is, why it's a smell, and a concrete refactor sketch — enough
that a future PR can pick it up without re-doing the analysis._

### `src/grid/render.ts` — missing rendering abstractions

**Source:** ad-hoc renderer review, post-M7.
**Severity:** medium — not a bug, but the next 4–5 features (selection range,
fill handle, multi-line text, ref highlighting, M9 per-axis resize, frozen
panes) each pay an integration tax against the current shape.

**Summary.** A single ~220-line `render()` with sections demarcated by comments
rather than functions or types. The most visible symptom — near-identical
top-gutter and left-gutter passes — is one head of a hydra; the underlying
issue is several missing abstractions.

**Concrete smells:**

1. **No `CellRect` / coordinate-math primitive.** `headerW + c*colW − scrollLeft`
   (and its `y` counterpart) appears inline at ~6–8 sites (flat tint, vertical
   gridlines, horizontal gridlines, cell text, both gutters, active overlay).
   Per-axis sizing will require every site to change consistently.
2. **No inverse hit-test counterpart.** `Grid.svelte` re-derives the inverse of
   the same math — two places duplicating one coordinate transform.
3. **Coordinate spaces mixed.** 0-based loop indices, 1-based at the read
   boundary (`coordAt(view, r+1, c+1)`, `active.row`); `±1` adjustments
   scattered through the function.
4. **No "draw text-in-cell" primitive.** The `save → beginPath → rect → clip →
   fillText → restore` sequence repeats at body text, top-gutter labels, and
   row-gutter labels with subtle variations in alignment, padding, and
   accent-conditional fill.
5. **Doubled body walk.** The fiber-tint loop and the text loop traverse the
   same `firstRow..lastRow × firstCol..lastCol` window and both call
   `read(coordAt(...))` — twice per visible cell.
6. **Clip-rect / save-restore framing repeated literally** per region with no
   "do this within the body region" / "within the top gutter" helper.
7. **Window math hardwired to uniform sizes.** `firstRow = floor(scrollTop /
   rowH)` assumes uniform `rowH`; per-axis sizing requires prefix-sum lookups
   and breaks the loops.
8. **`render()` does, doesn't orchestrate.** Mixes axis lookup, letter
   derivation, windowing, drawing, gutters, overlays, and corner chrome.
9. **`LAYOUT` constants live with the renderer** rather than as a queried
   layout model — no seam for per-axis sizing.
10. **Magic numbers:** `+ 0.5` (canvas pixel-align), `+ 6` (cell padding),
    `colW − 2` / `rowH − 2` (active-stroke inset). Each named once would
    document intent.

**Refactor sketch — target shape:**

```
src/grid/
  types.ts        CellRect, ScreenPos, GridIdx (0-based)
  layout.ts       cellRect(r,c), gutterRect(side, idx), pixelAlign(x);
                  uniform-size impl today, prefix-sum array later
  hitTest.ts      inverse of layout.ts (pixel → cell / gutter / edge)
  geometry.ts     visibleRange(scroll, viewportSize, axisLength, layout)
  theme.ts        COLORS, font tokens, paddings, insets
  drawCell.ts     drawCellText(ctx, rect, text, style), fillCellRect
  passes/
    flatTint.ts
    gridlines.ts
    cellBody.ts          single walk: read once, optional tint, text
    headerGutter.ts      one routine, called for top + left
    cornerAndBorders.ts
    activeCell.ts
  render.ts       ~60 lines: frame init + passes pipeline
```

**Order — each step independently shippable:**

1. `types.ts` + `theme.ts` — rename pass for constants and shared types.
2. `layout.ts` — replace every inline coordinate expression with
   `cellRect(r,c)` / `gutterRect(...)`. Closes smells 1, 7, 9 structurally.
3. `geometry.ts` — pull windowing math out, parameterized on layout.
4. `hitTest.ts` — invert `layout.ts`; move `Grid.svelte`'s coordinate math
   here. Closes 2.
5. Commit to 0-based inside the renderer; convert at boundaries. Closes 3.
6. `drawCell.ts` — collapse body and gutter text sites to one call each.
   Closes 4 and part of 6.
7. `headerGutter.ts` — one routine called twice (top, left). Closes 6 and
   the gutter dup as a side-effect.
8. `cellBody.ts` — single walk, single `read()`, gridlines as a separate
   pass. Closes 5.
9. `render.ts` reduced to orchestration (~60 lines). Closes 8.

**Next action:** ~1 day of mechanical refactor, no behaviour change. Best
done before the next M-feature lands so that feature builds on the new seams
rather than against them.

---

## Open process questions

_Meta-questions about how this project is run — branching, PR conventions,
test strategy, doc structure, etc. Items here aren't to-dos; they're flags
for a later conversation._

### Univer render-engine underlay — held on user's own TODO

**Source:** stack/scope discussion, post-M7.
**Status:** the user holds this on their own TODO list, not on the project
backlog. Recorded here only so it isn't re-raised in review: the question of
whether `@univerjs/engine-render` could underlay the renderer at a clean seam
(keeping our n-D model on top, projecting to a 2-D slice for render) is
parked, not closed. If revisited, the spike's bar is whether their render
engine accepts an arbitrary `(row, col) → cell content` callback rather than
reading their data model directly.
