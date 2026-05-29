# Aliased Gutter Labels _(deferred)_

A **toggleable display mode** that makes any 2-D view of the sheet look and feel
like a conventional spreadsheet by aliasing the gutter labels of the two visible
axes. See also Design §3 (Cell addressing) for the canonical coordinate notation
that this mode wraps.

## What it does

When enabled, the gutter of the **column axis** shows `A`, `B`, `C`, …, `Z`,
`AA`, `AB`, … (Excel-style column letters) and the gutter of the **row axis**
shows `1`, `2`, `3`, … regardless of what the underlying axis letters and
position indices actually are. The sheet appears, and responds to keyboard
navigation, exactly like a 2-D spreadsheet.

All internal state, storage, and formula semantics are **unchanged** — the alias
is a pure display transform. A reference typed as `B3` while the mode is active
is immediately translated to the canonical `<colAxisLetter><colPos><rowAxisLetter><rowPos>`
form before being stored; the formula bar always shows the canonical address
regardless of the display mode setting.

## Scope

- The alias applies only to the **two currently bound visible axes** (row axis
  and column axis). Navigated-axis labels in navigators are **not** aliased.
- The column alias resets to `A` at position 1 of the column axis, not at the
  first letter of the full alphabet.
- When the viewport is rebound (axes swapped, or a different axis brought into
  view), the alias labels re-derive from position 1 of the newly bound axes.

## Translation rules

- **Column → letter:** convert the 1-based position index to the standard
  spreadsheet column-letter sequence (1→A, 26→Z, 27→AA, …).
- **Row → number:** the 1-based position index is used as-is.
- **Parsing user input:** an address typed in alias form while the mode is
  active (e.g. `C4`) is parsed left-to-right; a leading run of letters is
  interpreted as a column alias and the following digits as a row alias.
  Ambiguity with the canonical multi-axis notation (which also starts with
  letters) is resolved by checking whether the sheet is in alias mode before
  the parser is invoked.

## What is NOT aliased

- Canonical addresses in stored formulas.
- Formula bar display (always shows canonical form).
- Copy/paste plain-text output — canonical form is exported.
- References in fibers or any persisted document state.

## Open questions

- Should the formula bar optionally display the alias form while the user is
  editing (and translate on commit), matching Excel muscle memory?
- Should the mode be per-viewport or per-document?
- Keyboard shortcut or toolbar toggle?
