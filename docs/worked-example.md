# Worked Example — Monthly Budget

A monthly budget, worked through the model end-to-end. Its purpose is to
validate the conceptual model (and it did — the model gained the field axis and
shed several misconceptions during this exercise).

---

## The data

A budget tracked by year and month, broken into expense categories, each
itemised into line items. Sample for **April 2026**:

- **debt** — Ogen: 5000, Mercantile: 3500, BTL: 2500
- **subscriptions** — Claude: 60 (from Neema), YouTube: 24 (from cc)
- **bills** — arnona: 4000, electricity: 800
- **rent** — 4720
- **living exp (cc)** — 173, 65, 84, 152, 173, 152 _(unnamed items)_

---

## Axes

A line item carries more than one fact — a **name** (*Ogen*) and an **amount**
(*5000*), sometimes a **note** (*from Neema*). One coordinate holds one value,
so name and amount cannot share a coordinate. They are different **fields** of
the same item, which forces out the axis a 2-D sheet hides inside its columns.
The budget is therefore **five axes**:

| Letter | Axis | Example positions |
|---|---|---|
| `x` | year | 2026, 2027, … |
| `y` | month | Jan … Dec |
| `z` | category | total, debt, subscriptions, … |
| `i` | item | subtotal, item 1, item 2, … |
| `f` | field | name, amount |

The **item axis is jagged** — `i2` is *Ogen* under debt but *Claude* under
subscriptions, and counts differ per category. The hypercube treats
`(debt, i2)` and `(subs, i2)` as independent coordinates; sparseness means the
empty combinations cost nothing, and the *name* field gives each slot its
per-category meaning. Aggregating "across categories at a fixed item index" is
meaningless and never required, so jaggedness needs no special mechanism.

The model also supports **itemise-or-not**: debt fills three item slots, while
`living exp (cc)` can be six unnamed item slots — or a single cell holding a sum
— exactly as a real spreadsheet allows.

---

## The main view

Bind **rows = month (`y`)**, **columns = category (`z`)**; navigate
`year = 2026`. Reserve `z`-positions for label/total columns by **convention**
(no built-in reservation): `z1` total, real categories from `z2`. Each visible
cell is a category's monthly subtotal.

```
  year   month │  total          debt           subs
  ─────────────┼─────────────────────────────────────────
  2026   Apr   │  =SUM(z2:)      =SUM(i2:)      =SUM(i2:)
  2026   May   │  =SUM(z2:)      =SUM(i2:)      =SUM(i2:)
  2026   Jun   │  …              …              …
```

- The `2026` column is the **year fiber** — invariant across month, so it shows
  in every row.
- Each category cell is the **subtotal**, `=SUM(i2:)` — sum the item amounts
  from `i2` to the end of the item axis at this month and category. Written with
  relative references, it copies across categories and months untouched.
- The **total** column is `=SUM(z2:)` — sum the real categories from `z2` to the
  end. Because `total` sits at `z1`, the range starts at `z2` and excludes
  itself; no circularity.

(`=SUM(i2:)` shown here is the display form — the navigated `year`, `field`, and
this cell's own `month`/`category` components are elided because they match
context; the stored form is fully qualified.)

### Drilling in

Re-bind **rows = item (`i`)**, **columns = field (`f`)**; navigate
`category = debt`:

```
        name         amount
  i1    (subtotal)   =SUM(i2:)
  i2    Ogen         5000
  i3    Mercantile   3500
  i4    BTL          2500
```

Same data, different two axes on screen — the "pick any two axes, navigate the
rest" premise holding on real data.

---

## What this validated

- **The field axis was the missing piece.** A 2-D sheet smuggles name/amount
  into adjacent columns; promoting *item* and *time* to their own axes forces
  the field distinction to become an explicit axis.
- **Fibers are narrow and structural.** The year is a fiber. Rent and the debt
  items are *copied*, not fibered — they change and clear, and a fiber's
  immutable-by-override semantics would otherwise fight that. This sharpened the
  definition of a fiber to "genuinely invariant," not "happens to repeat."
- **Subtotals need no built-in feature.** They are ordinary formula cells the
  user places by convention. "Total across all categories" — which varies two
  axes and would need a 2-D range — is handled inside the v1 1-D limit by
  summing per-category subtotal cells along the category axis.
- **Labels need no built-in feature.** Category and month names are convention
  cells; `SUM` ignoring text keeps them safe in ranges; navigators handle
  hidden-axis legibility.
- **The 1-D range syntax is ergonomic.** `=SUM(i2:)` and `=SUM(z2:)` express the
  two aggregations the budget needs with no repeated coordinates and clean
  relative-copy behaviour.
