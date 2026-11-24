import { ident } from '../duckdb/sql';
import type { Db } from '../duckdb/types';
import { ROW_ID, TRIM_PATTERN, type ColumnSchema, type OperationSpec } from '../history/operations';
import type { ColumnType } from '../import/types';

export interface ColumnProfile {
  name: string;
  type: ColumnType;
  /** null or whitespace-only */
  missing: number;
  distinct: number;
  /** text cells with leading/trailing whitespace */
  untrimmed: number;
  min: string | null;
  max: string | null;
  top: { value: string; count: number }[];
}

export interface QualityComponent {
  key: 'completeness' | 'uniqueness' | 'tidiness';
  label: string;
  weight: number;
  value: number; // 0..1
  detail: string;
}

export interface Suggestion {
  id: string;
  title: string;
  detail: string;
  spec: OperationSpec;
}

export interface DatasetProfile {
  rows: number;
  columns: ColumnProfile[];
  totalCells: number;
  missingCells: number;
  duplicateRows: number;
  untrimmedCells: number;
  quality: { score: number; components: QualityComponent[] };
  suggestions: Suggestion[];
  elapsedMs: number;
}

const TOP_N = 5;

export async function profileTable(db: Db, table: string, schema: ColumnSchema[]): Promise<DatasetProfile> {
  const t0 = performance.now();
  const t = ident(table);
  const aggs: string[] = ['count(*) AS __rows'];
  schema.forEach((c, i) => {
    const col = ident(c.name);
    const missing = c.type === 'text' ? `count_if(${col} IS NULL OR trim(${col}) = '')` : `count_if(${col} IS NULL)`;
    aggs.push(`${missing} AS m${i}`, `count(DISTINCT ${col}) AS d${i}`);
    if (c.type === 'text') aggs.push(`count_if(regexp_matches(${col}, ${TRIM_PATTERN})) AS w${i}`);
    else aggs.push(`CAST(min(${col}) AS VARCHAR) AS lo${i}`, `CAST(max(${col}) AS VARCHAR) AS hi${i}`);
  });
  const [agg] = await db.query(`SELECT ${aggs.join(', ')} FROM ${t}`);
  const rows = Number(agg?.__rows ?? 0);

  const cols = schema.map((c) => ident(c.name)).join(', ');
  const [dup] = schema.length
    ? await db.query<{ n: number }>(`SELECT ${rows} - count(*) AS n FROM (SELECT DISTINCT ${cols} FROM ${t})`)
    : [{ n: 0 }];
  const duplicateRows = Number(dup?.n ?? 0);

  const columns: ColumnProfile[] = [];
  for (let i = 0; i < schema.length; i++) {
    const c = schema[i]!;
    const col = ident(c.name);
    const top = await db.query<{ v: string; n: number }>(
      `SELECT CAST(${col} AS VARCHAR) AS v, count(*) AS n FROM ${t} WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY n DESC, v LIMIT ${TOP_N}`,
    );
    columns.push({
      name: c.name,
      type: c.type,
      missing: Number(agg?.[`m${i}`] ?? 0),
      distinct: Math.min(rows, Number(agg?.[`d${i}`] ?? 0)),
      untrimmed: Number(agg?.[`w${i}`] ?? 0),
      min: (agg?.[`lo${i}`] as string | null) ?? null,
      max: (agg?.[`hi${i}`] as string | null) ?? null,
      top: top.map((r) => ({ value: r.v, count: Number(r.n) })),
    });
  }

  const totalCells = rows * schema.length;
  const missingCells = columns.reduce((s, c) => s + c.missing, 0);
  const untrimmedCells = columns.reduce((s, c) => s + c.untrimmed, 0);
  const textCells = columns.filter((c) => c.type === 'text').reduce((s, c) => s + (rows - c.missing), 0);

  const components = qualityComponents({ rows, totalCells, missingCells, duplicateRows, untrimmedCells, textCells });
  const score = Math.round(100 * components.reduce((s, c) => s + c.weight * c.value, 0));

  return {
    rows,
    columns,
    totalCells,
    missingCells,
    duplicateRows,
    untrimmedCells,
    quality: { score, components },
    suggestions: suggest(columns, duplicateRows),
    elapsedMs: performance.now() - t0,
  };
}

export function qualityComponents(x: {
  rows: number;
  totalCells: number;
  missingCells: number;
  duplicateRows: number;
  untrimmedCells: number;
  textCells: number;
}): QualityComponent[] {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const completeness = x.totalCells ? 1 - x.missingCells / x.totalCells : 1;
  const uniqueness = x.rows ? 1 - x.duplicateRows / x.rows : 1;
  const tidiness = x.textCells ? 1 - x.untrimmedCells / x.textCells : 1;
  return [
    {
      key: 'completeness',
      label: 'Completeness',
      weight: 0.5,
      value: completeness,
      detail: `${pct(completeness)} of cells have a value (${x.missingCells.toLocaleString()} empty of ${x.totalCells.toLocaleString()}).`,
    },
    {
      key: 'uniqueness',
      label: 'Uniqueness',
      weight: 0.3,
      value: uniqueness,
      detail: `${x.duplicateRows.toLocaleString()} of ${x.rows.toLocaleString()} rows are exact repeats of an earlier row.`,
    },
    {
      key: 'tidiness',
      label: 'Tidy text',
      weight: 0.2,
      value: tidiness,
      detail: `${x.untrimmedCells.toLocaleString()} of ${x.textCells.toLocaleString()} text values start or end with stray spaces.`,
    },
  ];
}

function suggest(columns: ColumnProfile[], duplicateRows: number): Suggestion[] {
  const out: Suggestion[] = [];
  const untrimmed = columns.filter((c) => c.untrimmed > 0);
  if (untrimmed.length > 0) {
    const n = untrimmed.reduce((s, c) => s + c.untrimmed, 0);
    out.push({
      id: 'trim',
      title: `Trim stray spaces in ${untrimmed.length} column${untrimmed.length === 1 ? '' : 's'}`,
      detail: `${n.toLocaleString()} value${n === 1 ? '' : 's'} in ${untrimmed.map((c) => `“${c.name}”`).join(', ')} start or end with whitespace.`,
      spec: { kind: 'trim_whitespace', params: { columns: untrimmed.map((c) => c.name) } },
    });
  }
  if (duplicateRows > 0) {
    out.push({
      id: 'dedupe',
      title: `Remove ${duplicateRows.toLocaleString()} duplicate row${duplicateRows === 1 ? '' : 's'}`,
      detail: 'Rows identical in every column to an earlier row. The first occurrence is kept.',
      spec: { kind: 'remove_duplicates', params: { columns: [] } },
    });
  }
  return out;
}

export { ROW_ID };
