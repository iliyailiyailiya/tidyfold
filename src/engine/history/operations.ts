import { ident, literal } from '../duckdb/sql';
import { DUCKDB_TYPE, matchesType, TYPE_LABEL } from '../import/infer';
import type { ColumnType } from '../import/types';

export interface ColumnSchema {
  name: string;
  type: ColumnType;
}

/** The internal row-id column; present in every step, never shown as data. */
export const ROW_ID = '__row';

export type CaseMode = 'lower' | 'upper' | 'title';
export type DateOrder = 'DMY' | 'MDY' | 'YMD';
export type DecimalSeparator = '.' | ',';

export type OperationSpec =
  | { kind: 'rename_column'; params: { column: string; to: string } }
  | { kind: 'remove_column'; params: { column: string } }
  | { kind: 'trim_whitespace'; params: { columns: string[]; collapseInner?: boolean } }
  | { kind: 'change_case'; params: { column: string; mode: CaseMode } }
  | { kind: 'remove_duplicates'; params: { columns: string[] } }
  | {
      kind: 'replace_values';
      params: { column: string; find: string; replace: string; match: 'exact' | 'contains'; matchCase: boolean };
    }
  | { kind: 'fill_missing'; params: { column: string; mode: 'value' | 'down' | 'up'; value?: string } }
  | { kind: 'standardize_dates'; params: { column: string; order: DateOrder } }
  | { kind: 'normalize_numbers'; params: { column: string; decimal: DecimalSeparator } }
  | { kind: 'change_type'; params: { column: string; to: ColumnType } }
  | { kind: 'merge_values'; params: { column: string; merges: { from: string[]; to: string }[] } };

export const OPERATION_KINDS: readonly OperationSpec['kind'][] = [
  'rename_column',
  'remove_column',
  'trim_whitespace',
  'change_case',
  'remove_duplicates',
  'replace_values',
  'fill_missing',
  'standardize_dates',
  'normalize_numbers',
  'change_type',
  'merge_values',
];

export type OperationKind = OperationSpec['kind'];

export type Operation = OperationSpec & { id: string; createdAt: string };

const WS = '[\\s\\x{00A0}\\x{2000}-\\x{200B}\\x{3000}\\x{FEFF}]';
export const TRIM_PATTERN = `'^${WS}+|${WS}+$'`;

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationError';
  }
}

export interface CompiledOperation {
  /** A SELECT reading from `input`. */
  sql: string;
  schema: ColumnSchema[];
  /** For each output column, the input column it derives from (for diffs). */
  sources: string[];
}

/** SQL expression for "this cell is missing" (null, or blank text). */
export function isMissingSql(col: ColumnSchema): string {
  const c = ident(col.name);
  return col.type === 'text' ? `(${c} IS NULL OR trim(${c}) = '')` : `${c} IS NULL`;
}

function requireText(schema: ColumnSchema[], name: string): ColumnSchema {
  const col = requireColumn(schema, name);
  if (col.type !== 'text') throw new OperationError(`"${name}" isn't a text column. Convert it to text first.`);
  return col;
}

/** Escapes text for use as an RE2 pattern. */
export function regexEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DATE_FORMATS: Record<DateOrder, string[]> = {
  YMD: ['%Y-%m-%d', '%Y/%m/%d', '%Y.%m.%d', '%Y%m%d'],
  // Two-digit-year formats first: %Y would happily read "24" as year 0024,
  // while %y can't fully match a four-digit year, so the order is safe.
  DMY: ['%d/%m/%y', '%d-%m-%y', '%d.%m.%y', '%d/%m/%Y', '%d-%m-%Y', '%d.%m.%Y'],
  MDY: ['%m/%d/%y', '%m-%d-%y', '%m.%d.%y', '%m/%d/%Y', '%m-%d-%Y', '%m.%d.%Y'],
};
// Unambiguous textual formats, accepted with any order.
const TEXT_DATE_FORMATS = ['%Y-%m-%d', '%d %B %Y', '%d %b %Y', '%B %d, %Y', '%b %d, %Y', '%B %d %Y', '%b %d %Y', '%d-%b-%y', '%d-%b-%Y'];

export function dateFormats(order: DateOrder): string[] {
  return [...new Set([...DATE_FORMATS[order], ...TEXT_DATE_FORMATS])];
}

/** Parsed ISO date text, or NULL if the value isn't a date in this order. */
export function parsedDateSql(colSql: string, order: DateOrder): string {
  const fmts = `[${dateFormats(order).map(literal).join(', ')}]`;
  return `strftime(try_strptime(trim(${colSql}), ${fmts}), '%Y-%m-%d')`;
}

