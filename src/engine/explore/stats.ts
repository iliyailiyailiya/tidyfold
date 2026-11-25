import { ident } from '../duckdb/sql';
import { exploreColumn, exploreWhere, type ExploreSource } from './source';
import type { ColumnStats } from './types';

const numeric = (v: unknown): number => Number(v ?? 0);
const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * One compact SQL query per column: completeness, distinct values and the
 * statistics that make sense for its type.
 */
export async function columnStats(source: ExploreSource, name: string): Promise<ColumnStats> {
  const t0 = performance.now();
  const column = exploreColumn(source, name);
  const c = ident(name);
  const isText = column.type === 'text';
  const subject = isText ? `trim(${c})` : c;
  const missing = isText ? `(${c} IS NULL OR trim(${c}) = '')` : `${c} IS NULL`;
  const aggs = [
    'count(*) AS __rows',
    `count_if(${missing}) AS __missing`,
    isText
      ? `count(DISTINCT CASE WHEN trim(${c}) = '' THEN NULL ELSE ${c} END) AS __distinct`
      : `count(DISTINCT ${c}) AS __distinct`,
    `CAST(min(${c}) AS VARCHAR) AS __min`,
    `CAST(max(${c}) AS VARCHAR) AS __max`,
  ];
  if (column.type === 'integer' || column.type === 'decimal') {
    aggs.push(
      `avg(${c}) AS __mean`,
      `median(${c}) AS __median`,
      `quantile_cont(${c}, 0.25) AS __p25`,
      `quantile_cont(${c}, 0.75) AS __p75`,
      `stddev_samp(${c}) AS __stddev`,
      `quantile_cont(${c}, 0.75) - quantile_cont(${c}, 0.25) AS __iqr`,
    );
  } else if (isText) {
    aggs.push(
      `min(CASE WHEN ${subject} <> '' THEN length(${subject}) END) AS __minlen`,
      `max(CASE WHEN ${subject} <> '' THEN length(${subject}) END) AS __maxlen`,
      `avg(CASE WHEN ${subject} <> '' THEN length(${subject}) END) AS __avglen`,
    );
  } else if (column.type === 'boolean') {
    aggs.push(`count_if(${c}) AS __true`);
  }

  const [row] = await source.db.query(`SELECT ${aggs.join(', ')} FROM ${ident(source.table)} ${exploreWhere(source)}`);
  const rows = numeric(row?.__rows);
  const missingCount = numeric(row?.__missing);
  const filled = rows - missingCount;
  const type = column.type;

  return {
    column: name,
    type,
    rows,
    filled,
    missing: missingCount,
    distinct: numeric(row?.__distinct),
    min: (row?.__min as string | null | undefined) ?? null,
    max: (row?.__max as string | null | undefined) ?? null,
    numeric:
      (type === 'integer' || type === 'decimal') && filled > 0
        ? {
            mean: numeric(row?.__mean),
            median: numeric(row?.__median),
            p25: numeric(row?.__p25),
            p75: numeric(row?.__p75),
            stddev: maybe(row?.__stddev),
            iqr: numeric(row?.__iqr),
            span: (() => {
              const lo = numeric(row?.__min);
              const hi = numeric(row?.__max);
              return hi - lo;
            })(),
          }
        : null,
    text:
      type === 'text' && filled > 0
        ? {
            minLength: numeric(row?.__minlen),
            maxLength: numeric(row?.__maxlen),
            avgLength: numeric(row?.__avglen),
          }
        : null,
    booleans:
      type === 'boolean' && filled > 0
        ? { trueCount: numeric(row?.__true), falseCount: filled - numeric(row?.__true) }
        : null,
    elapsedMs: performance.now() - t0,
  };
}
