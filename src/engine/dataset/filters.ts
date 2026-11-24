import { ident, likeEscape, literal } from '../duckdb/sql';
import { DUCKDB_TYPE } from '../import/infer';
import type { ColumnSchema } from '../history/operations';

/**
 * A view-only filter, shared by Table and Explore. These never touch the
 * dataset; they only narrow what is displayed.
 */
export type ColumnFilter =
  | { column: string; op: 'contains'; value: string }
  | { column: string; op: 'equals'; value: string }
  | { column: string; op: 'blank' }
  | { column: string; op: 'notBlank' }
  /** [value, value2) — used by chart bins. */
  | { column: string; op: 'range'; value: string; value2: string }
  /** Outside the inclusive fences — used by the outliers panel. */
  | { column: string; op: 'outside'; value: string; value2: string };

function bound(column: ColumnSchema, value: string): string {
  if (column.type === 'integer' || column.type === 'decimal' || column.type === 'date' || column.type === 'timestamp') {
    return `CAST(${literal(value)} AS ${DUCKDB_TYPE[column.type]})`;
  }
  return literal(value);
}

/**
 * SQL condition for a list of view filters (without the `WHERE` keyword), or
 * null when there is nothing to filter on. Unknown columns are ignored so a
 * stale filter can't break a page after a rename or undo.
 */
export function filterSql(schema: ColumnSchema[], filters: readonly ColumnFilter[]): string | null {
  const known = new Map(schema.map((c) => [c.name, c]));
  const parts: string[] = [];
  for (const f of filters) {
    const column = known.get(f.column);
    if (!column) continue;
    const col = `CAST(${ident(f.column)} AS VARCHAR)`;
    switch (f.op) {
      case 'contains':
        parts.push(`${col} ILIKE ${literal(`%${likeEscape(f.value)}%`)} ESCAPE '\\'`);
        break;
      case 'equals':
        parts.push(`${col} = ${literal(f.value)}`);
        break;
      case 'blank':
        parts.push(`(${col} IS NULL OR trim(${col}) = '')`);
        break;
      case 'notBlank':
        parts.push(`(${col} IS NOT NULL AND trim(${col}) <> '')`);
        break;
      case 'range':
        parts.push(`(${ident(f.column)} >= ${bound(column, f.value)} AND ${ident(f.column)} < ${bound(column, f.value2)})`);
        break;
      case 'outside':
        parts.push(`(${ident(f.column)} < ${bound(column, f.value)} OR ${ident(f.column)} > ${bound(column, f.value2)})`);
        break;
    }
  }
  return parts.length ? parts.join(' AND ') : null;
}

/** The same condition wrapped in a `WHERE` clause, or an empty string. */
export function filterWhereSql(schema: ColumnSchema[], filters: readonly ColumnFilter[]): string {
  const sql = filterSql(schema, filters);
  return sql ? `WHERE ${sql}` : '';
}

/** Short plain-English label for a filter chip. */
export function describeFilter(f: ColumnFilter): string {
  switch (f.op) {
    case 'contains':
      return `contains “${f.value}”`;
    case 'equals':
      return `= “${f.value}”`;
    case 'blank':
      return 'is empty';
    case 'notBlank':
      return 'is not empty';
    case 'range':
      return `from “${f.value}” to “${f.value2}”`;
    case 'outside':
      return `outside “${f.value}”–“${f.value2}”`;
  }
}
