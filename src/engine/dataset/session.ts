import { cleanDbError, ident, likeEscape, literal } from '../duckdb/sql';
import { previewOperation, type OperationPreview } from './preview';
import { filterSql, type ColumnFilter } from './filters';
import type { Db } from '../duckdb/types';
import * as H from '../history/history';
import {
  compileOperation,
  createOperation,
  OperationError,
  ROW_ID,
  type ColumnSchema,
  type Operation,
  type OperationSpec,
} from '../history/operations';
import { DUCKDB_TYPE } from '../import/infer';
import type { ColumnInference, ImportResult } from '../import/types';

export type SortSpec = { column: string; desc: boolean } | null;

export type { ColumnFilter } from './filters';

export interface PageQuery {
  offset: number;
  limit: number;
  sort?: SortSpec;
  search?: string;
  filters?: ColumnFilter[];
}

export interface Page {
  /** Each row: [__row, ...values as display strings (null = missing)] */
  rows: (string | null)[][];
  rowIds: number[];
  total: number;
}

let sessionSeq = 0;

/** Steps before the current one that keep a table, for instant undo. */
export const KEEP_RECENT = 3;
/** Every Nth step keeps a table so rebuilding never replays from scratch. */
export const CHECKPOINT_EVERY = 8;


/**
 * One imported dataset and its history of steps, materialised in DuckDB.
 *
 *   source      raw text exactly as imported (never modified)
 *   step_0      typed view of source
 *   step_k      result after k operations
 */
export class DatasetSession {
  readonly name: string;
  readonly importedAt = new Date();
  readonly sourceTable: string;
  /** Materialised step tables (not every step keeps one — see `evict`). */
  private tables = new Map<number, string>();
  /** Schema after each step 0..ops.length (cheap; always complete). */
  private stepSchemas: ColumnSchema[][] = [];
  history: H.HistoryState = H.emptyHistory;
  /** Bumped whenever the visible data changes; UI uses it to refetch. */
  version = 0;

  private constructor(
    private db: Db,
    readonly prefix: string,
    readonly fileName: string,
    readonly originalRowCount: number,
    readonly warnings: string[],
  ) {
    this.name = fileName.replace(/\.[^.]+$/, '');
    this.sourceTable = `${prefix}source`;
  }

  static async create(db: Db, result: ImportResult): Promise<DatasetSession> {
    const prefix = `ds${++sessionSeq}_`;
    const s = new DatasetSession(db, prefix, result.fileName, result.rowCount, [...result.warnings]);
    await db.insertArrowIpc(s.sourceTable, result.arrowIpc);
    const schema = await s.buildTypedBase(result.columns);
    s.tables.set(0, s.stepTable(0));
    s.stepSchemas = [schema];
    return s;
  }

  private stepTable(k: number) {
    return `${this.prefix}step_${k}`;
  }

  /**
   * Creates step_0 with lossless casts. If any cast loses a value (should not
   * happen given strict inference) that column falls back to text and a
   * warning is recorded — data is never silently nulled.
   */
  private async buildTypedBase(columns: ColumnInference[]): Promise<ColumnSchema[]> {
    const schema: ColumnSchema[] = columns.map((c) => ({ name: c.name, type: c.type }));
    const typed = schema.filter((c) => c.type !== 'text');
    if (typed.length > 0) {
      const checks = typed
        .map(
          (c) =>
            `count_if(trim(${ident(c.name)}) <> '' AND TRY_CAST(${ident(c.name)} AS ${DUCKDB_TYPE[c.type]}) IS NULL) AS ${ident(c.name)}`,
        )
        .join(', ');
      const [lost] = await this.db.query(`SELECT ${checks} FROM ${ident(this.sourceTable)}`);
      for (const c of typed) {
        if (Number(lost?.[c.name] ?? 0) > 0) {
          this.warnings.push(`Column “${c.name}” kept as text: some values couldn't be read as ${c.type}.`);
          c.type = 'text';
        }
      }
    }
    const select = [
      ident(ROW_ID),
      ...schema.map((c) =>
        c.type === 'text'
          ? ident(c.name)
          : `TRY_CAST(CASE WHEN trim(${ident(c.name)}) = '' THEN NULL ELSE ${ident(c.name)} END AS ${DUCKDB_TYPE[c.type]}) AS ${ident(c.name)}`,
      ),
    ].join(', ');
    await this.db.exec(`CREATE OR REPLACE TABLE ${ident(this.stepTable(0))} AS SELECT ${select} FROM ${ident(this.sourceTable)}`);
    return schema;
  }

