/**
 * Phase 7 — streaming CSV import into DuckDB.
 *
 * The normal import path (`runImport`) decodes the whole file, parses it into a
 * full in-memory `RawTable`, and hands an Arrow IPC stream to
 * `DatasetSession.create`. For large files the parse + Arrow handoff is the
 * memory peak. This module gives CSV a streaming alternative: parse, then
 * insert into the DuckDB source table in batches (no full Arrow handoff).
 * Source columns stay `VARCHAR` (raw text, never modified) — typing is the
 * session's `buildTypedBase` step.
 */
import { ident, literal } from '../duckdb/sql';
import { detectEncoding, parseImport } from './pipeline';
import { ROW_ID } from '../history/operations';
import type { ColumnInference, ImportOptions, RawTable } from './types';
import type { Db } from '../duckdb/types';

/** Rows inserted per batch. */
export const STREAM_BATCH = 10_000;

export interface StreamImportResult {
  fileName: string;
  columns: ColumnInference[];
  rowCount: number;
  warnings: string[];
  /** DuckDB table the raw rows were inserted into. */
  sourceTable: string;
  parseMs: number;
  peakHeapMb: number;
}

function heapMb(): number {
  const g = globalThis as { process?: { memoryUsage?: () => { heapUsed: number } } };
  if (!g.process?.memoryUsage) return 0; // non-Node hosts: reported as 0
  return g.process.memoryUsage().heapUsed / 1e6;
}

/**
 * Batched `INSERT` of rows into a DuckDB table — the shared insert used by
 * `streamCsvToDuckdb` and `DatasetSession.createStreamed`. `columns` are raw
 * column names; `__row` is 1-based row id in stable order.
 */
export async function insertRowsBatched(db: Db, table: string, columns: string[], rows: RawTable['rows'], batchSize = STREAM_BATCH): Promise<void> {
  if (rows.length === 0) return;
  const cols = [ident(ROW_ID), ...columns.map(ident)].join(', ');
  for (let from = 0; from < rows.length; from += batchSize) {
    const batch = rows.slice(from, from + batchSize);
    const placeholders = batch
      .map((r, i) => `(${[String(from + i + 1), ...r.map((v) => (v === null ? 'NULL' : literal(v)))]})`)
      .join(', ');
    await db.exec(`INSERT INTO ${ident(table)} (${cols}) VALUES ${placeholders}`);
  }
}

/**
 * Stream-imports a CSV/TSV into DuckDB: decode → parse → infer → create
 * `dsN_source` and insert in batches. Returns inference + metrics; never
 * invents data (raw text stays in the source table).
 */
export async function streamCsvToDuckdb(
  db: Db,
  fileName: string,
  bytes: Uint8Array,
  options: ImportOptions,
  batchSize = STREAM_BATCH,
): Promise<StreamImportResult> {
  const t0 = performance.now();
  const enc = options.kind === 'tsv' ? 'utf-8' : (options.encoding || detectEncoding(bytes).encoding);
  const { table, columns, warnings } = parseImport(bytes, { ...options, encoding: enc });
  const sourceTable = `ds_stream_${Math.abs(hashCode(fileName)).toString(36)}_${Date.now().toString(36)}`;

  // Source table: raw text.
  const colDefs = [`${ident(ROW_ID)} BIGINT`].concat(table.columns.map((c) => `${ident(c)} VARCHAR`));
  await db.exec(`CREATE TABLE ${ident(sourceTable)} (${colDefs.join(', ')})`);

  const heapStart = heapMb();
  await insertRowsBatched(db, sourceTable, table.columns, table.rows, batchSize);

  return {
    fileName,
    columns,
    rowCount: table.rows.length,
    warnings,
    sourceTable,
    parseMs: performance.now() - t0,
    peakHeapMb: Math.max(heapMb(), heapStart),
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h || 1;
}
