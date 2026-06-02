# Backlog

This file serves two distinct purposes; keep them separated.

1. **Ad-hoc captures** — a cheap place to write things noticed in passing
   during other work (a smell seen in review, a doc gap noticed mid-feature, a
   workflow paper cut) so they don't get lost. Triaged at milestone
   boundaries.

2. **Meta-tasks** — self-contained recurring jobs that keep the project
   healthy: doc upkeep, refactoring review, project-process evaluation.
   Each entry below the "Meta-tasks" heading is a complete job description.
   A scheduled agent reading **only this file** as context should be able to
   pick one, execute it, and append its output to the entry's "Past outputs"
   section. New meta-tasks can be added here when a useful recurring job is
   identified.

Deferred product features get their own spec under `docs/features/` and do
not belong here.

---

## Ad-hoc captures

_Brief notes: a title, the source (PR / milestone / review that surfaced it),
and one or two sentences. At each milestone boundary, triage: act on it,
promote it as a seed for a meta-task run, or remove it. Items left untouched
for several milestones are probably not real work._

_(none currently)_

---

## Meta-tasks

Each meta-task below has this shape, in order:

- **Purpose** — what the job exists to do.
- **Trigger** — when to run it (schedule, milestone boundary, or on demand).
- **Inputs** — what to read.
- **Procedure** — concrete steps executable from cold context.
- **Stopping condition** — when one run is done.
- **Output format** — what to append to "Past outputs" and how.
- **Past outputs** — accumulated deliverables from previous runs, newest first.

---

### Doc upkeep

**Purpose.** Catch divergence between the docs under `docs/` and the current
state of code, features, and decisions. A doc that lies is worse than no doc.

**Trigger.** Weekly, or before any milestone PR that touches a documented
surface (model, engine, renderer, persistence schema, navigation).

**Inputs.** Every file under `docs/` (except `backlog.md` and files under
`docs/features/`); the corresponding code under `src/`; the most recent
N≈10 merged PR titles for context on recent change.

**Procedure.**
1. List every doc in scope.
2. For each, identify what it claims to describe — a code module, a feature,
   a process, or a decision record.
3. Compare against the current state: skim the referenced code, verify
   described behaviour, check whether referenced types/names still exist,
   check whether cited decisions still hold.
