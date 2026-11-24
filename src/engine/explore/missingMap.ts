import { ident } from '../duckdb/sql';
import { ROW_ID } from '../history/operations';
import { exploreWhere, type ExploreSource } from './source';
import type { MissingMap } from './types';

const BANDS = 50;
const num = (v: unknown): number => Number(v ?? 0);

/**
 * A compact heatmap source: split the current rows into ~50 bands and count
 * missing cells per column in each band. Whitespace counts as missing in text.
 */
export async function missingMap(source: ExploreSource): Promise<MissingMap> {
  const { schema } = source;
  if (schema.length === 0) return { columns: [], bands: [], rows: 0 };

  const flags = schema
    .map((c, i) => {
      const col = ident(c.name);
      const missing = c.type === 'text' ? `(${col} IS NULL OR trim(${col}) = '')` : `${col} IS NULL`;
      return `CASE WHEN ${missing} THEN 1 ELSE 0 END AS m${i}`;
    })
    .join(', ');
  const sums = schema.map((_, i) => `sum(m${i}) AS m${i}`).join(', ');

  const rows = await source.db.query(
    `WITH __bands AS (
       SELECT ntile(${BANDS}) OVER (ORDER BY ${ident(ROW_ID)}) AS b, ${ident(ROW_ID)} AS r, ${flags}
       FROM ${ident(source.table)} ${exploreWhere(source)}
     )
     SELECT b, min(r) AS lo, max(r) AS hi, count(*) AS n, ${sums}
     FROM __bands GROUP BY b ORDER BY b`,
  );
  const byBand = new Map(rows.map((r) => [num(r.b), r]));
  const last = rows.reduce((m, r) => Math.max(m, num(r.b)), 0);
  let total = 0;
  const bands = [];
  for (let b = 1; b <= last; b++) {
    const row = byBand.get(b);
    const count = num(row?.n);
    total += count;
    bands.push({
      fromRow: num(row?.lo),
      toRow: num(row?.hi),
      rows: count,
      missing: schema.map((_, i) => num(row?.[`m${i}`])),
    });
  }
  return { columns: schema.map((c) => c.name), bands, rows: total };
}
