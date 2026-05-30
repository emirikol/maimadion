# Cell Drilldown _(deferred)_

A cell can be **configured with a drilldown view**: a specific pair of axes to
use as row/column when you dive into that cell. Activating the drilldown
re-projects the viewport onto those axes, with every other axis pinned to the
cell's own coordinate, and pushes the previous view onto a navigation stack so
you can return.

## Motivation

In an n-dimensional sheet the current 2-D slice is just one window into the
data. A summary cell (e.g. a total across all months for a given year and
category) is naturally the entry point for a more detailed view (e.g. all
months × sub-categories). Rather than manually rebinding axes and resetting
navigated positions, the drilldown makes that jump a single keystroke.

## Configuration

A drilldown config is attached to an individual cell in document state:

```
DrilldownConfig {
  rowAxisId   — which axis becomes the row axis in the drilldown view
  colAxisId   — which axis becomes the column axis in the drilldown view
}
```

- `rowAxisId` and `colAxisId` must be distinct and must refer to existing axes.
- They may be the same as the current viewport's row/col axes (a "same-plane
  drilldown" that just pins the navigated axes more tightly).
- The config is set, edited, and removed through a cell context menu or a
  dedicated dialog. A cell with a drilldown configured shows a small indicator
  in its corner in the gutter/chrome area.
- Drilldown configs are part of **document state** and are persisted.

## Activation

From a cell that has a drilldown config:

- **`Alt+Enter`** (proposed) activates the drilldown.

On activation:

1. The current viewport binding is pushed onto a **view history stack** (session
   state, not persisted).
2. The viewport is rebound: `rowAxisId` and `colAxisId` from the config become
   the new row and column axes.
3. Every other axis is set to its **navigated position from the source cell's
   coordinate** — i.e. the slice is centred on where you came from.
4. The active cell is placed at the intersection of the drilldown axes that best
   corresponds to the source coordinate (if those axes are present in the new
   view; otherwise the active cell is position 1,1 of the new view).

## Returning to the previous view

- **`Alt+Backspace`** (proposed) pops the view history stack, restoring the
  previous viewport binding, navigated positions, and active cell exactly.
- The stack can be arbitrarily deep (drilldowns can chain).
- Navigating away manually (rebinding axes through the normal navigator UI) does
  **not** pop the stack — the history is only consumed by the explicit back
  shortcut.
- The stack is cleared when the document is closed (session state).

## What is and isn't changed

**Changed on drill-in:**
- `rowAxisId`, `colAxisId` in the viewport binding.
- `navigated` positions for all axes not in the new row/col pair.
- Active cell position.

**Not changed:**
- Cell data, formulas, fibers — projection is read-side only (Design §7).
- The drilldown config itself.
- Any other open documents or sheets.

## Relationship to viewport rebind (Design §7)

A drilldown is a **structured viewport rebind** — it follows the same rules as
a manual rebind (active cell follows the screen, selection collapses if its
varying axis is no longer visible) but is triggered by cell metadata rather than
the navigator UI, and is reversible via the history stack.

## Open questions

- Should the drilldown config store an optional **scroll offset** to restore a
  specific part of the drilldown view, not just the axes and navigated positions?
- Should chained drilldowns each get a back-breadcrumb shown in a status bar
  ("Total → Year → Month")?
- Can a drilldown be configured on a **range** rather than a single cell
  (activating from any cell in the range uses that cell's coordinate)?
- Keyboard shortcut bikeshedding: `Alt+Enter` conflicts with some OS/browser
  defaults; needs verification against the actual keybinding scheme.
