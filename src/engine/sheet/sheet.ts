import { SheetError } from './lexer';
import { parseExpr } from './parser';
import { evaluate, render, type Result, type Scope, type Value } from './evaluate';
import { looksLikeProgressDirective, parseProgressDirective } from '../progressBar';

export interface SheetOpts {
  precision: number;
}

// "!sheet bom precision=3" → { precision: 3 }. A bare word (a table name, for
// the deferred cross-table references) is accepted and ignored. Never throws: a
// malformed option in a half-typed directive must not take the slide down.
export function parseSheetDirective(rest: string): SheetOpts {
  const opts: SheetOpts = { precision: 2 };
  for (const tok of rest.trim().split(/\s+/).filter(Boolean)) {
    const kv = tok.match(/^([a-z]+)=(.+)$/);
    if (kv && kv[1] === 'precision') {
      const n = Number(kv[2]);
      if (Number.isInteger(n) && n >= 0 && n <= 10) opts.precision = n;
    }
  }
  return opts;
}

// "Unit (€)" → "unit", "**With VAT**" → "with_vat". A collision after
// slugification is an error (below). `_` survives: it is a legal identifier
// character, and a header is far more likely to be `with_vat` than `_em_`.
export function slugify(header: string): string {
  return header
    .replace(/[*`~]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

// A leading `!` in the first cell marks a footer row. An ordinary label that
// starts with `!` escapes it as `\!` — the same escape `\=` uses for a literal
// that starts with `=`. (remark renders `\!` as a plain `!`, so the escape
// costs the author nothing in a non-Kova viewer.)
export function isFooterRow(row: string[]): boolean {
  const first = (row[0] ?? '').trim();
  return first.startsWith('!') && !looksLikeProgressDirective(first);
}

function hasFormula(raw: string[][], r: number): boolean {
  return (raw[r] ?? []).some((_, c) => cellFormula(cellText(raw, r, c)) !== null);
}

export function evaluateSheet(
  raw: string[][],
  opts: SheetOpts,
  constants: Map<string, Value>,
): (string | null)[][] {
  const header = raw[0] ?? [];
  const cols = header.map(slugify);
  const out: (string | null)[][] = raw.map((row) => row.map(() => null));

  // A table-wide problem (a duplicate column) has no single cell to blame, so
  // every formula cell reports it.
  const dup = cols.find((c, i) => c !== '' && cols.indexOf(c) !== i);
  if (dup) {
    forEachFormula(raw, (r, c) => { out[r][c] = `#ERR duplicate column name '${dup}'`; });
    return out;
  }

  const dataRows: number[] = [];
  const footerRows: number[] = [];
  for (let r = 1; r < raw.length; r++) (isFooterRow(raw[r]) ? footerRows : dataRows).push(r);

  // A footer row computes nothing, so it is almost certainly a data row whose
  // label just happens to start with `!` — and misreading it would drop that
  // row from every column vector, quietly deflating the totals below it. Say so
  // in the label cell instead: a wrong total with no error is the one outcome
  // this design refuses.
  for (const r of footerRows) {
    if (!hasFormula(raw, r)) {
      out[r][0] = "#ERR footer row has no formula — for a label starting with '!', escape it as '\\!'";
    }
  }

  const memo = new Map<string, Value>();
  const visiting = new Set<string>();

  function cell(r: number, c: number): Value {
    const key = `${r}:${c}`;
    if (memo.has(key)) return memo.get(key)!;
    if (visiting.has(key)) throw new SheetError(`circular reference in column '${cols[c]}'`);

    const text = cellText(raw, r, c);
    const formula = cellFormula(text);
    if (formula === null) {
      const v = literal(text);
      memo.set(key, v);
      return v;
    }

    // A failure is deliberately not memoized: null is the empty-cell sentinel,
    // so caching it here would make a broken cell look merely empty to every
    // dependent and turn a visible #ERR into silent blanks. Letting it throw
    // means dependents report an error too; re-evaluating costs nothing at this
    // table size.
    visiting.add(key);
    try {
      const scope = footerRows.includes(r) ? footerScope() : rowScope(r);
      const v = evaluate(parseExpr(formula), scope);
      if (Array.isArray(v)) throw new SheetError('expected a single value, got a whole column');
      memo.set(key, v);
      return v;
    } finally {
      visiting.delete(key);
    }
  }

  const constant = (name: string): Result => {
    if (constants.has(name)) return constants.get(name)!;
    throw new SheetError(`unknown column or constant '${name}'`);
  };

  // In a data row a bare name is this row's cell...
  const rowScope = (r: number): Scope => (name) => {
    const c = cols.indexOf(name);
    return c >= 0 ? cell(r, c) : constant(name);
  };

  // ...and in a footer row it is the whole data column, footers excluded.
  const footerScope = (): Scope => (name) => {
    const c = cols.indexOf(name);
    return c >= 0 ? dataRows.map((r) => cell(r, c)) : constant(name);
  };

  forEachFormula(raw, (r, c) => {
    try {
      const text = cellText(raw, r, c);
      const progress = parseProgressDirective(text);
      if (progress && 'formula' in progress) {
        const value = cell(r, c);
        if (typeof value !== 'number') throw new SheetError(`expected a number, got '${value}'`);
        out[r][c] = `!progress[${progress.label}](${render(value, opts.precision)})`;
      } else {
        out[r][c] = render(cell(r, c), opts.precision);
      }
    } catch (err) {
      out[r][c] = `#ERR ${err instanceof SheetError ? err.message : 'evaluation failed'}`;
    }
  });

  return out;
}

// The footer marker is not part of the cell's content.
function cellText(raw: string[][], r: number, c: number): string {
  const text = (raw[r]?.[c] ?? '').trim();
  if (r > 0 && c === 0 && isFooterRow(raw[r] ?? [])) return text.slice(1).trim();
  return text;
}

function forEachFormula(raw: string[][], fn: (r: number, c: number) => void): void {
  for (let r = 1; r < raw.length; r++) {
    for (let c = 0; c < raw[r].length; c++) {
      if (cellFormula(cellText(raw, r, c)) !== null) fn(r, c);
    }
  }
}

function cellFormula(text: string): string | null {
  if (text.startsWith('=')) return text.slice(1);
  const progress = parseProgressDirective(text);
  return progress && 'formula' in progress ? progress.formula : null;
}

function literal(text: string): Value {
  if (text === '') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return Number(text);
  // `\=` and `\!` escape the two markers, so drop the backslash from the value.
  return /^\\[=!]/.test(text) ? text.slice(1) : text;
}
