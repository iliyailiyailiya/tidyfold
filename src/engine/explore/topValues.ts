import { ident } from '../duckdb/sql';
import { exploreColumn, exploreWhere, type ExploreSource } from './source';
import type { TopValues } from './types';

const num = (v: unknown): number => Number(v ?? 0);

/**
 * Most common non-missing values, with a single “Other” bucket so the chart
 * never claims to show every distinct value.
 */
export async function topValues(source: ExploreSource, name: string, limit = 8): Promise<TopValues> {
  const column = exploreColumn(source, name);
  const c = ident(name);
  const filled = column.type === 'text' ? `(${c} IS NOT NULL AND trim(${c}) <> '')` : `${c} IS NOT NULL`;
  const where = exploreWhere(source, filled);
  const [totals] = await source.db.query<{ total: number; distinct: number }>(
    `SELECT count(*) AS total, count(DISTINCT CAST(${c} AS VARCHAR)) AS distinct FROM ${ident(source.table)} ${where}`,
  );
  const total = num(totals?.total);
  const distinct = num(totals?.distinct);
  const rows = await source.db.query<{ v: string; n: number }>(
    `SELECT CAST(${c} AS VARCHAR) AS v, count(*) AS n FROM ${ident(source.table)} ${where}
     GROUP BY 1 ORDER BY n DESC, v LIMIT ${Math.max(1, Math.floor(limit))}`,
  );
  const values = rows.map((r) => ({ value: r.v ?? '', count: num(r.n) }));
  const shown = values.reduce((s, v) => s + v.count, 0);
  const otherCount = total - shown;
  const otherValues = distinct - values.length;
  return {
    values,
    other: otherValues > 0 ? { values: otherValues, count: otherCount } : null,
    distinct,
    total,
  };
}

/** Small helper used by the UI to display a value safely. */
export function valueLabel(value: string, max = 28): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return '(empty)';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