  get cursor() {
    return this.history.cursor;
  }

  get schema(): ColumnSchema[] {
    return this.stepSchemas[this.cursor]!;
  }

  get currentTable(): string {
    const t = this.tables.get(this.cursor);
    if (!t) throw new Error('Step not materialised');
    return t;
  }

  /** Number of steps currently holding a full table (for tests / diagnostics). */
  get materialisedSteps(): number[] {
    return [...this.tables.keys()].sort((a, b) => a - b);
  }

  /** Recomputes every step's schema from the history (throws OperationError). */
  private static schemasFor(base: ColumnSchema[], ops: readonly Operation[]): ColumnSchema[][] {
    const out = [base];
    for (const op of ops) out.push(compileOperation(op, out[out.length - 1]!, 'validate').schema);
    return out;
  }

  /** Builds the table for step k from the nearest materialised step below it. */
  private async materialiseTo(k: number): Promise<void> {
    if (this.tables.has(k)) return;
    let j = k;
    while (j > 0 && !this.tables.has(j)) j--;
    for (let i = j + 1; i <= k; i++) {
      const compiled = compileOperation(this.history.ops[i - 1]!, this.stepSchemas[i - 1]!, this.tables.get(i - 1)!);
      const table = this.stepTable(i);
      try {
        await this.db.exec(`CREATE OR REPLACE TABLE ${ident(table)} AS ${compiled.sql}`);
      } catch (e) {
        throw new OperationError(cleanDbError(e));
      }
      this.tables.set(i, table);
    }
  }

  /**
   * Memory cap: keep the original, the current step, the few steps before it
   * (instant undo) and periodic checkpoints. Anything else is rebuilt on demand.
   */
  private async evict(): Promise<void> {
    const c = this.cursor;
    for (const [k, table] of [...this.tables]) {
      const keep = k === 0 || (k <= c && k >= c - KEEP_RECENT) || k % CHECKPOINT_EVERY === 0;
      if (!keep) {
        await this.db.exec(`DROP TABLE IF EXISTS ${ident(table)}`);
        this.tables.delete(k);
      }
    }
  }

  /** Drops tables for steps >= k (their contents no longer match the history). */
  private async invalidateFrom(k: number): Promise<void> {
    for (const [i, table] of [...this.tables]) {
      if (i >= Math.max(1, k)) {
        await this.db.exec(`DROP TABLE IF EXISTS ${ident(table)}`);
        this.tables.delete(i);
      }
    }
  }

  /**
   * Switches to a new history atomically. If building the new current step
   * fails (e.g. a strict conversion hits a bad value) the previous history is
   * restored and the error is rethrown.
   */
  private async transition(next: H.HistoryState, firstDirty: number): Promise<void> {
    const prev = { history: this.history, schemas: this.stepSchemas };
    const schemas = DatasetSession.schemasFor(this.stepSchemas[0]!, next.ops);
    await this.invalidateFrom(firstDirty);
    this.history = next;
    this.stepSchemas = schemas;
    try {
      await this.materialiseTo(this.cursor);
    } catch (e) {
      await this.invalidateFrom(firstDirty);
      this.history = prev.history;
      this.stepSchemas = prev.schemas;
      await this.materialiseTo(this.cursor);
      throw e;
    }
    await this.evict();
    this.version++;
  }

