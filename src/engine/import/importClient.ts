import type { WorkerRequest, WorkerResponse } from './import.worker';
import type { ImportAnalysis, ImportOptions, ImportResult } from './types';

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

  async import(file: File, options: ImportOptions): Promise<ImportResult> {
    const r = await this.send({ type: 'import', file, options });
    if (!r.ok) throw new Error(r.error);
    if (r.type !== 'import') throw new Error('Unexpected worker response');
    return r.result;
  }
}

export const importClient = new ImportClient();
