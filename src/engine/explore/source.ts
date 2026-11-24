import { filterSql, type ColumnFilter } from '../dataset/filters';
import type { ColumnSchema } from '../history/operations';
import type { DatasetSession } from '../dataset/session';
import type { Db } from '../duckdb/types';

/** Everything an Explore query needs: the current step plus view filters. */
export interface ExploreSource {
  db: Db;
  table: string;
  schema: ColumnSchema[];
  filters: readonly ColumnFilter[];
}

export function exploreSource(session: DatasetSession, filters: readonly ColumnFilter[] = []): ExploreSource {
  return { db: session.database, table: session.currentTable, schema: session.schema, filters };
}

export function exploreColumn(source: ExploreSource, name: string): ColumnSchema {
  const column = source.schema.find((c) => c.name === name);
  if (!column) throw new Error(`Column “${name}” doesn't exist at this step.`);
  return column;
}

/** Combines an optional extra condition with the active view filters. */
export function exploreWhere(source: ExploreSource, extra?: string): string {
  const parts: string[] = [];
  if (extra) parts.push(extra);
  const filters = filterSql(source.schema, source.filters);
  if (filters) parts.push(filters);
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}
