/**
 * Before/after preview of an operation, computed by running it against the
 * current step WITHOUT saving anything. Also runs per-operation diagnostics
 * (values that won't parse, conversions that would fail, …).
 */
import { cleanDbError, ident } from '../duckdb/sql';
import type { Db } from '../duckdb/types';
import {
  compileOperation,
  isMissingSql,
  parsedDateSql,
  parsedNumberSql,
  ROW_ID,
  type ColumnSchema,
  type DateOrder,
  type OperationSpec,
} from '../history/operations';
import { DUCKDB_TYPE, TYPE_LABEL } from '../import/infer';

export interface CellChange {
  rowId: number;
  column: string;
  before: string | null;
  after: string | null;
}

export interface PreviewNote {
  tone: 'info' | 'warn' | 'error';
  text: string;
  examples?: string[];
}

export interface OperationPreview {
  rowsBefore: number;
  rowsAfter: number;
  changedCells: number;
  columns: { name: string; was: string; changed: number }[];
  samples: CellChange[];
  removedCount: number;
  removedRows: { rowId: number; values: (string | null)[] }[];
  removedColumns: string[];
  renamed: { from: string; to: string }[];
  notes: PreviewNote[];
  /** Why applying would fail; when set, no diff is computed. */
  blocked: string | null;
  elapsedMs: number;
}

const SAMPLE_LIMIT = 60;
const EXAMPLES = 6;

