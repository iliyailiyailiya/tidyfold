import { ident } from '../duckdb/sql';
import { filterSql } from '../dataset/filters';
import { ROW_ID } from '../history/operations';
import { exploreColumn, exploreWhere, type ExploreSource } from './source';
import type { OutlierReport } from './types';

const num = (v: unknown): number => Number(v ?? 0);
const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Tukey's rule of thumb: values below Q1 − 1.5·IQR or above Q3 + 1.5·IQR.
 * A zero IQR means the middle half is constant; we don't flag everything else.
 */
export async function outliers(source: ExploreSource, name: string): Promise<OutlierReport> {
  const column = exploreColumn(source, name);
  if (column.type !== 'integer' && column.type !== 'decimal') {
    return { column: name, q1: null, median: null, q3: null, lower: null, upper: null, count: 0, rows: [] };
  }
  const c = ident(name);
  const [summary] = await source.db.query<{ n: number; q1: number | null; med: number | null; q3: number | null }>(
    `SELECT count(${c}) AS n, quantile_cont(${c}, 0.25) AS q1, median(${c}) AS med, quantile_cont(${c}, 0.75) AS q3
     FROM ${ident(source.table)} ${exploreWhere(source)}`,
  );
  const n = num(summary?.n);
  const q1 = maybe(summary?.q1);
  const median = maybe(summary?.med);
  const q3 = maybe(summary?.q3);
  if (n < 4 || q1 === null || q3 === null) {
    return { column: name, q1, median, q3, lower: null, upper: null, count: 0, rows: [] };
  }
  const iqr = q3 - q1;
  if (!(iqr > 0)) {
    return { column: name, q1, median, q3, lower: q1, upper: q3, count: 0, rows: [] };
  }
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const filter = filterSql(source.schema, source.filters);
  const rows = await source.db.query<{ r: number; v: string; n: number }>(
    `SELECT ${ident(ROW_ID)} AS r, CAST(${c} AS VARCHAR) AS v, count(*) OVER () AS n
     FROM ${ident(source.table)}
     WHERE ${c} IS NOT NULL AND (${c} < ${lower} OR ${c} > ${upper})${filter ? ` AND (${filter})` : ''}
     ORDER BY ${ident(ROW_ID)} LIMIT 20`,
  );
  return {
    column: name,
    q1,
    median,
    q3,
    lower,
    upper,
    count: rows.length > 0 ? num(rows[0]!.n) : 0,
    rows: rows.map((r) => ({ rowId: num(r.r), value: r.v ?? '' })),
  };
}
