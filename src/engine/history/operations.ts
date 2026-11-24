import { ident } from '../duckdb/sql';
import type { ColumnType } from '../import/types';

export interface ColumnSchema {
  name: string;
  type: ColumnType;
}

/** The internal row-id column; present in every step, never shown as data. */
export const ROW_ID = '__row';

export type OperationSpec =
  | { kind: 'rename_column'; params: { column: string; to: string } }
  | { kind: 'remove_column'; params: { column: string } }
  | { kind: 'trim_whitespace'; params: { columns: string[] } }
  | { kind: 'change_case'; params: { column: string; mode: 'lower' | 'upper' } }
  | { kind: 'remove_duplicates'; params: { columns: string[] } };

export type OperationKind = OperationSpec['kind'];

export type Operation = OperationSpec & { id: string; createdAt: string };

const WS = '[\\s\\x{00A0}\\x{2000}-\\x{200B}\\x{3000}\\x{FEFF}]';
export const TRIM_PATTERN = `'^${WS}+|${WS}+$'`;

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationError';
  }
}

export interface CompiledOperation {
  /** A SELECT reading from `input`. */
  sql: string;
  schema: ColumnSchema[];
}

function requireColumn(schema: ColumnSchema[], name: string): ColumnSchema {
  const col = schema.find((c) => c.name === name);
  if (!col) throw new OperationError(`Column "${name}" doesn't exist at this step.`);
  return col;
}

function selectList(schema: ColumnSchema[], override: (c: ColumnSchema) => string | null = () => null): string {
  return [ident(ROW_ID), ...schema.map((c) => override(c) ?? ident(c.name))].join(', ');
}

export function compileOperation(op: OperationSpec, schema: ColumnSchema[], input: string): CompiledOperation {
  const from = ident(input);
  switch (op.kind) {
    case 'rename_column': {
      const { column, to } = op.params;
      requireColumn(schema, column);
      const target = to.trim();
      if (!target) throw new OperationError('The new name is empty.');
      if (target === ROW_ID) throw new OperationError(`"${ROW_ID}" is reserved.`);
      if (target !== column && schema.some((c) => c.name.toLowerCase() === target.toLowerCase() && c.name !== column)) {
        throw new OperationError(`A column named "${target}" already exists.`);
      }
      return {
        sql: `SELECT ${selectList(schema, (c) => (c.name === column ? `${ident(c.name)} AS ${ident(target)}` : null))} FROM ${from}`,
        schema: schema.map((c) => (c.name === column ? { ...c, name: target } : c)),
      };
    }
    case 'remove_column': {
      requireColumn(schema, op.params.column);
      const rest = schema.filter((c) => c.name !== op.params.column);
      if (rest.length === 0) throw new OperationError("Can't remove the last column.");
      return { sql: `SELECT ${selectList(rest)} FROM ${from}`, schema: rest };
    }
    case 'trim_whitespace': {
      const cols = new Set(op.params.columns);
      if (cols.size === 0) throw new OperationError('Choose at least one column.');
      for (const c of cols) {
        if (requireColumn(schema, c).type !== 'text') throw new OperationError(`"${c}" isn't a text column.`);
      }
      // Strips leading/trailing whitespace incl. non-breaking & zero-width spaces.
      // Inner whitespace is left alone (collapsing it is a separate decision).
      return {
        sql: `SELECT ${selectList(schema, (c) =>
          cols.has(c.name) ? `regexp_replace(${ident(c.name)}, ${TRIM_PATTERN}, '', 'g') AS ${ident(c.name)}` : null,
        )} FROM ${from}`,
        schema,
      };
    }
    case 'change_case': {
      const { column, mode } = op.params;
      if (requireColumn(schema, column).type !== 'text') throw new OperationError(`"${column}" isn't a text column.`);
      const fn = mode === 'lower' ? 'lower' : 'upper';
      return {
        sql: `SELECT ${selectList(schema, (c) => (c.name === column ? `${fn}(${ident(c.name)}) AS ${ident(c.name)}` : null))} FROM ${from}`,
        schema,
      };
    }
    case 'remove_duplicates': {
      const keys = op.params.columns.length > 0 ? op.params.columns : schema.map((c) => c.name);
      for (const k of keys) requireColumn(schema, k);
      // Keeps the first occurrence (lowest original row number).
      return {
        sql: `SELECT * FROM ${from} QUALIFY row_number() OVER (PARTITION BY ${keys.map(ident).join(', ')} ORDER BY ${ident(ROW_ID)}) = 1`,
        schema,
      };
    }
  }
}

export function describeOperation(op: OperationSpec): string {
  switch (op.kind) {
    case 'rename_column':
      return `Rename “${op.params.column}” to “${op.params.to.trim()}”`;
    case 'remove_column':
      return `Remove column “${op.params.column}”`;
    case 'trim_whitespace':
      return op.params.columns.length === 1
        ? `Trim whitespace in “${op.params.columns[0]}”`
        : `Trim whitespace in ${op.params.columns.length} columns`;
    case 'change_case':
      return `Make “${op.params.column}” ${op.params.mode === 'lower' ? 'lowercase' : 'UPPERCASE'}`;
    case 'remove_duplicates':
      return op.params.columns.length === 0
        ? 'Remove duplicate rows'
        : `Remove duplicates by ${op.params.columns.map((c) => `“${c}”`).join(', ')}`;
  }
}

let counter = 0;
export function createOperation(spec: OperationSpec, now: Date = new Date()): Operation {
  counter = (counter + 1) % 1e6;
  const id = `op_${now.getTime().toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  return { ...spec, id, createdAt: now.toISOString() } as Operation;
}
