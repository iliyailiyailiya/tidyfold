/** SQL quoting helpers. All identifiers/literals that reach DuckDB go through these. */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Escapes a value for use inside an ILIKE pattern (\ is the escape char). */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Strips DuckDB's error-class prefix, keeping the first line. */
export function cleanDbError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^(Invalid Input|Conversion|Binder|Parser|Catalog) Error:\s*/i, '').split('\n')[0]!;
}
