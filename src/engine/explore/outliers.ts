import { ident, literal } from '../duckdb/sql';
import { filterSql } from '../dataset/filters';
import { ROW_ID } from '../history/operations';
import { exploreColumn, exploreWhere, type ExploreSource } from './source';
import type { OutlierReport } from './types';

const num = (v: unknown): number => Number(v ?? 0);
const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * Tukey's rule of thumb: values below Q1 − 1.5·IQR or above Q3 + 1.5·IQR.
 * A zero IQR means the middle half is constant; we don't flag everything else.
 *
 * For numeric columns: classic numeric fences.
 * For date/timestamp columns: DuckDB `date_histogram` → min/max/total, Tukey fences
 * on the histogram, then rows with values in the extreme (first / last) buckets.
 */
export async function outliers(source: ExploreSource, name: string): Promise<OutlierReport> {
  const column = exploreColumn(source, name);
  if (column.type === 'date' || column.type === 'timestamp') return outliersDate(source, name, column.type);
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

/** Date/timestamp outliers via DuckDB `date_histogram` + Tukey on the histogram. */
async function outliersDate(source: ExploreSource, name: string, _type: 'date' | 'timestamp'): Promise<OutlierReport> {
  const c = ident(name);
  const t = ident(source.table);
  const [summary] = await source.db.query<{ lo: string | null; hi: string | null; n: number }>(
    `SELECT CAST(min(${c}) AS VARCHAR) AS lo, CAST(max(${c}) AS VARCHAR) AS hi, count(${c}) AS n
     FROM ${t} ${exploreWhere(source)}`,
  );
  const n = num(summary?.n);
  if (!summary?.lo || !summary?.hi || n < 4) {
    return { column: name, q1: null, median: null, q3: null, lower: null, upper: null, count: 0, rows: [] };
  }

  const bucketExpr = `strftime(${c}, '%Y-%m-%d')`;
  const histRows = await source.db.query<{ b: string; c: number }>(
    `SELECT ${bucketExpr} AS b, count(*) AS c
     FROM ${t}
     WHERE ${c} IS NOT NULL AND ${exploreWhere(source, '1=1')}
     GROUP BY 1 ORDER BY 1`,
  );
  const rowsList = (Array.isArray(histRows) ? histRows : []).filter((r): r is { b: string; c: number } => !!r && typeof r.b === 'string');
  if (rowsList.length === 0) return { column: name, q1: null, median: null, q3: null, lower: null, upper: null, count: 0, rows: [] };

  const cs = rowsList.map((h) => num(h.c));
  const q1 = cs[Math.floor(cs.length * 0.25)] ?? 0;
  const med = cs[Math.floor(cs.length / 2)] ?? 0;
  const q3 = cs[Math.floor(cs.length * 0.75)] ?? 0;
  const iqr = q3 - q1;
  const lower = iqr > 0 ? q1 - 1.5 * iqr : q1;
  const upper = iqr > 0 ? q3 + 1.5 * iqr : q3;
  const loBucket = rowsList[0]!.b;
  const hiBucket = rowsList[rowsList.length - 1]!.b;

  const rows = await source.db.query<{ r: number; v: string; n: number }>(
    `SELECT ${ident(ROW_ID)} AS r, CAST(${c} AS VARCHAR) AS v, count(*) OVER () AS n
     FROM ${t}
     WHERE ${c} IS NOT NULL AND ${bucketExpr} IN (${literal(loBucket)}, ${literal(hiBucket)})${exploreWhere(source, '1=1') ? '' : ''}
     ORDER BY ${ident(ROW_ID)} LIMIT 20`,
  );

  return {
    column: name,
    q1,
    median: med,
    q3,
    lower,
    upper,
    count: num(rows[0]?.n ?? 0),
    rows: rows.map((r) => ({ rowId: num(r.r), value: r.v ?? '' })),
  };
}
