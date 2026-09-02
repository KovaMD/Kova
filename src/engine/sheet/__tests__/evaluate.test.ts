import { describe, it, expect } from 'vitest';
import { parseExpr } from '../parser';
import { evaluate, render, type Result, type Scope } from '../evaluate';
import { SheetError } from '../lexer';

const scope = (vars: Record<string, Result>): Scope => (name) => {
  if (name in vars) return vars[name];
  throw new SheetError(`unknown column or constant '${name}'`);
};

const run = (src: string, vars: Record<string, Result> = {}) => evaluate(parseExpr(src), scope(vars));

describe('evaluate', () => {
  it('does arithmetic with identifiers', () => {
    expect(run('qty * unit', { qty: 2, unit: 12.5 })).toBe(25);
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('2 ^ 3 ^ 2')).toBe(512);
    expect(run('-base', { base: 10 })).toBe(-10);
    expect(run('10 % 3')).toBe(1);
  });

  it('does comparisons, logic and the ternary', () => {
    expect(run('1 < 2')).toBe(true);
    expect(run('1 == 1 and 2 > 3')).toBe(false);
    expect(run('1 == 1 or 2 > 3')).toBe(true);
    expect(run('not (1 == 1)')).toBe(false);
    expect(run('x > 5 ? 1 : 0', { x: 10 })).toBe(1);
    expect(run('if(x == 10, 100, 0)', { x: 10 })).toBe(100);
  });

  it('propagates an empty cell instead of erroring', () => {
    expect(run('qty * unit', { qty: null, unit: 12.5 })).toBe(null);
    expect(run('qty + 1', { qty: null })).toBe(null);
  });

  it('runs the scalar functions', () => {
    expect(run('round(3.14159, 2)')).toBe(3.14);
    expect(run('abs(-7.5)')).toBe(7.5);
    expect(run('floor(2.9)')).toBe(2);
    expect(run('ceil(2.1)')).toBe(3);
    expect(run('concat("a", "-", 1)')).toBe('a-1');
  });

  it('runs the aggregate functions over a vector, skipping empties', () => {
    const col = { score: [91, 64, 88, null, 73] as Result };
    expect(run('sum(score)', col)).toBe(316);
    expect(run('count(score)', col)).toBe(4);
    expect(run('avg(score)', col)).toBe(79);
    expect(run('min(score)', col)).toBe(64);
    expect(run('max(score)', col)).toBe(91);
    expect(run('median(score)', col)).toBe(80.5);
  });

  it('errors on a non-numeric cell inside an aggregate', () => {
    expect(() => run('sum(score)', { score: [1, 'n/a'] })).toThrow(/expected a number/);
  });

  it('errors when a vector is used as a scalar', () => {
    expect(() => run('score * 2', { score: [1, 2] })).toThrow(/whole column/);
  });

  it('errors when an aggregate gets a scalar', () => {
    expect(() => run('sum(qty)', { qty: 2 })).toThrow(/whole column/);
  });

  it('errors on an unknown function and on division by zero', () => {
    expect(() => run('frobnicate(1)')).toThrow(/unknown function/);
    expect(() => run('1 / 0')).toThrow(/division by zero/);
  });

  it('rejects a function named like an Object.prototype member', () => {
    // `name in AGGREGATES` used to walk the prototype chain: valueOf(qty)
    // returned the AGGREGATES object itself, which escaped the sheet and blew
    // up the whole document downstream.
    const col = { qty: [1, 2] as Result };
    for (const fn of ['valueOf', 'toString', 'hasOwnProperty', 'constructor', '__lookupGetter__']) {
      expect(() => run(`${fn}(qty)`, col)).toThrow(SheetError);
      expect(() => run(`${fn}(qty)`, col)).toThrow(/unknown function/);
    }
  });

  it('errors on wrong arity', () => {
    expect(() => run('round(1)')).toThrow(/takes 2 argument/);
  });

  it('errors on an aggregate over a column containing an empty-string cell, instead of silently skipping it', () => {
    expect(() => run('sum(score)', { score: [1, '', 3] })).toThrow(/expected a number/);
  });

  it('counts an empty-string cell as present, unlike an empty (null) cell', () => {
    expect(run('count(score)', { score: ['', 'a', 'b'] })).toBe(3);
  });

  it('still skips a genuinely empty (null) cell in aggregates and count', () => {
    const col = { score: [1, null, 3] as Result };
    expect(run('sum(score)', col)).toBe(4);
    expect(run('count(score)', col)).toBe(2);
  });

  it('errors when if() returns a vector branch instead of leaking it as the result', () => {
    const col = { score: [1, 2, 3] as Result };
    expect(() => run('if(true, score, 0)', col)).toThrow(/whole column/);
  });
});