/** Canonical number text ("-1234.5"), or NULL if the value isn't a number. */
export function parsedNumberSql(colSql: string, decimal: DecimalSeparator): string {
  // strip spaces (incl. nbsp / narrow nbsp), apostrophes, currency symbols
  let s = `regexp_replace(trim(${colSql}), '[\\s\\x{00A0}\\x{202F}''’$€£¥₹₽]', '', 'g')`;
  // (123) accounting negatives
  s = `regexp_replace(${s}, '^\\((.*)\\)$', '-\\1')`;
  s = decimal === ',' ? `replace(replace(${s}, '.', ''), ',', '.')` : `replace(${s}, ',', '')`;
  s = `regexp_replace(${s}, '^\\+', '')`;
  return `CASE WHEN regexp_full_match(${s}, '-?(\\d+(\\.\\d*)?|\\.\\d+)') THEN regexp_replace(regexp_replace(${s}, '\\.$', ''), '^(-?)\\.', '\\10.') END`;
}

/** Which type conversions are allowed directly (others go via text). */
export function canConvert(from: ColumnType, to: ColumnType): boolean {
  if (from === to) return false;
  if (to === 'text' || from === 'text') return true;
  const ok: Partial<Record<ColumnType, ColumnType[]>> = {
    integer: ['decimal'],
    decimal: ['integer'],
    date: ['timestamp'],
    timestamp: ['date'],
  };
  return ok[from]?.includes(to) ?? false;
}

/**
 * Strict conversion: any value that can't be converted exactly aborts the
 * operation with an error naming it, so nothing is ever silently nulled.
 */
export function convertSql(col: ColumnSchema, to: ColumnType): string {
  const c = ident(col.name);
  const T = DUCKDB_TYPE[to];
  if (to === 'text') return `CAST(${c} AS VARCHAR)`;
  if (col.type === 'text') {
    const v = `trim(${c})`;
    return `CASE WHEN ${c} IS NULL OR ${v} = '' THEN NULL WHEN TRY_CAST(${v} AS ${T}) IS NULL THEN error(${literal(`Can't convert to ${TYPE_LABEL[to].toLowerCase()}: `)} || ${c}) ELSE TRY_CAST(${v} AS ${T}) END`;
  }
  if (col.type === 'decimal' && to === 'integer') {
    return `CASE WHEN ${c} IS NULL THEN NULL WHEN ${c} <> trunc(${c}) OR abs(${c}) > 9e17 THEN error('Not a whole number: ' || CAST(${c} AS VARCHAR)) ELSE CAST(${c} AS BIGINT) END`;
  }
  if (col.type === 'timestamp' && to === 'date') {
    return `CASE WHEN ${c} IS NULL THEN NULL WHEN CAST(${c} AS TIME) <> TIME '00:00:00' THEN error('Has a time of day: ' || CAST(${c} AS VARCHAR)) ELSE CAST(${c} AS DATE) END`;
  }
  return `CAST(${c} AS ${T})`;
}

function requireColumn(schema: ColumnSchema[], name: string): ColumnSchema {
  const col = schema.find((c) => c.name === name);
  if (!col) throw new OperationError(`Column "${name}" doesn't exist at this step.`);
  return col;
}

function selectList(schema: ColumnSchema[], override: (c: ColumnSchema) => string | null = () => null): string {
  return [ident(ROW_ID), ...schema.map((c) => override(c) ?? ident(c.name))].join(', ');
}

const names = (schema: ColumnSchema[]) => schema.map((c) => c.name);

/** Replace one column's expression, keeping everything else. */
function mapColumn(schema: ColumnSchema[], column: string, expr: string, from: string, newType?: ColumnType): CompiledOperation {
  return {
    sql: `SELECT ${selectList(schema, (c) => (c.name === column ? `${expr} AS ${ident(c.name)}` : null))} FROM ${from}`,
    schema: newType ? schema.map((c) => (c.name === column ? { ...c, type: newType } : c)) : schema,
    sources: names(schema),
  };
}

