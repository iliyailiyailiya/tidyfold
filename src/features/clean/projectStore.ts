/**
 * Phase 6 — local project persistence (IndexedDB; static hosting, no network).
 *
 * Stores: current dataset + operation history as a JSON recipe.
 * Restore = re-import the source file and replay the recipe.
 * All local to the browser. No network.
 */
export interface StoredProject {
  id: number;
  name: string;
  /** Original file name (e.g. “sample-orders.csv”). */
  fileName: string;
  /** ISO time of the latest save. */
  savedAt: string;
  /** Operations applied so far (applied + undone), JSON. */
  operationsJson: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tidyfold-projects', 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => req.result.createObjectStore('projects', { keyPath: 'id' });
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbPromise ??= openDb());
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const t = d.transaction('projects', mode);
    const r = fn(t.objectStore('projects'));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

export const projectStore = {
  get(): Promise<StoredProject | null> {
    return tx('readonly', (s) => s.get(1)) as Promise<StoredProject | null>;
  },
  put(p: StoredProject): Promise<void> {
    return tx('readwrite', (s) => s.put(p)).then(() => undefined);
  },
  delete(): Promise<void> {
    return tx('readwrite', (s) => s.delete(1)).then(() => undefined);
  },
};
