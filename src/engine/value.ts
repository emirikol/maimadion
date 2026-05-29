// Cell values: literal interpretation and display formatting. Pure (engine).
//
// A literal is the text the user typed; whether it reads as a number or text is
// decided here (a number for arithmetic/aggregation, otherwise text — which `SUM`
// and friends skip, per requirements §1.2). Display formatting trims binary-float
// noise so e.g. 0.1 + 0.2 shows as 0.3.

import type { CellValue, Computed } from './types';

// Integer/decimal/scientific, optionally signed. `1,000` and `0x10` are text.
const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export function literalToValue(raw: string): CellValue {
  const t = raw.trim();
  if (t !== '' && NUMERIC.test(t)) return { kind: 'number', n: Number(t) };
  return { kind: 'text', s: raw };
}

/** The string a computed result shows in the grid (errors and text verbatim). */
export function formatComputed(c: Computed): string {
  if ('error' in c) return c.error;
  switch (c.value.kind) {
    case 'empty':
      return '';
    case 'text':
      return c.value.s;
    case 'number':
      return formatNumber(c.value.n);
  }
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  // toPrecision(12) → Number drops trailing zeros and the float-noise tail.
  return String(Number(n.toPrecision(12)));
}
