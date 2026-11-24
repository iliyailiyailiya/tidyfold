import type { ColumnType, RawCell } from './types';

/**
 * Strict, lossless type inference. A column only gets a non-text type when
 * EVERY non-blank value matches, and the cast in DuckDB reproduces the value.
 * Anything ambiguous stays text; normalising it is a user-visible operation.
 */

// No leading zeros (keeps ZIP codes, IDs like "007" as text). Max 18 digits fits BIGINT.
const INTEGER = /^[-+]?(0|[1-9]\d{0,17})$/;
const DECIMAL = /^[-+]?(0|[1-9]\d*)?(\.\d+)?([eE][-+]?\d+)?$/;
const BOOLEAN = /^(true|false)$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(:(\d{2})(\.\d{1,6})?)?$/;

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= dim;
}

export function matchesType(value: string, type: ColumnType): boolean {
  switch (type) {
    case 'text':
      return true;
    case 'integer':
      return INTEGER.test(value);
    case 'decimal': {
      if (!DECIMAL.test(value)) return false;
      // must contain at least one digit; reject "", "+", ".", "e5"
      if (!/\d/.test(value.replace(/[eE][-+]?\d+$/, ''))) return false;
      // A DOUBLE holds ~15 significant digits; more would silently lose precision.
      const mantissa = value.replace(/^[-+]/, '').replace(/[eE].*$/, '').replace('.', '').replace(/^0+/, '');
      if (mantissa.length > 15) return false;
      return Number.isFinite(Number(value));
    }
    case 'boolean':
      return BOOLEAN.test(value);
    case 'date': {
      const m = DATE.exec(value);
      return !!m && validDate(+m[1]!, +m[2]!, +m[3]!);
    }
    case 'timestamp': {
      const m = TIMESTAMP.exec(value);
      if (!m) return false;
      const h = +m[4]!;
      const min = +m[5]!;
      const s = m[7] ? +m[7] : 0;
      return validDate(+m[1]!, +m[2]!, +m[3]!) && h < 24 && min < 60 && s < 60;
    }
  }
}

export function isBlank(v: RawCell): boolean {
  return v === null || v.trim() === '';
}

const CANDIDATES: ColumnType[] = ['integer', 'decimal', 'boolean', 'date', 'timestamp'];

/**
 * Infers one column. Values are tested as-is (NOT trimmed): " 42" stays text,
 * because casting would silently drop the whitespace.
 */
export function inferColumn(values: Iterable<RawCell>): { type: ColumnType; blank: number } {
  const alive = new Set<ColumnType>(CANDIDATES);
  let blank = 0;
  let seen = 0;
  for (const v of values) {
    if (isBlank(v)) {
      blank++;
      continue;
    }
    seen++;
    // once nothing survives we keep looping only to count blanks
    for (const t of alive) if (!matchesType(v!, t)) alive.delete(t);
  }
  if (seen === 0) return { type: 'text', blank };
  // Most specific surviving type wins.
  for (const t of ['boolean', 'integer', 'decimal', 'date', 'timestamp'] as const) {
    if (alive.has(t)) return { type: t, blank };
  }
  return { type: 'text', blank };
}

export function inferColumns(columnCount: number, rows: RawCell[][]): { type: ColumnType; blank: number }[] {
  const out: { type: ColumnType; blank: number }[] = [];
  for (let c = 0; c < columnCount; c++) {
    out.push(inferColumn(columnValues(rows, c)));
  }
  return out;
}

function* columnValues(rows: RawCell[][], c: number): Generator<RawCell> {
  for (const r of rows) yield r[c] ?? null;
}

export const TYPE_LABEL: Record<ColumnType, string> = {
  text: 'Text',
  integer: 'Whole number',
  decimal: 'Decimal',
  boolean: 'True / false',
  date: 'Date',
  timestamp: 'Date & time',
};

export const DUCKDB_TYPE: Record<ColumnType, string> = {
  text: 'VARCHAR',
  integer: 'BIGINT',
  decimal: 'DOUBLE',
  boolean: 'BOOLEAN',
  date: 'DATE',
  timestamp: 'TIMESTAMP',
};