  /** Validates then applies a new operation. Throws OperationError if it can't be applied. */
  async apply(spec: OperationSpec): Promise<Operation> {
    compileOperation(spec, this.schema, this.currentTable); // validate before touching anything
    const op = createOperation(spec);
    await this.transition(H.push(this.history, op), this.cursor + 1);
    return op;
  }

  async undo() {
    await this.transition(H.undo(this.history), Infinity);
  }

  async redo() {
    await this.transition(H.redo(this.history), Infinity);
  }

  async jumpTo(step: number) {
    await this.transition(H.jumpTo(this.history, step), Infinity);
  }

  /**
   * Checks a sequence of operations against a schema without touching data.
   * Returns the first failing operation, if any.
   */
  static validateChain(ops: readonly Operation[], schema: ColumnSchema[]): { index: number; op: Operation; error: string } | null {
    let current = schema;
    for (let i = 0; i < ops.length; i++) {
      try {
        current = compileOperation(ops[i]!, current, 'validate').schema;
      } catch (e) {
        return { index: i, op: ops[i]!, error: e instanceof Error ? e.message : String(e) };
      }
    }
    return null;
  }

  /**
   * Removes an operation and replays everything after it. Refuses (and changes
   * nothing) if a later step depends on the removed one, e.g. it uses a column
   * the removed step renamed, or fails on the data.
   */
  async remove(id: string): Promise<{ blockedBy: { op: Operation; error: string } | null }> {
    const { state, firstDirtyStep } = H.remove(this.history, id);
    if (state === this.history) return { blockedBy: null };
    const later = state.ops.slice(firstDirtyStep);
    const problem = DatasetSession.validateChain(later, this.stepSchemas[firstDirtyStep]!);
    if (problem) return { blockedBy: { op: problem.op, error: problem.error } };
    try {
      await this.transition(state, firstDirtyStep + 1);
    } catch (e) {
      return { blockedBy: { op: this.history.ops.find((o) => o.id === id)!, error: e instanceof Error ? e.message : String(e) } };
    }
    return { blockedBy: null };
  }

  /**
   * Replaces the history with a recipe replayed on the original data.
   * The whole recipe is validated first; nothing changes if any step fails.
   */
  async replay(ops: Operation[]): Promise<{ failed: { index: number; op: Operation; error: string } | null }> {
    const problem = DatasetSession.validateChain(ops, this.stepSchemas[0]!);
    if (problem) return { failed: problem };
    try {
      await this.transition(H.replaceAll(ops), 1);
    } catch (e) {
      return { failed: { index: -1, op: ops[ops.length - 1]!, error: e instanceof Error ? e.message : String(e) } };
    }
    return { failed: null };
  }

  /** Distinct non-blank values of a column with their counts, most frequent first. */
  async distinctValues(column: string, limit = 100_000): Promise<{ values: { value: string; count: number }[]; truncated: boolean }> {
    const c = ident(column);
    const rows = await this.db.query<{ v: string; n: number }>(
      `SELECT CAST(${c} AS VARCHAR) AS v, count(*) AS n FROM ${ident(this.currentTable)} WHERE ${c} IS NOT NULL AND trim(CAST(${c} AS VARCHAR)) <> '' GROUP BY 1 ORDER BY n DESC, v LIMIT ${limit + 1}`,
    );
    return { values: rows.slice(0, limit).map((r) => ({ value: r.v, count: Number(r.n) })), truncated: rows.length > limit };
  }

  /** Before/after preview of `spec` against the current step. Saves nothing. */
  async preview(spec: OperationSpec): Promise<OperationPreview> {
    return previewOperation(this.db, this.currentTable, this.schema, spec);
  }

  // ---------- reading ----------