async function examples(db: Db, sql: string): Promise<{ count: number; examples: string[] }> {
  const [c] = await db.query<{ n: number }>(`SELECT count(*) AS n FROM (${sql})`);
  const ex = await db.query<{ v: string }>(`SELECT DISTINCT v FROM (${sql}) LIMIT ${EXAMPLES}`);
  return { count: Number(c?.n ?? 0), examples: ex.map((r) => r.v) };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

async function diagnose(db: Db, table: string, schema: ColumnSchema[], spec: OperationSpec): Promise<{ notes: PreviewNote[]; blocked: string | null }> {
  const t = ident(table);
  const notes: PreviewNote[] = [];
  let blocked: string | null = null;
  switch (spec.kind) {
    case 'standardize_dates': {
      const c = ident(spec.params.column);
      const bad = await examples(db, `SELECT ${c} AS v FROM ${t} WHERE trim(${c}) <> '' AND ${parsedDateSql(c, spec.params.order)} IS NULL`);
      if (bad.count > 0) {
        notes.push({ tone: 'warn', text: `${plural(bad.count, 'value')} can't be read as a date in this order and will be left unchanged.`, examples: bad.examples });
      }
      break;
    }
    case 'normalize_numbers': {
      const c = ident(spec.params.column);
      const bad = await examples(db, `SELECT ${c} AS v FROM ${t} WHERE trim(${c}) <> '' AND ${parsedNumberSql(c, spec.params.decimal)} IS NULL`);
      if (bad.count > 0) {
        notes.push({ tone: 'warn', text: `${plural(bad.count, 'value')} aren't recognisable numbers and will be left unchanged.`, examples: bad.examples });
      }
      notes.push({ tone: 'info', text: 'Values stay text after normalising. Use “Convert type” to turn the column into numbers.' });
      break;
    }
    case 'change_type': {
      const col = schema.find((x) => x.name === spec.params.column);
      if (!col) break;
      const c = ident(col.name);
      const to = spec.params.to;
      let failSql: string | null = null;
      if (to !== 'text' && col.type === 'text') {
        failSql = `SELECT ${c} AS v FROM ${t} WHERE trim(${c}) <> '' AND TRY_CAST(trim(${c}) AS ${DUCKDB_TYPE[to]}) IS NULL`;
      } else if (col.type === 'decimal' && to === 'integer') {
        failSql = `SELECT CAST(${c} AS VARCHAR) AS v FROM ${t} WHERE ${c} <> trunc(${c}) OR abs(${c}) > 9e17`;
      } else if (col.type === 'timestamp' && to === 'date') {
        failSql = `SELECT CAST(${c} AS VARCHAR) AS v FROM ${t} WHERE CAST(${c} AS TIME) <> TIME '00:00:00'`;
      }
      if (failSql) {
        const bad = await examples(db, failSql);
        if (bad.count > 0) {
          blocked = `${plural(bad.count, 'value')} can't be converted to ${TYPE_LABEL[to].toLowerCase()} without losing information. Fix or clear them first.`;
          notes.push({ tone: 'error', text: blocked, examples: bad.examples });
        }
      }
      if (col.type === 'text' && to === 'boolean') {
        notes.push({ tone: 'info', text: 'Accepted as true/false: true/false, yes/no, t/f, 1/0 (any case).' });
      }
      break;
    }
    case 'fill_missing': {
      const col = schema.find((x) => x.name === spec.params.column);
      if (!col) break;
      const [m] = await db.query<{ n: number }>(`SELECT count_if(${isMissingSql(col)}) AS n FROM ${t}`);
      const n = Number(m?.n ?? 0);
      if (n === 0) notes.push({ tone: 'info', text: 'This column has no empty cells.' });
      if (spec.params.mode !== 'value') {
        notes.push({ tone: 'info', text: `Uses the original row order. Empty cells with nothing ${spec.params.mode === 'down' ? 'above' : 'below'} them stay empty.` });
      }
      break;
    }
    case 'remove_column':
      notes.push({ tone: 'info', text: 'The column is removed from this step onward. Undo brings it back.' });
      break;
    default:
      break;
  }
  return { notes, blocked };
}

export async function previewOperation(db: Db, table: string, schema: ColumnSchema[], spec: OperationSpec): Promise<OperationPreview> {
  const t0 = performance.now();
  const compiled = compileOperation(spec, schema, table); // throws OperationError for invalid params
  const { notes, blocked } = await diagnose(db, table, schema, spec);

  const [rb] = await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${ident(table)}`);
  const rowsBefore = Number(rb?.n ?? 0);
  const removedColumns = schema.map((c) => c.name).filter((n) => !compiled.sources.includes(n));
  const renamed = compiled.schema
    .map((c, i) => ({ from: compiled.sources[i]!, to: c.name }))
    .filter((r) => r.from !== r.to);

  const empty: OperationPreview = {
    rowsBefore,
    rowsAfter: rowsBefore,
    changedCells: 0,
    columns: [],
    samples: [],
    removedCount: 0,
    removedRows: [],
    removedColumns,
    renamed,
    notes,
    blocked,
    elapsedMs: 0,
  };
  if (blocked) return { ...empty, elapsedMs: performance.now() - t0 };

  const n = `n AS (${compiled.sql})`;
  const o = `o AS (SELECT * FROM ${ident(table)})`;
  const pairs = compiled.schema.map((c, i) => ({ out: c.name, src: compiled.sources[i]! }));
  const diff = (p: { out: string; src: string }) =>
    `CAST(o.${ident(p.src)} AS VARCHAR) IS DISTINCT FROM CAST(n.${ident(p.out)} AS VARCHAR)`;

  try {
    const counts = await db.query(
      `WITH ${o}, ${n} SELECT (SELECT count(*) FROM n) AS __after, ${pairs.length ? pairs.map((p, i) => `count_if(${diff(p)}) AS d${i}`).join(', ') : '0 AS d0'} FROM o JOIN n USING (${ident(ROW_ID)})`,
    );
    const row = counts[0] ?? {};
    const rowsAfter = Number(row.__after ?? rowsBefore);
    const columns = pairs.map((p, i) => ({ name: p.out, was: p.src, changed: Number(row[`d${i}`] ?? 0) })).filter((c) => c.changed > 0);
    const changedCells = columns.reduce((s, c) => s + c.changed, 0);

    const samples: CellChange[] = [];
    const per = columns.length ? Math.max(5, Math.ceil(SAMPLE_LIMIT / columns.length)) : 0;
    for (const c of columns) {
      const rows = await db.query<{ r: number; b: string | null; a: string | null }>(
        `WITH ${o}, ${n} SELECT o.${ident(ROW_ID)} AS r, CAST(o.${ident(c.was)} AS VARCHAR) AS b, CAST(n.${ident(c.name)} AS VARCHAR) AS a FROM o JOIN n USING (${ident(ROW_ID)}) WHERE ${diff({ out: c.name, src: c.was })} ORDER BY o.${ident(ROW_ID)} LIMIT ${per}`,
      );
      for (const r of rows) samples.push({ rowId: Number(r.r), column: c.name, before: r.b, after: r.a });
    }

    let removedCount = 0;
    let removedRows: OperationPreview['removedRows'] = [];
    if (rowsAfter < rowsBefore) {
      removedCount = rowsBefore - rowsAfter;
      const cols = schema.map((c, i) => `CAST(o.${ident(c.name)} AS VARCHAR) AS c${i}`).join(', ');
      const rr = await db.query(
        `WITH ${o}, ${n} SELECT o.${ident(ROW_ID)} AS r, ${cols} FROM o ANTI JOIN n USING (${ident(ROW_ID)}) ORDER BY o.${ident(ROW_ID)} LIMIT 25`,
      );
      removedRows = rr.map((r) => ({ rowId: Number(r.r), values: schema.map((_, i) => (r[`c${i}`] as string | null) ?? null) }));
    }

    if (changedCells === 0 && removedCount === 0 && removedColumns.length === 0 && renamed.length === 0) {
      notes.push({ tone: 'info', text: 'Nothing would change. The data already looks like this.' });
    }

    return { ...empty, rowsAfter, changedCells, columns, samples, removedCount, removedRows, elapsedMs: performance.now() - t0 };
  } catch (e) {
    const msg = cleanDbError(e);
    return { ...empty, blocked: msg, notes: [...notes, { tone: 'error', text: msg }], elapsedMs: performance.now() - t0 };
  }
}

/** How many non-blank values parse as dates under each order — used to pick a default. */
export async function dateOrderStats(db: Db, table: string, column: string): Promise<Record<DateOrder, number> & { nonBlank: number }> {
  const c = ident(column);
  const [r] = await db.query(
    `SELECT count_if(trim(${c}) <> '') AS nb, ${(['DMY', 'MDY', 'YMD'] as const)
      .map((o) => `count_if(trim(${c}) <> '' AND ${parsedDateSql(c, o)} IS NOT NULL) AS ${o}`)
      .join(', ')} FROM ${ident(table)}`,
  );
  return { nonBlank: Number(r?.nb ?? 0), DMY: Number(r?.DMY ?? 0), MDY: Number(r?.MDY ?? 0), YMD: Number(r?.YMD ?? 0) };
}

/** Guesses the decimal separator from the data (e.g. "1.234,50" → comma). */
export async function decimalStats(db: Db, table: string, column: string): Promise<Record<'.' | ',', number>> {
  const c = ident(column);
  const [r] = await db.query(
    `SELECT count_if(${parsedNumberSql(c, '.')} IS NOT NULL) AS p, count_if(${parsedNumberSql(c, ',')} IS NOT NULL) AS k,
            count_if(regexp_matches(${c}, ',\\d{1,2}$')) AS kc, count_if(regexp_matches(${c}, '\\.\\d{1,2}$')) AS pc FROM ${ident(table)}`,
  );
  // tie-break on "ends with ,dd" vs ".dd"
  const p = Number(r?.p ?? 0) + Number(r?.pc ?? 0);
  const k = Number(r?.k ?? 0) + Number(r?.kc ?? 0);
  return { '.': p, ',': k };
}

