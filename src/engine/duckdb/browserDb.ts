import * as duckdb from '@duckdb/duckdb-wasm';
// Self-hosted: Vite copies these into the build. Nothing is fetched from a CDN.
import mvpWasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvpWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import ehWasm from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import ehWorker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import { arrowToRows } from './arrowRows';
import { OFFLINE_SETTINGS, type Db, type Row } from './types';

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

class BrowserDb implements Db {
  constructor(
    private db: duckdb.AsyncDuckDB,
    private conn: duckdb.AsyncDuckDBConnection,
  ) {}

  async query<T extends Row>(sql: string): Promise<T[]> {
    return arrowToRows<T>(await this.conn.query(sql));
  }

  async exec(sql: string): Promise<void> {
    await this.conn.query(sql);
  }

  async insertArrowIpc(table: string, ipc: Uint8Array): Promise<void> {
    await this.conn.insertArrowFromIPCStream(ipc, { name: table, create: true });
  }

  async takeFile(name: string): Promise<Uint8Array> {
    const buf = await this.db.copyFileToBuffer(name);
    await this.db.dropFile(name);
    return buf;
  }
}

/**
 * Production builds ship the engine as `.wasm.gz` (Cloudflare Pages caps files
 * at 25 MiB; the raw modules are ~40 MB). Decompress locally into a blob: URL.
 * Falls back to the plain file (dev server, or hosts that kept it).
 */
async function resolveWasm(url: string): Promise<string> {
  try {
    const res = await fetch(`${url}.gz`);
    if (!res.ok) return url;
    let bytes = new Uint8Array(await res.arrayBuffer());
    // Some hosts decode .gz transparently; sniff instead of trusting headers.
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    if (!(bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d)) return url; // not "\0asm"
    return URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
  } catch {
    return url;
  }
}

let instance: Promise<Db> | null = null;

/** Lazily boots DuckDB-WASM in its own worker (one per tab). */
export function getDb(): Promise<Db> {
  instance ??= (async () => {
    const bundle = await duckdb.selectBundle(BUNDLES);
    const worker = new Worker(bundle.mainWorker!, { name: 'duckdb' });
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(await resolveWasm(bundle.mainModule), bundle.pthreadWorker);
    await db.open({ query: { castBigIntToDouble: true } });
    const conn = await db.connect();
    for (const s of OFFLINE_SETTINGS) await conn.query(s);
    return new BrowserDb(db, conn);
  })();
  instance.catch(() => {
    instance = null;
  });
  return instance;
}