  private whereClause(q: Pick<PageQuery, 'search' | 'filters'>): string {
    const parts: string[] = [];
    const s = q.search?.trim();
    if (s) {
      const pat = literal(`%${likeEscape(s)}%`);
      parts.push(`(${this.schema.map((c) => `CAST(${ident(c.name)} AS VARCHAR) ILIKE ${pat} ESCAPE '\\'`).join(' OR ')})`);
    }
    const filtered = filterSql(this.schema, q.filters ?? []);
    if (filtered) parts.push(filtered);
    return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  }

  async page(q: PageQuery): Promise<Page> {
    const table = ident(this.currentTable);
    const where = this.whereClause(q);
    const sortCol = q.sort && this.schema.some((c) => c.name === q.sort!.column) ? q.sort : null;
    const order = sortCol
      ? `ORDER BY ${ident(sortCol.column)} ${sortCol.desc ? 'DESC' : 'ASC'} NULLS LAST, ${ident(ROW_ID)}`
      : `ORDER BY ${ident(ROW_ID)}`;
    const cols = this.schema.map((c, i) => `CAST(${ident(c.name)} AS VARCHAR) AS c${i}`).join(', ');
    const limit = Math.max(1, Math.min(5000, Math.floor(q.limit)));
    const offset = Math.max(0, Math.floor(q.offset));
    const [rows, countRows] = [
      await this.db.query(`SELECT ${ident(ROW_ID)} AS r, ${cols} FROM ${table} ${where} ${order} LIMIT ${limit} OFFSET ${offset}`),
      await this.db.query<{ n: number }>(`SELECT count(*) AS n FROM ${table} ${where}`),
    ];
    return {
      rowIds: rows.map((r) => Number(r.r)),
      rows: rows.map((r) => this.schema.map((_, i) => (r[`c${i}`] as string | null) ?? null)),
      total: Number(countRows[0]?.n ?? 0),
    };
  }

  async rowCount(): Promise<number> {
    const [r] = await this.db.query<{ n: number }>(`SELECT count(*) AS n FROM ${ident(this.currentTable)}`);
    return Number(r?.n ?? 0);
  }

  /** CSV of the current step, written by DuckDB itself (no row-by-row JS). */
  async exportCsv(): Promise<Uint8Array> {
    const file = `${this.prefix}export_${Date.now()}.csv`;
    const cols = this.schema.map((c) => ident(c.name)).join(', ');
    await this.db.exec(
      `COPY (SELECT ${cols} FROM ${ident(this.currentTable)} ORDER BY ${ident(ROW_ID)}) TO ${literal(file)} (FORMAT csv, HEADER true)`,
    );
    return this.db.takeFile(file);
  }

  /**
   * All rows of the current step for XLSX/JSON export. Integers and dates come
   * back as text so nothing loses precision on the way to the worker.
   */
  async exportRows(): Promise<{ schema: ColumnSchema[]; rows: (string | number | boolean | null)[][] }> {
    const schema = this.schema;
    const cols = schema
      .map((c, i) => {
        const id = ident(c.name);
        const expr = c.type === 'decimal' || c.type === 'boolean' || c.type === 'text' ? id : `CAST(${id} AS VARCHAR)`;
        return `${expr} AS c${i}`;
      })
      .join(', ');
    const rows = await this.db.query(`SELECT ${cols} FROM ${ident(this.currentTable)} ORDER BY ${ident(ROW_ID)}`);
    return { schema, rows: rows.map((r) => schema.map((_, i) => (r[`c${i}`] as string | number | boolean | null) ?? null)) };
  }

  async dispose(): Promise<void> {
    await this.invalidateFrom(1);
    await this.db.exec(`DROP TABLE IF EXISTS ${ident(this.stepTable(0))}`);
    this.tables.clear();
    await this.db.exec(`DROP TABLE IF EXISTS ${ident(this.sourceTable)}`);
  }

  /** Exposed for the profiler. */
  get database(): Db {
    return this.db;
  }
}
