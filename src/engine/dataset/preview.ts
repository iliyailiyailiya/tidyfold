/**
 * Before/after preview of an operation, computed by running it against the
 * current step WITHOUT saving anything. Also runs per-operation diagnostics
 * (values that won't parse, conversions that would fail, …).
 */
import { cleanDbError, ident, literal } from '../duckdb/sql';
import type { Db } from '../duckdb/types';
import { compileCalc, isCalcNode } from '../history/expression';
import {
  compileOperation,
  extractPattern,
  isMissingSql,
  parsedDateSql,
  parsedNumberSql,
  ROW_ID,
  type ColumnSchema,
  type DateOrder,
  type OperationSpec,
} from '../history/operations';
import { DUCKDB_TYPE, TYPE_LABEL } from '../import/infer';
import type { ColumnType } from '../import/types';

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

/** A brand-new column has no "before" values; show a few of its results instead. */
export interface AddedColumnPreview {
  name: string;
  samples: (string | null)[];
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
  addedColumns: AddedColumnPreview[];
  /**
   * Set when “Convert type” changes how a column is stored even though the
   * displayed values look identical (e.g. whole number → text). Counts as a
   * change so the step can be applied.
   */
  converted: { column: string; from: ColumnType; to: ColumnType } | null;
  /** Set for group/aggregate: the whole row set is replaced, so no cell diff. */
  resultRows: { values: (string | null)[] }[] | null;
  reshaped: boolean;
  reordered: boolean;
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
      if (col.type !== to) {
        notes.push({ tone: 'info', text: `The values can look the same, but this column is stored as ${TYPE_LABEL[to].toLowerCase()} from here on.` });
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
    case 'split_column': {
      const { column, by, delimiter, maxParts, positions, keepOriginal } = spec.params;
      const c = ident(column);
      const v = `CAST(${c} AS VARCHAR)`;
      let few: string | null = null;
      let many: string | null = null;
      if (by === 'delimiter' && delimiter) {
        const size = `len(string_split(${v}, ${literal(delimiter)}))`;
        few = `SELECT ${c} AS v FROM ${t} WHERE ${v} <> '' AND ${size} < ${maxParts}`;
        many = `SELECT ${c} AS v FROM ${t} WHERE ${size} > ${maxParts}`;
      } else if (by === 'position' && positions?.length) {
        few = `SELECT ${c} AS v FROM ${t} WHERE length(${v}) < ${positions[positions.length - 1]!}`;
      }
      if (few) {
        const r = await examples(db, few);
        if (r.count > 0) notes.push({ tone: 'warn', text: `${plural(r.count, 'value')} ${r.count === 1 ? 'has' : 'have'} fewer parts; the missing cells will be empty.`, examples: r.examples });
      }
      if (many) {
        const r = await examples(db, many);
        if (r.count > 0) notes.push({ tone: 'info', text: `${plural(r.count, 'value')} ${r.count === 1 ? 'has' : 'have'} more parts than columns. The remainder is kept in the last column.`, examples: r.examples });
      }
      if (!keepOriginal) notes.push({ tone: 'info', text: 'The original column is replaced by the new ones in this step. Undo brings it back.' });
      break;
    }
    case 'merge_columns':
      if (!spec.params.keepOriginals) notes.push({ tone: 'info', text: 'The original columns are replaced by the joined column in this step. Undo brings them back.' });
      break;
    case 'extract_text': {
      const { pattern, group } = extractPattern(spec.params);
      const v = `CAST(${ident(spec.params.column)} AS VARCHAR)`;
      // DuckDB returns '' (not NULL) when a regexp has no match.
      const bad = await examples(db, `SELECT ${ident(spec.params.column)} AS v FROM ${t} WHERE trim(${v}) <> '' AND regexp_extract(${v}, ${literal(pattern)}, ${group}) = ''`);
      if (bad.count > 0) notes.push({ tone: 'warn', text: `${plural(bad.count, 'value')} won't match and will get empty cells.`, examples: bad.examples });
      break;
    }
    case 'calculated_column': {
      if (!isCalcNode(spec.params.expression)) break;
      const calc = compileCalc(spec.params.expression, schema);
      if (calc.divisors.length > 0) {
        const [r] = await db.query<{ n: number }>(`SELECT count_if(${calc.divisors.join(' OR ')}) AS n FROM ${t}`);
        const n = Number(r?.n ?? 0);
        if (n > 0) notes.push({ tone: 'warn', text: `${plural(n, 'row')} ${n === 1 ? 'gets' : 'get'} an empty cell in the new column because of division by zero.` });
      }
      break;
    }
    case 'filter_rows':
      notes.push({ tone: 'info', text: spec.params.keep === 'matching'
        ? 'This is a recorded step: rows that don’t match leave the table from here on. Undo restores them.'
        : 'This is a recorded step: matching rows leave the table from here on. Undo restores them.' });
      break;
    case 'group_aggregate':
      notes.push({ tone: 'info', text: 'This replaces the table with one row per group (with a fresh row number). Undo restores the original rows.' });
      break;
    case 'reorder_columns':
      notes.push({ tone: 'info', text: 'Only the column order changes; no values are touched. Undo brings the old order back.' });
      break;
    default:
      break;
  }
  return { notes, blocked };
}

