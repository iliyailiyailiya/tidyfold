/**
 * A small, typed expression language for calculated columns.
 *
 * This is deliberately NOT SQL: the UI builds an AST, we type-check it against
 * the current schema, then compile it with `ident()` / `literal()` only. A
 * column called `a"; DROP TABLE x; --` is just an identifier to us.
 */
import { ident, literal } from '../duckdb/sql';
import { DUCKDB_TYPE } from '../import/infer';
import type { ColumnType } from '../import/types';
import { OperationError } from './errors';
import type { ColumnSchema } from './operations';

export type CalcNode =
  | { kind: 'column'; name: string }
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'binary'; op: 'add' | 'subtract' | 'multiply' | 'divide' | 'concat'; left: CalcNode; right: CalcNode }
  | { kind: 'round'; value: CalcNode; digits: number }
  | { kind: 'upper' | 'lower'; value: CalcNode }
  | { kind: 'ifEmpty'; value: CalcNode; fallback: CalcNode }
  | { kind: 'datePart'; part: 'year' | 'month' | 'day'; value: CalcNode }
  | { kind: 'daysBetween'; from: CalcNode; to: CalcNode };

export const MAX_CALC_DEPTH = 24;
const MAX_TEXT_LENGTH = 10_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural validation, also used when reading a recipe from a file. */
export function isCalcNode(v: unknown, depth = 0): v is CalcNode {
  if (depth > MAX_CALC_DEPTH || !isObject(v) || typeof v.kind !== 'string') return false;
  const kids: unknown[] = [];
  switch (v.kind) {
    case 'column':
      return typeof v.name === 'string' && v.name.length <= 1000;
    case 'number':
      return typeof v.value === 'number' && Number.isFinite(v.value);
    case 'text':
      return typeof v.value === 'string' && v.value.length <= MAX_TEXT_LENGTH;
    case 'binary':
      if (!['add', 'subtract', 'multiply', 'divide', 'concat'].includes(v.op as string)) return false;
      kids.push(v.left, v.right);
      break;
    case 'round':
      if (!Number.isInteger(v.digits) || (v.digits as number) < 0 || (v.digits as number) > 15) return false;
      kids.push(v.value);
      break;
    case 'upper':
    case 'lower':
      kids.push(v.value);
      break;
    case 'ifEmpty':
      kids.push(v.value, v.fallback);
      break;
    case 'datePart':
      if (!['year', 'month', 'day'].includes(v.part as string)) return false;
      kids.push(v.value);
      break;
    case 'daysBetween':
      kids.push(v.from, v.to);
      break;
    default:
      return false;
  }
  return kids.every((k) => isCalcNode(k, depth + 1));
}

export interface CompiledCalc {
  sql: string;
  type: ColumnType;
  /** Divisor expressions, for the preview's division-by-zero warning. */
  divisors: string[];
}

const numeric = (t: ColumnType) => t === 'integer' || t === 'decimal';
const temporal = (t: ColumnType) => t === 'date' || t === 'timestamp';
const label = (t: ColumnType) => ({ text: 'text', integer: 'a whole number', decimal: 'a number', boolean: 'true/false', date: 'a date', timestamp: 'a date and time' })[t];

