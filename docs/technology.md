# Technology Evaluation

Status: technology-evaluation phase. This records the stack decisions, their
rationale, and the rejected alternatives, so the implementation phase does not
relitigate them. Conceptual model and requirements are in `design.md` and
`requirements.md`; this document is the *what-it's-built-with* layer.

---

## Confirmed direction

Three forking decisions were made first; everything else follows from them.

1. **Deployment target: Web SPA.** Zero-install, shareable URL; local-first and
   offline are still achievable (and required). Keeps the web toolchain in play.
2. **Grid rendering: Canvas 2D.** The performance-critical surface is drawn on a
   canvas, not the DOM. This is what production spreadsheets converge to.
3. **Formula engine: TypeScript first, Rust-ready.** A pure TS engine behind a
   worker interface, kept dependency-free so it is a clean Rust/WASM port target
   if and when recompute scale demands it.

---

## The stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | **TypeScript** | One language across UI and engine; engine kept pure so it can port to Rust/WASM later. |
| Build/dev | **Vite** | Fast HMR; de-facto for this ecosystem. |
| Chrome / app shell | **Svelte 5 (runes)**, plain Svelte + Vite (no SvelteKit) | Lightest option, no VDOM to fight, fine-grained reactivity; only drives chrome, not the grid. No SSR/routing need, so Kit is unnecessary machinery. |
| Grid surface | **Bespoke Canvas 2D** + overlaid DOM editor | Pixel control, flat cost per visible cell, smooth scroll at scale. Text *input* stays in a DOM overlay (also gives IME). |
| Engine host | **Web Worker**, RPC via **Comlink** | Keeps parse/eval/recompute off the UI thread; ergonomic typed RPC. |
| Parser | **Hand-rolled Pratt parser** | Off-the-shelf parsers assume A1; ours is a few hundred lines and must support n-D addresses, 1-D ranges, and `$`. |
| Persistence | **IndexedDB** via **Dexie** (or `idb` if barebones) | Only realistic store for multi-MB structured data; localStorage too small. |
| Undo/redo | **Operation log** of the design's discrete ops | Each op invertible; natural granularity; this *is* the design's edit model. |
| Engine tests | **Vitest** | The n-D correctness surface (parser, evaluator, depgraph, fibers, ranges) is pure and heavily unit-testable. |
| UI/e2e tests | **Playwright** | Canvas cells can't be queried; e2e drives real interaction (or a test API). |

---

## Why bespoke Canvas is bounded, not a giant project

The scope worry is real but resolvable; this was decided on analysis rather than
a spike.

- **Canvas draws only the grid surface.** Formula bar, toolbar, dialogs,
  navigators, and the cell editor all stay in DOM/HTML. "Canvas + some DOM" is
  the standard architecture (Google Sheets, x-spreadsheet), not a compromise.
  Text *input* never touches canvas.
- **Rendering is always a 2-D slice.** All n-D complexity lives in the
  model/engine; the renderer is an ordinary 2-D grid with zero n-D logic.
- **Accessibility is deferred** (per requirements) — the single scariest canvas
  cost is off the v1 table.
- **Scrolling rides a DOM scroll container** with a sized spacer, so the browser
  supplies native scrollbars and momentum.
- **Open-source references** to crib rendering technique from: `x-spreadsheet`
  (a complete canvas spreadsheet incl. engine in ~10–15k LOC — our renderer is a
  subset of that), and Glide Data Grid's renderer.

What the renderer owns for v1: windowing math, cell/gridline/frozen-header
drawing with HiDPI and text-truncation, hit-testing, selection/active-cell/
fill-handle overlays, header resize, keyboard navigation, clipboard.

---

## Rejected alternatives

- **React** — heaviest reconciliation of the VDOM options; the serious grid
  libraries bypass React internals anyway, so it brings ecosystem you'd partly
  discard.
- **DOM-virtualized grid** — far less work, but a perf ceiling on large
  viewports (many rows × many columns scrolling at once); rejected in favour of
  canvas given "scale as much as possible."
- **Reusing a full canvas spreadsheet (Univer, Luckysheet/fortune-sheet)** —
  each ships its own 2-D model, A1 addressing, and formula engine, i.e. exactly
  the layers our n-D design must own. Read for ideas; not a foundation.
- **canvas-datagrid as the foundation** — capable but its UX ceiling sits below
  big-spreadsheet polish and it carries features we don't need while not
  matching our selection/fill/navigator model. Viable only as a shortcut, risky
  as the base.
- **Native desktop (Swift/Qt/WPF) for a "mature grid"** — a mirage: desktop
  table widgets are record-table oriented, not spreadsheet-grade, so you'd build
  most of the grid anyway *and* pay web-distribution + multi-platform costs.
- **Flutter** — the one credible "not raw canvas, not DOM" middle path
  (retained-mode toolkit, `TwoDimensionalScrollView`, web + native from one
  codebase). Set aside for v1: Dart is another ecosystem, Flutter-web has
  text-selection/load-size/a11y caveats, and you'd still build the grid on top.
  Kept on record as the fallback if the canvas renderer ever proves too costly.
- **PureScript / Haskell-verse engine** — the engine is a textbook pure-FP
  problem, but the ecosystem/maintenance/interop cost is high. The FP modeling
  benefit (ADTs, purity) is captured well enough by TS discriminated unions now
  and Rust enums later.

---

## Architecture

### Layers (mirrors `design.md` §1)

- **Document state** — persisted truth: axes, positions, cells, fibers, last
  viewport.
- **Session state** — derived: dependency graph + computed values/errors.
- **UI state** — selection, focus, scroll, in-progress edit, active navigator.

### Worker boundary and source-of-truth — _confirmed_

**Decision: the worker owns the document truth + dependency graph +
recompute + persistence.** The main thread is a thin view/input layer: it sends
operations and receives computed values **scoped to the current viewport plus a
margin**, cached locally so rendering and selection stay synchronous. Edits
apply optimistically and reconcile on the worker's reply.

- *Why:* keeps all heavy data and CPU off the UI thread (the point of the
  worker); the visible slice stays small even when the sheet is enormous, which
  matches "scale as much as possible."
- *Cost:* navigation/scroll fetches the new slice over RPC (cheap, prefetchable);
  optimistic-edit reconciliation to manage.
- *Alternative (main owns truth):* simpler and fully synchronous, but the full
  cell store + logic live on the main thread, undercutting the worker for very
  large sheets. Acceptable if v1 iteration speed is valued over scale headroom.

### Module structure

```
engine/    pure TS — lex, parse, AST, resolve, depgraph, eval, fiber, coord,
           range. No DOM, no Svelte. The Rust/WASM port candidate.
engine/worker/   worker entry + Comlink surface.
model/     document model + discrete operations + undo log.
grid/      canvas renderer, hit-testing, selection/editor overlays, projection.
ui/        Svelte chrome — formula bar, axis binding, navigators, dialogs.
persist/   IndexedDB (Dexie/idb).
app/       wiring + shell.
```

Keep `engine/` free of any UI or platform dependency — that constraint is what
preserves both the worker boundary and the future Rust port.

---

## Persistence specifics

- IndexedDB; JSON document shape keyed on **identities** (axis-id, position-id),
  not names — so it round-trips across renames and reorders.
- Debounced write on commit; implicit save with a "saved" indicator.
- **Recompute-on-load for v1** (simpler); persisted value cache is a later
  optimization.

---

## Remaining open items

- **Dexie vs. `idb`** for the IndexedDB wrapper — a minor pick deferrable to
  implementation.

Source-of-truth is decided (above). The product questions previously parked here
are settled in `open-questions.md`.
