/** Real DuckDB-WASM (Node blocking build) behind the app's Db interface. */
import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { arrowToRows } from '../../src/engine/duckdb/arrowRows';
import { OFFLINE_SETTINGS, type Db, type Row } from '../../src/engine/duckdb/types';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const duckdb = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm'));

export async function createNodeDb(): Promise<Db> {
  const bundles = {
    mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
    eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  db.open({ query: { castBigIntToDouble: true } });
  const conn = db.connect();
  for (const s of OFFLINE_SETTINGS) conn.query(s);
  return {
    async query<T extends Row>(sql: string) {
      return arrowToRows<T>(conn.query(sql));
    },
    async exec(sql: string) {
      conn.query(sql);
    },
    async insertArrowIpc(table: string, ipc: Uint8Array) {
      conn.insertArrowFromIPCStream(ipc, { name: table, create: true });
    },
    async takeFile(name: string) {
      const buf = db.copyFileToBuffer(name);
      db.dropFile(name);
      // the Node runtime writes COPY TO output to the real filesystem
      if (existsSync(name)) unlinkSync(name);
      return buf;
    },
  };
}