export async function previewOperation(db: Db, table: string, schema: ColumnSchema[], spec: OperationSpec): Promise<OperationPreview> {
  const t0 = performance.now();
  const compiled = compileOperation(spec, schema, table); // throws OperationError for invalid params
  let notes: PreviewNote[] = [];
  let blocked: string | null = null;
  try {
    ({ notes, blocked } = await diagnose(db, table, schema, spec));
  } catch (e) {
    const msg = cleanDbError(e);
    blocked = msg;
    notes = [...notes, { tone: 'error', text: msg }];
  }

  const [rb] = await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${ident(table)}`);
  const rowsBefore = Number(rb?.n ?? 0);
  const removedColumns = schema.map((c) => c.name).filter((n) => !compiled.sources.includes(n));
  const converted = spec.kind === 'change_type'
    ? (() => {
        const col = schema.find((c) => c.name === spec.params.column);
        return col && col.type !== spec.params.to ? { column: col.name, from: col.type, to: spec.params.to } : null;
      })()
    : null;
  const renamed = compiled.schema.flatMap((c, i) => {
    const from = compiled.sources[i] ?? null;
    return from !== null && from !== c.name ? [{ from, to: c.name }] : [];
  });

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
    addedColumns: [],
    converted,
    resultRows: null,
    reshaped: !!compiled.reshapesRows,
    reordered: !!compiled.reordered,
    notes,
    blocked,
    elapsedMs: 0,
  };
  if (blocked) return { ...empty, elapsedMs: performance.now() - t0 };

  // Quoted, unlikely aliases: a user column can legitimately be called "n" or "o".
  const newCte = `${ident('__tf_new')} AS (${compiled.sql})`;
  const oldCte = `${ident('__tf_old')} AS (SELECT * FROM ${ident(table)})`;
  const N = ident('__tf_new');
  const O = ident('__tf_old');
  const addedColumns: AddedColumnPreview[] = [];

  try {
    // Row-reshaping operations can't be diffed by __row: the ids are fresh.
    if (compiled.reshapesRows) {
      const [cnt] = await db.query<{ n: number }>(`WITH ${newCte} SELECT count(*) AS n FROM ${N}`);
      const rowsAfter = Number(cnt?.n ?? 0);
      const cols = compiled.schema.map((c, i) => `CAST(${ident(c.name)} AS VARCHAR) AS c${i}`).join(', ');
      const rr = await db.query(`WITH ${newCte} SELECT ${cols} FROM ${N} ORDER BY ${ident(ROW_ID)} LIMIT 20`);
      const resultRows = rr.map((r) => ({ values: compiled.schema.map((_, i) => (r[`c${i}`] as string | null) ?? null) }));
      compiled.schema.forEach((c, i) => {
        if (compiled.sources[i] === null) addedColumns.push({ name: c.name, samples: resultRows.map((row) => row.values[i] ?? null) });
      });
      notes.push({ tone: 'info', text: `This replaces ${plural(rowsBefore, 'row')} with ${plural(rowsAfter, 'row')}. Showing the first ${resultRows.length} result rows.` });
      return { ...empty, rowsAfter, resultRows, addedColumns, notes, elapsedMs: performance.now() - t0 };
    }

    const pairs = compiled.schema.flatMap((c, i) => {
      const src = compiled.sources[i] ?? null;
      return src !== null ? [{ out: c.name, src }] : [];
    });
    const diff = (p: { out: string; src: string }) =>
      `CAST(${O}.${ident(p.src)} AS VARCHAR) IS DISTINCT FROM CAST(${N}.${ident(p.out)} AS VARCHAR)`;

    const counts = await db.query(
      `WITH ${oldCte}, ${newCte} SELECT (SELECT count(*) FROM ${N}) AS __after, ${pairs.length ? pairs.map((p, i) => `count_if(${diff(p)}) AS d${i}`).join(', ') : '0 AS d0'} FROM ${O} JOIN ${N} USING (${ident(ROW_ID)})`,
    );
    const row = counts[0] ?? {};
    const rowsAfter = Number(row.__after ?? rowsBefore);
    const columns = pairs.map((p, i) => ({ name: p.out, was: p.src, changed: Number(row[`d${i}`] ?? 0) })).filter((c) => c.changed > 0);
    const changedCells = columns.reduce((s, c) => s + c.changed, 0);

    const samples: CellChange[] = [];
    const per = columns.length ? Math.max(5, Math.ceil(SAMPLE_LIMIT / columns.length)) : 0;
    for (const c of columns) {
      const rows = await db.query<{ r: number; b: string | null; a: string | null }>(
        `WITH ${oldCte}, ${newCte} SELECT ${O}.${ident(ROW_ID)} AS r, CAST(${O}.${ident(c.was)} AS VARCHAR) AS b, CAST(${N}.${ident(c.name)} AS VARCHAR) AS a FROM ${O} JOIN ${N} USING (${ident(ROW_ID)}) WHERE ${diff({ out: c.name, src: c.was })} ORDER BY ${O}.${ident(ROW_ID)} LIMIT ${per}`,
      );
      for (const r of rows) samples.push({ rowId: Number(r.r), column: c.name, before: r.b, after: r.a });
    }

    for (const [i, c] of compiled.schema.entries()) {
      if ((compiled.sources[i] ?? null) !== null) continue;
      const rows = await db.query<{ v: string | null }>(
        `WITH ${newCte} SELECT CAST(${ident(c.name)} AS VARCHAR) AS v FROM ${N} WHERE ${ident(c.name)} IS NOT NULL AND CAST(${ident(c.name)} AS VARCHAR) <> '' LIMIT ${EXAMPLES}`,
      );
      addedColumns.push({ name: c.name, samples: rows.map((r) => r.v) });
    }

    let removedCount = 0;
    let removedRows: OperationPreview['removedRows'] = [];
    if (rowsAfter < rowsBefore) {
      removedCount = rowsBefore - rowsAfter;
      const cols = schema.map((c, i) => `CAST(${O}.${ident(c.name)} AS VARCHAR) AS c${i}`).join(', ');
      const rr = await db.query(
        `WITH ${oldCte}, ${newCte} SELECT ${O}.${ident(ROW_ID)} AS r, ${cols} FROM ${O} ANTI JOIN ${N} USING (${ident(ROW_ID)}) ORDER BY ${O}.${ident(ROW_ID)} LIMIT 25`,
      );
      removedRows = rr.map((r) => ({ rowId: Number(r.r), values: schema.map((_, i) => (r[`c${i}`] as string | null) ?? null) }));
    }

    if (changedCells === 0 && removedCount === 0 && removedColumns.length === 0 && renamed.length === 0 && addedColumns.length === 0 && !compiled.reordered && !converted) {
      notes.push({ tone: 'info', text: 'Nothing would change. The data already looks like this.' });
    }

    return { ...empty, rowsAfter, changedCells, columns, samples, removedCount, removedRows, addedColumns, elapsedMs: performance.now() - t0 };
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

