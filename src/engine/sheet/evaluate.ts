import { SheetError } from './lexer';
import type { Expr } from './parser';

export type Value = number | string | boolean | null;   // null = an empty cell
export type Result = Value | Value[];                   // an array is a column vector
export type Scope = (name: string) => Result;

const AGGREGATES: Record<string, (xs: number[]) => number> = {
  sum: (xs) => xs.reduce((a, b) => a + b, 0),
  avg: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length,
  min: (xs) => Math.min(...xs),
  max: (xs) => Math.max(...xs),
  median: (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
};

export function evaluate(e: Expr, scope: Scope): Result {
  switch (e.k) {
    case 'num':
    case 'str':
    case 'bool':
      return e.v;
    case 'id':
      return scope(e.name);
    case 'un': {
      const v = scalar(evaluate(e.e, scope));
      if (e.op === 'not') return !truthy(v);
      return v === null ? null : -num(v);
    }
    case 'bin':
      return binop(e, scope);
    case 'cond':
      return truthy(scalar(evaluate(e.c, scope))) ? evaluate(e.a, scope) : evaluate(e.b, scope);
    case 'call':
      return call(e, scope);
  }
}

// Integers render bare; anything else at the table's precision.
export function render(v: Value, precision: number): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new SheetError('result is not a finite number');
    if (Math.abs(v) >= 1e21) throw new SheetError('value too large to render');
    // Exact integers need no noise-scrubbing (that's only for binary-representation
    // artifacts in non-integers), and toPrecision(15) would truncate large ones.
    if (Number.isInteger(v)) return String(v);
    // Doubles carry binary-representation noise (41 * 1.255 = 51.454999999999998…).
    // Round to ~15 significant digits to recover the decimal value a spreadsheet would show.
    const n = Number(v.toPrecision(15));
    if (Number.isInteger(n)) return String(n);
    // toFixed also suffers from binary representation ((51.455).toFixed(2) === '51.45'),
    // so shift the decimal point through toExponential() (format-proof, unlike a template
    // string built from String(n)) before rounding half away from zero.
    const [m, e] = n.toExponential().split('e');
    const shifted = Number(`${m}e${Number(e) + precision}`);
    // Shift back the same format-proof way: String(1.234567890125e21) is
    // exponential, so a template built from it would yield '…e+21e-10' → NaN.
    const [rm, re] = (Math.sign(shifted) * Math.round(Math.abs(shifted))).toExponential().split('e');
    const rounded = Number(`${rm}e${Number(re) - precision}`);
    return rounded.toFixed(precision);
  }
  // The type system says this is a string, but a formula that reaches a value
  // of any other shape must fail per-cell, not escape the sheet as an object.
  if (typeof v !== 'string') throw new SheetError('unsupported value');
  return v;
}

function binop(e: Extract<Expr, { k: 'bin' }>, scope: Scope): Result {
  if (e.op === 'and' || e.op === 'or') {
    const l = truthy(scalar(evaluate(e.l, scope)));
    if (e.op === 'and') return l ? truthy(scalar(evaluate(e.r, scope))) : false;
    return l ? true : truthy(scalar(evaluate(e.r, scope)));
  }

  const l = scalar(evaluate(e.l, scope));
  const r = scalar(evaluate(e.r, scope));
  if (l === null || r === null) return null;   // an empty cell propagates, it does not error

  switch (e.op) {
    case '+':  return num(l) + num(r);
    case '-':  return num(l) - num(r);
    case '*':  return num(l) * num(r);
    case '/':  if (num(r) === 0) throw new SheetError('division by zero'); return num(l) / num(r);
    case '%':  if (num(r) === 0) throw new SheetError('division by zero'); return num(l) % num(r);
    case '^':  return num(l) ** num(r);
    case '==': return l === r;
    case '!=': return l !== r;
    case '<':  return num(l) < num(r);
    case '<=': return num(l) <= num(r);
    case '>':  return num(l) > num(r);
    case '>=': return num(l) >= num(r);
  }
  throw new SheetError(`unknown operator '${e.op}'`);
}

function call(e: Extract<Expr, { k: 'call' }>, scope: Scope): Result {
  const name = e.name;
  const args = e.args.map((a) => evaluate(a, scope));
  const arity = (n: number) => {
    if (args.length !== n) throw new SheetError(`${name}() takes ${n} argument(s), got ${args.length}`);
  };

  if (name === 'count') return column(name, args).filter(present).length;

  // Own-property only: `in` would walk the prototype chain, making 'valueOf',
  // 'toString' & co. resolve to Object.prototype members. (Object.hasOwn needs
  // ES2022; this project's lib is ES2020.)
  if (Object.prototype.hasOwnProperty.call(AGGREGATES, name)) {
    const xs = column(name, args).filter(present);
    for (const v of xs) {
      if (typeof v !== 'number') throw new SheetError(`${name}() expected a number, got '${v}'`);
    }
    if (!xs.length && name !== 'sum') throw new SheetError(`${name}() of an empty column`);
    return AGGREGATES[name](xs as number[]);
  }

  switch (name) {
    case 'round': {
      arity(2);
      const f = 10 ** num(scalar(args[1]));
      return Math.round(num(scalar(args[0])) * f) / f;
    }
    case 'abs':   arity(1); return Math.abs(num(scalar(args[0])));
    case 'floor': arity(1); return Math.floor(num(scalar(args[0])));
    case 'ceil':  arity(1); return Math.ceil(num(scalar(args[0])));
    case 'if':    arity(3); return scalar(truthy(scalar(args[0])) ? args[1] : args[2]);
    case 'concat': return args.map((a) => String(scalar(a) ?? '')).join('');
  }

  throw new SheetError(`unknown function '${name}'`);
}

function column(name: string, args: Result[]): Value[] {
  if (args.length !== 1 || !Array.isArray(args[0])) {
    throw new SheetError(`${name}() takes one whole column`);
  }
  return args[0];
}

function present(v: Value): boolean {
  return v !== null;
}

function scalar(v: Result): Value {
  if (Array.isArray(v)) throw new SheetError('expected a single value, got a whole column');
  return v;
}

function num(v: Value): number {
  if (typeof v === 'number') return v;
  throw new SheetError(`expected a number, got '${v}'`);
}

function truthy(v: Value): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null) return false;
  return v !== '';
}
