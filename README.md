# maimadion

An **n-dimensional spreadsheet**. A normal spreadsheet is the 2-D special case;
maimadion lets a sheet have any number of dimensions, while you always look at a
2-D slice of it — you choose which two dimensions form the visible grid and
navigate the rest.

## Status

**Technical design complete; pre-implementation.** Requirements and conceptual
design are settled, the stack is chosen — a Web SPA with a Canvas 2D grid and a
TypeScript (Rust-ready) formula engine; see
[`docs/technology.md`](docs/technology.md) — and the engineering design that
bridges the stack to code is written in
[`docs/tech-design.md`](docs/tech-design.md). A single minor pick remains open
in [`docs/open-questions.md`](docs/open-questions.md).

## Documents

| Document | Contents |
|---|---|
| [`docs/requirements.md`](docs/requirements.md) | Functional & non-functional requirements, non-goals, acceptance criteria |
| [`docs/design.md`](docs/design.md) | Conceptual model and architecture: entities, addressing, ranges, fibers, viewport, navigation, evaluation, persistence |
| [`docs/worked-example.md`](docs/worked-example.md) | A monthly-budget workbook worked through the model end-to-end, validating it against real data |
| [`docs/technology.md`](docs/technology.md) | Technology evaluation: the chosen stack (Web SPA, Canvas 2D grid, TypeScript engine), rationale, and rejected alternatives |
| [`docs/tech-design.md`](docs/tech-design.md) | Technical design: concrete types, operation set, worker RPC contract, parser/AST, eval & depgraph algorithms, fiber/coordinate encoding, persistence schema, renderer architecture, interleaved roadmap |
| [`docs/open-questions.md`](docs/open-questions.md) | Decisions deferred to technology evaluation, and remaining product questions |

## The one-paragraph mental model

A sheet is a sparse n-dimensional grid. Each axis is an ordered list of
positions. A cell is addressed by one position per axis (e.g. `x3y6z2`). At any
moment two axes are bound to the screen (rows and columns) and the rest are held
at a single position, navigated by sliders or by opening a cell along a hidden
dimension. Cells hold literals or formulas; formulas do arithmetic over cell
references and one-dimensional ranges. A **fiber** is a value held constant
across an axis-aligned region — the mechanism behind things that are genuinely
invariant across a dimension (a year, a month name) without making them
un-computable. Everything else a spreadsheet user expects — keyboard
navigation, inline edit, copy/paste with relative/absolute references,
undo/redo, automatic dependency-ordered recalculation — is in scope.