4. Flag each divergence with: doc path, specific section or claim that has
   drifted, what is actually true now, and a suggested update (or "ask the
   user" if the right answer is ambiguous).
5. Also flag: orphan docs (no code/feature matches), missing docs (significant
   code or feature with no doc), and stale `TODO`/`FIXME` markers in docs.

**Stopping condition.** Every doc in scope has been visited once.

**Output format.** Append a dated `### YYYY-MM-DD — doc upkeep` entry under
"Past outputs" containing: a one-line summary of docs confirmed in sync, and
a bulleted list of divergences (each with doc path, section, what's stale,
suggested fix). If no divergences, say so explicitly.

**Past outputs.**

_(none yet)_

---

### Refactoring review

**Purpose.** Catch missing abstractions and structural smells in existing code
before they tax the next feature.

**Trigger.** After every 3–4 milestones; or when a module noticeably grows or
accumulates duplication; or on demand when an ad-hoc capture flags a smell.

**Inputs.** One code module per run; the project's documented module structure
(`docs/tech-design.md`); recent PRs that touched the module.

**Procedure.**
1. Pick the module. Default in order of priority: a module explicitly seeded
   in ad-hoc captures; the largest unreviewed file under `src/`; a module
   modified in the last 3 PRs and not yet reviewed.
2. Read the chosen module critically (not charitably). For each item below,
   note whether the smell is present and where:
   - missing primitive types or value objects (a tuple/expression used inline
     many times);
   - missing inverse operations (e.g. coordinate → pixel exists but the
     inverse doesn't);
   - mixed coordinate spaces or conventions (0-based vs 1-based, ids vs
     indices) scattered with ad-hoc adjustments;
   - duplicated inline expressions or call sequences (`save → clip → … →
     restore` ceremony, error-handling boilerplate, etc.);
   - hardwired assumptions (uniform sizes, fixed counts, single format) that
     a near-term feature will break;
   - magic numbers without names or comments;
   - god-functions that "do" instead of "orchestrate."
3. For each smell found: name it, list the call sites, and explain *why* it's
   a smell — specifically, which near-term feature it taxes.
4. Sketch the target shape: file/module layout, key types, key functions.
5. Order the refactor as a sequence of independently shippable steps, each
   without behaviour change, smallest mechanical change first.
6. Estimate cost and identify the latest feature/milestone before which the
   refactor should land.

**Stopping condition.** One module reviewed end-to-end with a complete entry
ready to append.

**Output format.** Append a dated `#### YYYY-MM-DD — <module path>` entry
under "Past outputs" containing: Source, Severity, Summary, the numbered
list of concrete smells, the target-shape sketch (as a code block), the
ordered refactor steps with which smells each closes, and Next action with
cost estimate.

**Past outputs.**

#### Post-M7 — `src/grid/render.ts` — missing rendering abstractions

**Source:** ad-hoc renderer review during stack/scope discussion, post-M7.
**Severity:** medium — not a bug, but the next 4–5 features (selection range,
fill handle, multi-line text, ref highlighting, M9 per-axis resize, frozen
panes) each pay an integration tax against the current shape.

**Summary.** A single ~220-line `render()` with sections demarcated by
comments rather than functions or types. The most visible symptom —
near-identical top-gutter and left-gutter passes — is one head of a hydra;
the underlying issue is several missing abstractions.

**Concrete smells:**

1. **No `CellRect` / coordinate-math primitive.** `headerW + c*colW − scrollLeft`
   (and its `y` counterpart) appears inline at ~6–8 sites (flat tint, vertical
   gridlines, horizontal gridlines, cell text, both gutters, active overlay).
   Per-axis sizing will require every site to change consistently.
2. **No inverse hit-test counterpart.** `Grid.svelte` re-derives the inverse
   of the same math — two places duplicating one coordinate transform.
3. **Coordinate spaces mixed.** 0-based loop indices, 1-based at the read
   boundary (`coordAt(view, r+1, c+1)`, `active.row`); `±1` adjustments
   scattered through the function.
4. **No "draw text-in-cell" primitive.** The `save → beginPath → rect → clip
   → fillText → restore` sequence repeats at body text, top-gutter labels,
   and row-gutter labels with subtle variations in alignment, padding, and
   accent-conditional fill.
5. **Doubled body walk.** The fiber-tint loop and the text loop traverse the
   same window and both call `read(coordAt(...))` — twice per visible cell.
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

**Target shape:**

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

**Ordered refactor steps** (each independently shippable, no behaviour
change):

1. `types.ts` + `theme.ts` — rename pass for shared types and constants.
2. `layout.ts` — replace every inline coordinate expression with `cellRect`
   / `gutterRect`. Closes smells 1, 7, 9 structurally.
3. `geometry.ts` — pull windowing math out, parameterised on layout.
4. `hitTest.ts` — invert `layout.ts`; move `Grid.svelte`'s coordinate math
   here. Closes smell 2.
5. Commit to 0-based inside the renderer; convert at boundaries. Closes 3.
6. `drawCell.ts` — collapse body and gutter text sites to one call each.
   Closes 4 and part of 6.
7. `headerGutter.ts` — one routine called twice (top, left). Closes 6 and
   removes the gutter dup as a side-effect.
8. `cellBody.ts` — single walk, single `read()`, gridlines as a separate
   pass. Closes 5.
9. `render.ts` reduced to orchestration (~60 lines). Closes 8.

**Next action.** ~1 day of mechanical refactor, no behaviour change. Best
done before the next M-feature lands so that feature builds on the new seams
rather than against them.

**Status — implemented.** Done on `claude/refactor-render`. `render.ts` is now
frame-setup + a pass pipeline; the coordinate model lives in `layout.ts` (inverse
in `hitTest.ts`), windowing in `geometry.ts`, primitives in `types.ts` / `theme.ts`
/ `draw.ts`, and each draw layer in `passes.ts`. All ten smells closed; the five
pass functions live in one `passes.ts` rather than a `passes/` directory (one
function per layer gives the same per-feature isolation at this size). No behaviour
change: full unit + e2e suites green and a visual check confirms identical output.

---

### Project-process evaluation

**Purpose.** Identify friction in tooling, workflow, conventions, or the
absence of needed infrastructure (issue tracker, dev tool, CI step, branching
model, VCS choice). Output candidate changes for human decision — this
meta-task does not act on its own findings.

**Trigger.** Every ~10 milestones, or on demand when friction repeatedly
surfaces in ad-hoc captures.

**Inputs.** Recent activity (last ~20 PRs and merges) on `main`; the
project's branch list and any stale branches; available dev tools (`git`,
test framework, CI config if any); conspicuous absences (no issue tracker?
no CI? no shared session-state mechanism?).

**Procedure.**
1. Survey current tooling and conventions: VCS workflow, branch/PR naming,
   commit-message style, build/test/deploy pipeline, test framework usage,
   dev environment, doc structure.
2. Survey recent activity for friction signatures: reverted commits,
   force-pushes, repeatedly-rewritten PRs, stalled or abandoned branches,
   merge-conflict patterns, work that took noticeably longer than its
   apparent scope.
3. Survey conspicuous absences: things a project of this shape commonly has
   but this one doesn't (issue tracker, CI, deployment automation, a way to
   share state across sessions, formal review/triage cadence).
4. For each candidate change, write: what it would add or replace; the
   concrete pain it would address (with examples from step 2/3); rough
   adoption cost; what could go wrong or what trade-offs exist.

**Stopping condition.** Steps 1–3 surveyed; every observation from step 2/3
has either a candidate change (step 4) or an explicit "no action needed."

**Output format.** Append a dated `### YYYY-MM-DD — project-process
evaluation` entry under "Past outputs" containing: an observations list, and
a candidate-changes list (each independently considerable). Flag any item
the user should decide on before the next run.

**Past outputs.**

_(none yet)_
