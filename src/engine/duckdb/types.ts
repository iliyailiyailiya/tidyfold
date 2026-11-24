/**
 * Minimal database surface the dataset layer needs. Implemented by the
 * browser AsyncDuckDB adapter and by the Node blocking build in tests.
 */
export type Row = Record<string, unknown>;

export interface Db {
  query<T extends Row = Row>(sql: string): Promise<T[]>;
  exec(sql: string): Promise<void>;
  insertArrowIpc(table: string, ipc: Uint8Array): Promise<void>;
  /** Reads (and removes) a file DuckDB wrote to its in-memory filesystem. */
  takeFile(name: string): Promise<Uint8Array>;
}

/** Settings applied to every connection: never fetch anything from the network. */
export const OFFLINE_SETTINGS = [
  'SET autoinstall_known_extensions = false',
  'SET autoload_known_extensions = false',
];
