import { ident, likeEscape, literal } from '../duckdb/sql';
import type { Db } from '../duckdb/types';
import * as H from '../history/history';
import {
  compileOperation,
  createOperation,
  ROW_ID,
  type ColumnSchema,
  type Operation,
  type OperationSpec,
} from '../history/operations';
import { DUCKDB_TYPE } from '../import/infer';
import type { ColumnInference, ImportResult } from '../import/types';

export type SortSpec = { column: string; desc: boolean } | null;

export type ColumnFilter =
  | { column: string; op: 'contains'; value: string }
  | { column: string; op: 'equals'; value: string }
  | { column: string; op: 'blank' }
  | { column: string; op: 'notBlank' };

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
  private stepTables: (string | null)[] = [];
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
    s.stepTables = [s.stepTable(0)];
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
    const t = this.stepTables[this.cursor];
    if (!t) throw new Error('Step not materialised');
    return t;
  }

  /** Materialises steps from..to (inclusive) sequentially. */
  private async materialise(from: number, to: number): Promise<void> {
    const ops = this.history.ops;
    for (let k = from; k <= to; k++) {
      if (k === 0) continue;
      const op = ops[k - 1]!;
      const input = this.stepTables[k - 1];
      const inSchema = this.stepSchemas[k - 1];
      if (!input || !inSchema) throw new Error(`Step ${k - 1} missing`);
      const compiled = compileOperation(op, inSchema, input);
      const table = this.stepTable(k);
      await this.db.exec(`CREATE OR REPLACE TABLE ${ident(table)} AS ${compiled.sql}`);
      this.stepTables[k] = table;
      this.stepSchemas[k] = compiled.schema;
    }
  }

  private async dropStepsAfter(k: number): Promise<void> {
    for (let i = this.stepTables.length - 1; i > k; i--) {
      if (this.stepTables[i]) await this.db.exec(`DROP TABLE IF EXISTS ${ident(this.stepTables[i]!)}`);
    }
    this.stepTables.length = k + 1;
    this.stepSchemas.length = k + 1;
  }

  /** Validates (compiles) then applies a new operation. Throws OperationError on invalid input. */
  async apply(spec: OperationSpec): Promise<Operation> {
    compileOperation(spec, this.schema, this.currentTable); // validate before mutating anything
    const op = createOperation(spec);
    await this.dropStepsAfter(this.cursor);
    this.history = H.push(this.history, op);
    await this.materialise(this.cursor, this.cursor);
    this.version++;
    return op;
  }

  async undo() {
    this.history = H.undo(this.history);
    this.version++;
  }

  async redo() {
    this.history = H.redo(this.history);
    await this.ensureMaterialised();
    this.version++;
  }

  async jumpTo(step: number) {
    this.history = H.jumpTo(this.history, step);
    await this.ensureMaterialised();
    this.version++;
  }

  private async ensureMaterialised() {
    let first = this.cursor + 1;
    for (let k = 0; k <= this.cursor; k++) {
      if (!this.stepTables[k]) {
        first = k;
        break;
      }
    }
    if (first <= this.cursor) await this.materialise(first, this.cursor);
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
   * the removed step renamed.
   */
  async remove(id: string): Promise<{ blockedBy: { op: Operation; error: string } | null }> {
    const { state, firstDirtyStep } = H.remove(this.history, id);
    if (state === this.history) return { blockedBy: null };
    const later = state.ops.slice(firstDirtyStep);
    const problem = DatasetSession.validateChain(later, this.stepSchemas[firstDirtyStep]!);
    if (problem) return { blockedBy: { op: problem.op, error: problem.error } };
    this.history = state;
    await this.dropStepsAfter(firstDirtyStep);
    await this.ensureMaterialised();
    this.version++;
    return { blockedBy: null };
  }

  /**
   * Replaces the history with a recipe replayed on the original data.
   * The whole recipe is validated first; nothing changes if any step fails.
   */
  async replay(ops: Operation[]): Promise<{ failed: { index: number; op: Operation; error: string } | null }> {
    const problem = DatasetSession.validateChain(ops, this.stepSchemas[0]!);
    if (problem) return { failed: problem };
    await this.dropStepsAfter(0);
    this.history = H.replaceAll(ops);
    await this.ensureMaterialised();
    this.version++;
    return { failed: null };
  }

  // ---------- reading ----------

  private whereClause(q: Pick<PageQuery, 'search' | 'filters'>): string {
    const parts: string[] = [];
    const known = new Set(this.schema.map((c) => c.name));
    const s = q.search?.trim();
    if (s) {
      const pat = literal(`%${likeEscape(s)}%`);
      parts.push(`(${this.schema.map((c) => `CAST(${ident(c.name)} AS VARCHAR) ILIKE ${pat} ESCAPE '\\'`).join(' OR ')})`);
    }
    for (const f of q.filters ?? []) {
      if (!known.has(f.column)) continue;
      const col = `CAST(${ident(f.column)} AS VARCHAR)`;
      switch (f.op) {
        case 'contains':
          parts.push(`${col} ILIKE ${literal(`%${likeEscape(f.value)}%`)} ESCAPE '\\'`);
          break;
        case 'equals':
          parts.push(`${col} = ${literal(f.value)}`);
          break;
        case 'blank':
          parts.push(`(${col} IS NULL OR trim(${col}) = '')`);
          break;
        case 'notBlank':
          parts.push(`(${col} IS NOT NULL AND trim(${col}) <> '')`);
          break;
      }
    }
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

  async dispose(): Promise<void> {
    await this.dropStepsAfter(-1);
    await this.db.exec(`DROP TABLE IF EXISTS ${ident(this.sourceTable)}`);
  }

  /** Exposed for the profiler. */
  get database(): Db {
    return this.db;
  }
}