export function compileOperation(op: OperationSpec, schema: ColumnSchema[], input: string): CompiledOperation {
  const from = ident(input);
  switch (op.kind) {
    case 'rename_column': {
      const { column, to } = op.params;
      requireColumn(schema, column);
      const target = to.trim();
      if (!target) throw new OperationError('The new name is empty.');
      if (target === ROW_ID) throw new OperationError(`"${ROW_ID}" is reserved.`);
      if (target !== column && schema.some((c) => c.name.toLowerCase() === target.toLowerCase() && c.name !== column)) {
        throw new OperationError(`A column named "${target}" already exists.`);
      }
      return {
        sql: `SELECT ${selectList(schema, (c) => (c.name === column ? `${ident(c.name)} AS ${ident(target)}` : null))} FROM ${from}`,
        schema: schema.map((c) => (c.name === column ? { ...c, name: target } : c)),
        sources: names(schema),
      };
    }
    case 'remove_column': {
      requireColumn(schema, op.params.column);
      const rest = schema.filter((c) => c.name !== op.params.column);
      if (rest.length === 0) throw new OperationError("Can't remove the last column.");
      return { sql: `SELECT ${selectList(rest)} FROM ${from}`, schema: rest, sources: names(rest) };
    }
    case 'trim_whitespace': {
      const cols = new Set(op.params.columns);
      if (cols.size === 0) throw new OperationError('Choose at least one column.');
      for (const c of cols) requireText(schema, c);
      // Strips leading/trailing whitespace incl. non-breaking & zero-width spaces.
      // Inner runs are collapsed to one space only when asked to.
      const expr = (c: string) => {
        const trimmed = `regexp_replace(${ident(c)}, ${TRIM_PATTERN}, '', 'g')`;
        return op.params.collapseInner ? `regexp_replace(${trimmed}, '${WS}{2,}', ' ', 'g')` : trimmed;
      };
      return {
        sql: `SELECT ${selectList(schema, (c) => (cols.has(c.name) ? `${expr(c.name)} AS ${ident(c.name)}` : null))} FROM ${from}`,
        schema,
        sources: names(schema),
      };
    }
    case 'change_case': {
      const { column, mode } = op.params;
      requireText(schema, column);
      const c = ident(column);
      const expr =
        mode === 'lower'
          ? `lower(${c})`
          : mode === 'upper'
            ? `upper(${c})`
            : `array_to_string(list_transform(string_split(lower(${c}), ' '), lambda w: upper(left(w, 1)) || substr(w, 2)), ' ')`;
      return mapColumn(schema, column, expr, from);
    }
    case 'remove_duplicates': {
      const keys = op.params.columns.length > 0 ? op.params.columns : schema.map((c) => c.name);
      for (const k of keys) requireColumn(schema, k);
      // Keeps the first occurrence (lowest original row number).
      return {
        sql: `SELECT * FROM ${from} QUALIFY row_number() OVER (PARTITION BY ${keys.map(ident).join(', ')} ORDER BY ${ident(ROW_ID)}) = 1`,
        schema,
        sources: names(schema),
      };
    }
    case 'replace_values': {
      const { column, find, replace, match, matchCase } = op.params;
      requireText(schema, column);
      if (find === '') throw new OperationError('Enter the text to find.');
      const c = ident(column);
      let expr: string;
      if (match === 'exact') {
        const cond = matchCase ? `${c} = ${literal(find)}` : `lower(${c}) = lower(${literal(find)})`;
        expr = `CASE WHEN ${cond} THEN ${literal(replace)} ELSE ${c} END`;
      } else if (matchCase) {
        expr = `replace(${c}, ${literal(find)}, ${literal(replace)})`;
      } else {
        expr = `regexp_replace(${c}, ${literal(regexEscape(find))}, ${literal(replace.replace(/\\/g, '\\\\'))}, 'gi')`;
      }
      return mapColumn(schema, column, expr, from);
    }
    case 'fill_missing': {
      const { column, mode, value } = op.params;
      const col = requireColumn(schema, column);
      const c = ident(column);
      const missing = isMissingSql(col);
      if (mode === 'value') {
        const v = value ?? '';
        if (v.trim() === '') throw new OperationError('Enter a value to fill in.');
        if (col.type !== 'text' && !matchesType(v, col.type)) {
          throw new OperationError(`“${v}” isn't a valid ${TYPE_LABEL[col.type].toLowerCase()} for this column.`);
        }
        const lit = col.type === 'text' ? literal(v) : `CAST(${literal(v)} AS ${DUCKDB_TYPE[col.type]})`;
        return mapColumn(schema, column, `CASE WHEN ${missing} THEN ${lit} ELSE ${c} END`, from);
      }
      // Fill from the nearest non-missing value above/below, in original row order.
      const present = `CASE WHEN ${missing} THEN NULL ELSE ${c} END`;
      const frame =
        mode === 'down'
          ? `last_value(${present} IGNORE NULLS) OVER (ORDER BY ${ident(ROW_ID)} ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)`
          : `first_value(${present} IGNORE NULLS) OVER (ORDER BY ${ident(ROW_ID)} ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING)`;
      return mapColumn(schema, column, `CASE WHEN ${missing} THEN coalesce(${frame}, ${c}) ELSE ${c} END`, from);
    }
    case 'standardize_dates': {
      const { column, order } = op.params;
      requireText(schema, column);
      const c = ident(column);
      // Unparseable values are left exactly as they were.
      return mapColumn(schema, column, `coalesce(${parsedDateSql(c, order)}, ${c})`, from);
    }
    case 'normalize_numbers': {
      const { column, decimal } = op.params;
      requireText(schema, column);
      const c = ident(column);
      return mapColumn(schema, column, `coalesce(${parsedNumberSql(c, decimal)}, ${c})`, from);
    }
    case 'merge_values': {
      const { column, merges } = op.params;
      requireText(schema, column);
      const pairs = new Map<string, string>();
      for (const m of merges) {
        if (m.to.trim() === '') throw new OperationError('A merged value is empty. Choose what to merge into.');
        for (const f of m.from) {
          if (f === m.to) continue;
          const prior = pairs.get(f);
          if (prior !== undefined && prior !== m.to) throw new OperationError(`“${f}” is in two groups that merge into different values.`);
          pairs.set(f, m.to);
        }
      }
      if (pairs.size === 0) throw new OperationError('Choose at least one group of values to merge.');
      // Exact, byte-for-byte matching on the original values.
      const c = ident(column);
      const whens = [...pairs].map(([f, t]) => `WHEN ${literal(f)} THEN ${literal(t)}`).join(' ');
      return mapColumn(schema, column, `CASE ${c} ${whens} ELSE ${c} END`, from);
    }
    case 'change_type': {
      const { column, to } = op.params;
      const col = requireColumn(schema, column);
      if (col.type === to) throw new OperationError(`“${column}” is already ${TYPE_LABEL[to].toLowerCase()}.`);
      if (!canConvert(col.type, to)) {
        throw new OperationError(`Can't convert ${TYPE_LABEL[col.type].toLowerCase()} to ${TYPE_LABEL[to].toLowerCase()} directly. Convert to text first.`);
      }
      return mapColumn(schema, column, convertSql(col, to), from, to);
    }
  }
}