describe('render', () => {
  it('renders integers without decimals and floats at the given precision', () => {
    expect(render(25, 2)).toBe('25');
    expect(render(12.345, 2)).toBe('12.35');
    expect(render(3 / 7, 6)).toBe('0.428571');
  });

  it('renders empties, booleans and strings', () => {
    expect(render(null, 2)).toBe('');
    expect(render(true, 2)).toBe('true');
    expect(render('n/a', 2)).toBe('n/a');
  });

  it('throws on a non-finite number', () => {
    expect(() => render(NaN, 2)).toThrow(SheetError);
    expect(() => render(Infinity, 2)).toThrow(SheetError);
  });

  it('rounds away IEEE-double artifacts instead of leaking them into the output', () => {
    // 41 * 1.255 is 51.454999999999998… as a double; the true decimal value
    // is 51.455, which rounds half-up to 51.46 — not the truncated 51.45.
    expect(render(41 * 1.255, 2)).toBe('51.46');
    // 100 * 1.1 is 110.00000000000001 as a double, so it must still render bare.
    expect(render(100 * 1.1, 2)).toBe('110');
    // 0.1 + 0.2 is 0.30000000000000004 as a double.
    expect(render(0.1 + 0.2, 2)).toBe('0.30');
  });

  it('renders tiny values instead of leaking exponential notation into a NaN string', () => {
    // String(1e-7) is '1e-7'; naively appending 'e2' gives '1e-7e2', which
    // Number() cannot parse, producing the literal string 'NaN' in the cell.
    expect(render(2 / 3000000, 2)).toBe('0.00');
  });

  it('preserves values with more than 12 significant digits', () => {
    // toPrecision(12) used to silently truncate these to the wrong number.
    expect(render(999999999999 + 3, 2)).toBe('1000000000002');
    expect(render(1234567890123 * 1, 2)).toBe('1234567890123');
  });

  it('rounds half away from zero, like a spreadsheet, not half up', () => {
    expect(render(51.455, 2)).toBe('51.46');
    expect(render(-51.455, 2)).toBe('-51.46');
    expect(render(2.5, 0)).toBe('3');
    expect(render(-2.5, 0)).toBe('-3');
  });

  it('throws instead of rendering exponential notation for huge magnitudes', () => {
    // String(1e21) is '1e+21'; past this magnitude both String() and toFixed()
    // switch to exponential notation, which must not land in a cell as text.
    expect(() => render(1e21, 2)).toThrow(SheetError);
    expect(() => render(-1e21, 2)).toThrow(SheetError);
  });

  it('keeps exact-integer doubles exact instead of truncating them via toPrecision(15)', () => {
    expect(render(Number.MAX_SAFE_INTEGER, 2)).toBe('9007199254740991');
  });

  it('renders a large non-integer at high precision instead of the string NaN', () => {
    // |v| * 10^precision >= 1e21, so String() of the shifted value is
    // exponential: a template built from it used to yield '…e+21e-10' → NaN.
    expect(render(123456789012.5 + 0.25, 10)).toBe('123456789012.7500000000');
    expect(render(-(123456789012.5 + 0.25), 10)).toBe('-123456789012.7500000000');
    expect(render(51.455, 10)).toBe('51.4550000000');
  });
});