/** Type-checks and compiles an AST to one SQL scalar expression. */
export function compileCalc(node: CalcNode, schema: ColumnSchema[], depth = 0): CompiledCalc {
  if (depth > MAX_CALC_DEPTH) throw new OperationError('The formula is nested too deeply.');
  const go = (n: CalcNode) => compileCalc(n, schema, depth + 1);
  const expect = (got: ColumnType, want: (t: ColumnType) => boolean, what: string) => {
    if (!want(got)) throw new OperationError(`Expected ${what} in the formula, got ${label(got)}.`);
  };

  switch (node.kind) {
    case 'column': {
      const col = schema.find((c) => c.name === node.name);
      if (!col) throw new OperationError(`Column "${node.name}" doesn't exist at this step.`);
      return { sql: ident(col.name), type: col.type, divisors: [] };
    }
    case 'number':
      // Number.isFinite is checked by isCalcNode; keep the guard for hand-built ASTs.
      if (!Number.isFinite(node.value)) throw new OperationError("A number in the formula isn't finite.");
      return { sql: `CAST(${String(node.value)} AS DOUBLE)`, type: 'decimal', divisors: [] };
    case 'text':
      return { sql: `CAST(${literal(node.value)} AS VARCHAR)`, type: 'text', divisors: [] };
    case 'binary': {
      const a = go(node.left);
      const b = go(node.right);
      const divisors = [...a.divisors, ...b.divisors];
      if (node.op === 'concat') {
        return { sql: `(CAST(${a.sql} AS VARCHAR) || CAST(${b.sql} AS VARCHAR))`, type: 'text', divisors };
      }
      expect(a.type, numeric, 'a number on the left');
      expect(b.type, numeric, 'a number on the right');
      const op = { add: '+', subtract: '-', multiply: '*', divide: '/' }[node.op];
      if (!op) throw new OperationError('Unknown calculation.');
      if (node.op === 'divide') {
        divisors.push(`(${b.sql}) = 0`);
        return { sql: `(${a.sql} / NULLIF(${b.sql}, 0))`, type: 'decimal', divisors };
      }
      return { sql: `(${a.sql} ${op} ${b.sql})`, type: 'decimal', divisors };
    }
    case 'round': {
      const v = go(node.value);
      expect(v.type, numeric, 'a number to round');
      return { sql: `round(CAST(${v.sql} AS DOUBLE), ${node.digits})`, type: 'decimal', divisors: v.divisors };
    }
    case 'upper':
    case 'lower': {
      const v = go(node.value);
      expect(v.type, (t) => t === 'text', 'text');
      return { sql: `${node.kind}(${v.sql})`, type: 'text', divisors: v.divisors };
    }
    case 'ifEmpty': {
      const v = go(node.value);
      const f = go(node.fallback);
      expect(v.type, (t) => t === 'text', 'text');
      expect(f.type, (t) => t === 'text', 'text');
      return {
        sql: `(CASE WHEN ${v.sql} IS NULL OR trim(${v.sql}) = '' THEN ${f.sql} ELSE ${v.sql} END)`,
        type: 'text',
        divisors: [...v.divisors, ...f.divisors],
      };
    }
    case 'datePart': {
      const v = go(node.value);
      expect(v.type, temporal, 'a date');
      return { sql: `${node.part}(CAST(${v.sql} AS ${DUCKDB_TYPE[v.type]}))`, type: 'integer', divisors: v.divisors };
    }
    case 'daysBetween': {
      const a = go(node.from);
      const b = go(node.to);
      expect(a.type, temporal, 'a date');
      expect(b.type, temporal, 'a date');
      return {
        sql: `date_diff('day', CAST(${a.sql} AS ${DUCKDB_TYPE[a.type]}), CAST(${b.sql} AS ${DUCKDB_TYPE[b.type]}))`,
        type: 'integer',
        divisors: [...a.divisors, ...b.divisors],
      };
    }
  }
}

/** A readable sentence for the builder, e.g. "price × quantity, rounded to 2 decimals". */
export function describeCalc(node: CalcNode, schema: ColumnSchema[]): string {
  const name = (n: string) => schema.find((c) => c.name === n)?.name ?? n;
  const go = (n: CalcNode): string => {
    switch (n.kind) {
      case 'column':
        return name(n.name);
      case 'number':
        return String(n.value);
      case 'text':
        return `“${n.value}”`;
      case 'binary': {
        const a = go(n.left);
        const b = go(n.right);
        switch (n.op) {
          case 'add': return `${a} + ${b}`;
          case 'subtract': return `${a} − ${b}`;
          case 'multiply': return `${a} × ${b}`;
          case 'divide': return `${a} ÷ ${b}`;
          case 'concat': return `${a} joined with ${b}`;
        }
        break;
      }
      case 'round':
        return `${go(n.value)}, rounded to ${n.digits} decimal${n.digits === 1 ? '' : 's'}`;
      case 'upper':
        return `${go(n.value)} in UPPERCASE`;
      case 'lower':
        return `${go(n.value)} in lowercase`;
      case 'ifEmpty':
        return `if ${go(n.value)} is empty, use ${go(n.fallback)}`;
      case 'datePart':
        return `${n.part} of ${go(n.value)}`;
      case 'daysBetween':
        return `days from ${go(n.from)} to ${go(n.to)}`;
    }
    return '?';
  };
  return go(node);
}

/**
 * RE2 doesn't allow backreferences or look-around; catching those here (and
 * checking bracket balance) gives a useful message before DuckDB runs anything.
 */
export function validateRegex(pattern: string): string | null {
  if (pattern === '') return 'Enter a pattern to match.';
  let escaped = false;
  let inClass = false;
  let parens = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (escaped) {
      if (/[1-9]/.test(ch)) return `Backreferences like \\${ch} aren't supported. Try a simpler pattern.`;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === '(') {
      if (pattern.slice(i, i + 3).startsWith('(?=') || pattern.slice(i, i + 3).startsWith('(?!') || pattern.slice(i, i + 4).startsWith('(?<=') || pattern.slice(i, i + 4).startsWith('(?<!')) {
        return "Look-ahead and look-behind aren't supported. Try matching the whole value instead.";
      }
      parens++;
    } else if (ch === ')') {
      parens--;
      if (parens < 0) return 'There is a closing bracket ) without an opening bracket (.';
    }
  }
  if (escaped) return 'The pattern ends with a dangling backslash.';
  if (inClass) return 'A character class [ is missing its closing ].';
  if (parens > 0) return 'A group ( is missing its closing ).';
  return null;
}