export function describeOperation(op: OperationSpec): string {
  switch (op.kind) {
    case 'rename_column':
      return `Rename “${op.params.column}” to “${op.params.to.trim()}”`;
    case 'remove_column':
      return `Remove column “${op.params.column}”`;
    case 'trim_whitespace':
      return op.params.columns.length === 1
        ? `Trim${op.params.collapseInner ? ' & collapse' : ''} whitespace in “${op.params.columns[0]}”`
        : `Trim${op.params.collapseInner ? ' & collapse' : ''} whitespace in ${op.params.columns.length} columns`;
    case 'change_case':
      return `Make “${op.params.column}” ${op.params.mode === 'lower' ? 'lowercase' : op.params.mode === 'upper' ? 'UPPERCASE' : 'Title Case'}`;
    case 'remove_duplicates':
      return op.params.columns.length === 0
        ? 'Remove duplicate rows'
        : `Remove duplicates by ${op.params.columns.map((c) => `“${c}”`).join(', ')}`;
    case 'replace_values': {
      const { column, find, replace, match } = op.params;
      const to = replace === '' ? 'nothing' : `“${replace}”`;
      return match === 'exact'
        ? `In “${column}”, replace “${find}” with ${to}`
        : `In “${column}”, replace text “${find}” with ${to}`;
    }
    case 'fill_missing': {
      const { column, mode, value } = op.params;
      return mode === 'value'
        ? `Fill empty “${column}” with “${value ?? ''}”`
        : `Fill empty “${column}” from the row ${mode === 'down' ? 'above' : 'below'}`;
    }
    case 'standardize_dates':
      return `Standardise dates in “${op.params.column}” (${op.params.order === 'DMY' ? 'day/month/year' : op.params.order === 'MDY' ? 'month/day/year' : 'year/month/day'})`;
    case 'normalize_numbers':
      return `Normalise numbers in “${op.params.column}” (decimal ${op.params.decimal === ',' ? 'comma' : 'point'})`;
    case 'change_type':
      return `Convert “${op.params.column}” to ${TYPE_LABEL[op.params.to].toLowerCase()}`;
    case 'merge_values': {
      const { column, merges } = op.params;
      const values = merges.reduce((n, m) => n + m.from.filter((f) => f !== m.to).length, 0);
      return merges.length === 1
        ? `In “${column}”, merge ${values} spelling${values === 1 ? '' : 's'} into “${merges[0]!.to}”`
        : `In “${column}”, merge ${values} spellings into ${merges.length} values`;
    }
  }
}

let counter = 0;
export function createOperation(spec: OperationSpec, now: Date = new Date()): Operation {
  counter = (counter + 1) % 1e6;
  const id = `op_${now.getTime().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return { ...spec, id, createdAt: now.toISOString() } as Operation;
}
