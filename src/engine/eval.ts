// Evaluator — mirrors tech-design §7. Pure, bottom-up over the AST, given a
// `read(CellKey): Computed` closure (the caller applies explicit-cell / fiber
// resolution, §9). No notion of the viewport — resolution and eval are
// viewport-independent (design.md §9).
//
// - num/str/error → literal / short-circuit.
// - ref → read(resolve(ref)); unresolvable → #REF!.
// - unary -, binary + - * / → numeric; / by 0 → #DIV/0!; a text operand where a
//   number is required → #VALUE!; an empty operand coerces to 0.
// - call → SUM/AVERAGE/MIN/MAX/COUNT over flattened args (range args expand to their
//   members). Numeric aggregations skip empty/text cells; COUNT counts numerics;
//   AVERAGE over no numerics → #DIV/0!; MIN/MAX over none → 0; unknown fn → #NAME?.
// - Error propagation: a CellError operand propagates (first encountered wins);
//   aggregators skip empties/text but still propagate a genuine error from a member.

import { resolveCell, resolveRange } from './resolve';
import type { Axis, CellError, CellKey, Computed, Expr } from './types';

export type Read = (key: CellKey) => Computed;
export interface EvalContext {
  axes: Axis[];
  read: Read;
}

const err = (e: CellError): Computed => ({ error: e });
const num = (n: number): Computed => ({ value: { kind: 'number', n } });
const isError = (c: Computed): c is { error: CellError } => 'error' in c;

/** Coerce to a number for arithmetic: empty → 0, text → #VALUE!, error → propagate. */
function toNumber(c: Computed): number | CellError {
  if (isError(c)) return c.error;
  if (c.value.kind === 'number') return c.value.n;
  if (c.value.kind === 'empty') return 0;
  return '#VALUE!';
}

export function evaluate(expr: Expr, ctx: EvalContext): Computed {
  switch (expr.kind) {
    case 'num':
      return num(expr.n);
    case 'str':
      return { value: { kind: 'text', s: expr.s } };
    case 'error':
      return err(expr.code);
    case 'ref': {
      const key = resolveCell(expr.ref, ctx.axes);
      return key === '#REF!' ? err('#REF!') : ctx.read(key);
    }
    case 'rangeRef':
      return err('#VALUE!'); // a range used where a scalar is expected
    case 'unary': {
      const n = toNumber(evaluate(expr.arg, ctx));
      return typeof n === 'string' ? err(n) : num(-n);
    }
    case 'binary': {
      const l = toNumber(evaluate(expr.l, ctx));
      if (typeof l === 'string') return err(l);
      const r = toNumber(evaluate(expr.r, ctx));
      if (typeof r === 'string') return err(r);
      switch (expr.op) {
        case '+':
          return num(l + r);
        case '-':
          return num(l - r);
        case '*':
          return num(l * r);
        case '/':
          return r === 0 ? err('#DIV/0!') : num(l / r);
        default:
          return err('#VALUE!'); // unreachable
      }
    }
    case 'call':
      return evalCall(expr, ctx);
  }
}

function evalCall(expr: Extract<Expr, { kind: 'call' }>, ctx: EvalContext): Computed {
  // Flatten args; a range arg expands to its member values.
  const items: Computed[] = [];
  for (const arg of expr.args) {
    if (arg.kind === 'rangeRef') {
      const keys = resolveRange(arg.ref, ctx.axes);
      if (keys === '#REF!') return err('#REF!');
      for (const k of keys) items.push(ctx.read(k));
    } else {
      items.push(evaluate(arg, ctx));
    }
  }
  for (const it of items) if (isError(it)) return it; // propagate a member error
  const nums: number[] = [];
  for (const it of items) if (!isError(it) && it.value.kind === 'number') nums.push(it.value.n);
  const sum = nums.reduce((a, b) => a + b, 0);

  switch (expr.fn.toUpperCase()) {
    case 'SUM':
      return num(sum);
    case 'COUNT':
      return num(nums.length);
    case 'AVERAGE':
      return nums.length === 0 ? err('#DIV/0!') : num(sum / nums.length);
    case 'MIN':
      return num(nums.length === 0 ? 0 : Math.min(...nums));
    case 'MAX':
      return num(nums.length === 0 ? 0 : Math.max(...nums));
    default:
      return err('#NAME?');
  }
}
