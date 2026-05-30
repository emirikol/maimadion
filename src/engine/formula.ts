// Formula-level transforms tying the parser, the address codec, and elision together
// (tech-design §6). Authoring flow: parse the typed body (refs partial) → expand each
// reference against the authoring context → print a canonical, fully-qualified `src`
// for storage. Display flow: print the stored AST against the *current* context so
// components matching it are elided (the formula-bar form). Pure (engine).

import { completeRef, formatRef } from './coord';
import { parseFormula, ParseError } from './parse';
import type { Axis, CellInput, Coord, Expr } from './types';

/** Complete every reference in an AST against the authoring context (§6 author→store). */
export function expandExpr(expr: Expr, context: Coord, axes: Axis[]): Expr {
  switch (expr.kind) {
    case 'ref':
      return { kind: 'ref', ref: completeRef(expr.ref, context, axes) };
    case 'rangeRef':
      return { kind: 'rangeRef', ref: completeRef(expr.ref, context, axes) };
    case 'unary':
      return { kind: 'unary', op: expr.op, arg: expandExpr(expr.arg, context, axes) };
    case 'binary':
      return {
        kind: 'binary',
        op: expr.op,
        l: expandExpr(expr.l, context, axes),
        r: expandExpr(expr.r, context, axes),
      };
    case 'call':
      return { kind: 'call', fn: expr.fn, args: expr.args.map((a) => expandExpr(a, context, axes)) };
    default:
      return expr; // num, str, error — nothing to expand
  }
}

const BP: Record<string, number> = { '+': 10, '-': 10, '*': 20, '/': 20 };

/**
 * Print an AST back to formula text. With a `context`, references show their elided
 * display form (§6); without one, fully qualified (the stored `src`). Precedence-aware
 * (and parenthesizing only where needed) so the output re-parses to an equivalent
 * expression.
 */
export function printExpr(expr: Expr, axes: Axis[], context?: Coord, parentBp = 0): string {
  switch (expr.kind) {
    case 'num':
      return String(expr.n);
    case 'str':
      return `"${expr.s}"`;
    case 'error':
      return ''; // the raw src is preserved separately (see displayFormula / compileFormula)
    case 'ref':
    case 'rangeRef':
      return formatRef(expr.ref, axes, context);
    case 'unary':
      return `-${printExpr(expr.arg, axes, context, 30)}`;
    case 'call':
      return `${expr.fn.toUpperCase()}(${expr.args
        .map((a) => printExpr(a, axes, context, 0))
        .join(', ')})`;
    case 'binary': {
      const bp = BP[expr.op]!;
      // Left child at the same bp (left-assoc), right child one higher so an equal-
      // precedence right operand parenthesizes.
      const s = `${printExpr(expr.l, axes, context, bp)} ${expr.op} ${printExpr(
        expr.r,
        axes,
        context,
        bp + 1,
      )}`;
      return bp < parentBp ? `(${s})` : s;
    }
  }
}

/**
 * Compile a formula body (text after `=`) into a stored formula input: parse, expand
 * against context, and render a canonical fully-qualified `src`. A parse error keeps
 * the raw body and an error AST, so the cell evaluates to #NAME? while the source
 * round-trips for editing.
 */
export function compileFormula(body: string, context: Coord, axes: Axis[]): CellInput {
  try {
    const ast = expandExpr(parseFormula(body, axes), context, axes);
    return { kind: 'formula', src: `=${printExpr(ast, axes)}`, ast };
  } catch (e) {
    if (e instanceof ParseError) {
      return { kind: 'formula', src: `=${body}`, ast: { kind: 'error', code: '#NAME?' } };
    }
    throw e;
  }
}

/** The elided display form of a stored formula against the current context (§6). */
export function displayFormula(
  input: { src: string; ast: Expr },
  context: Coord,
  axes: Axis[],
): string {
  if (input.ast.kind === 'error') return input.src; // raw text round-trips as-is
  return `=${printExpr(input.ast, axes, context)}`;
}
