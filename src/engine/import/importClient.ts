import type { WorkerRequest, WorkerResponse } from './import.worker';
import type { ImportAnalysis, ImportOptions, ImportResult, ImportStreamResult } from './types';
import type { ExportCell } from '../export/formats';
import type { ColumnSchema } from '../history/operations';
import type { ClusterOptions, ClusterResult, ValueCount } from '../cluster/cluster';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Pending = { resolve: (r: WorkerResponse) => void };

/** Promise wrapper around the import worker. One worker, reused. */
class ImportClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private get w(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module', name: 'import' });
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const p = this.pending.get(ev.data.id);
        this.pending.delete(ev.data.id);
        p?.resolve(ev.data);
      };
      this.worker.onerror = (ev) => {
        for (const p of this.pending.values()) p.resolve({ id: -1, ok: false, error: ev.message || 'Import worker crashed.' });
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }

  private send(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<WorkerResponse> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.w.postMessage({ ...req, id });
    });
  }

  async analyze(file: File, overrides?: Partial<ImportOptions>): Promise<ImportAnalysis> {
    const r = await this.send({ type: 'analyze', file, ...(overrides ? { overrides } : {}) });
    if (!r.ok) throw new Error(r.error);
    if (r.type !== 'analyze') throw new Error('Unexpected worker response');
    return r.analysis;
  }

  async export(format: 'xlsx' | 'json', schema: ColumnSchema[], rows: ExportCell[][], sheetName: string): Promise<Uint8Array> {
    const r = await this.send({ type: 'export', format, schema, rows, sheetName });
    if (!r.ok) throw new Error(r.error);
    if (r.type !== 'export') throw new Error('Unexpected worker response');
    return r.bytes;
  }

  async cluster(values: ValueCount[], options: ClusterOptions): Promise<ClusterResult> {
    const r = await this.send({ type: 'cluster', values, options });
    if (!r.ok) throw new Error(r.error);
    if (r.type !== 'cluster') throw new Error('Unexpected worker response');
    return r.result;
  }

  async import(file: File, options: ImportOptions): Promise<ImportResult> {
    const r = await this.send({ type: 'import', file, options });
    if (!r.ok) throw new Error(r.error);
    if (r.type !== 'import') throw new Error('Unexpected worker response');
    return r.result;
  }

  /**
   * Streaming import for large CSVs/TSVs: the worker parses and returns rows
   * without Arrow IPC; `DatasetSession.createStreamed` inserts them in batches.
   */
  async importStream(file: File, options: ImportOptions): Promise<ImportStreamResult> {
    const r = await this.send({ type: 'importStream', file, options });
    if (!r.ok) throw new Error(r.error);
    if (r.type !== 'importStream') throw new Error('Unexpected worker response');
    return r.result;
  }
}

export const importClient = new ImportClient();
