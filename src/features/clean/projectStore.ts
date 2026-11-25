/**
 * Phase 6 — local project persistence (IndexedDB; static hosting, no network).
 *
 * Stores the original source bytes, the import options used to read them, and
 * the applied operation history as a JSON recipe. Restore re-imports those
 * bytes and replays the recipe. All local to the browser. No network.
 */
import type { ImportOptions } from '@/engine/import/types';

export interface StoredProject {
  id: number;
  name: string;
  /** Original file name (e.g. “sample-orders.csv”). */
  fileName: string;
  /** ISO time of the latest save. */
  savedAt: string;
  /** Applied operations as a JSON recipe; undone steps are not saved. */
  operationsJson: string;
  /** Original file bytes, so “Continue” can rebuild the source table. */
  sourceBytes: ArrayBuffer;
  /** Exact import settings (header, encoding, delimiter, sheet, types). */
  importOptions: ImportOptions;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('tidyfold-projects', 2);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
    };
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

/** Records written before source bytes were persisted cannot be restored. */
function isRestorable(value: unknown): value is StoredProject {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<StoredProject>;
  return (
    typeof p.id === 'number' &&
    typeof p.name === 'string' &&
    typeof p.fileName === 'string' &&
    typeof p.savedAt === 'string' &&
    typeof p.operationsJson === 'string' &&
    p.sourceBytes instanceof ArrayBuffer &&
    !!p.importOptions &&
    typeof p.importOptions === 'object'
  );
}

export const projectStore = {
  get(): Promise<StoredProject | null> {
    return tx('readonly', (s) => s.get(1)).then((p) => (isRestorable(p) ? p : null));
  },
  put(p: StoredProject): Promise<void> {
    return tx('readwrite', (s) => s.put(p)).then(() => undefined);
  },
  delete(): Promise<void> {
    return tx('readwrite', (s) => s.delete(1)).then(() => undefined);
  },
};
