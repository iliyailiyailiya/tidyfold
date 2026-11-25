import { beforeAll, describe, expect, test, vi } from 'vitest';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { createNodeDb } from './helpers/nodeDb';
import type { Db } from '../src/engine/duckdb/types';
import { DatasetSession } from '../src/engine/dataset/session';
import { analyze, parseImport, runImport } from '../src/engine/import/pipeline';
import type { ImportOptions } from '../src/engine/import/types';
import { buildStoredProject } from '../src/features/clean/projectSnapshot';
import { projectStore, type StoredProject } from '../src/features/clean/projectStore';
import { restoreStoredProject, type ProjectImporter } from '../src/features/clean/restoreProject';

beforeAll(() => {
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

/** Same pipeline the worker uses, injected so the test needs no browser Worker. */
const importer: ProjectImporter = {
  async import(file, options) {
    return runImport(file.name, new Uint8Array(await file.arrayBuffer()), options);
  },
  async importStream(file, options) {
    const { table, columns, warnings } = parseImport(new Uint8Array(await file.arrayBuffer()), options);
    return { fileName: file.name, columns, rowCount: table.rows.length, warnings, rows: table.rows, parseMs: 0 };
  },
};

const CSV = 'city,note\n Paris ,a\nParis,b\nLondon,c\n';

async function rows(s: DatasetSession) {
  return (await s.page({ offset: 0, limit: 100 })).rows;
}

describe('local project restore', () => {
  test('saved bytes + applied recipe replay to the same dataset', async () => {
    const db: Db = await createNodeDb();
    const bytes = new TextEncoder().encode(CSV);
    const { options }: { options: ImportOptions } = analyze('cities.csv', bytes);
    const session = await DatasetSession.create(db, runImport('cities.csv', bytes, options));

    try {
      await session.apply({ kind: 'trim_whitespace', params: { columns: ['city'] } });
      await session.apply({ kind: 'remove_duplicates', params: { columns: ['city'] } });
      await session.undo(); // the undone step must not come back on Continue
      const expectedRows = await rows(session);
      const expectedSchema = session.schema;

      // This is the exact record the opt-in save hook writes to IndexedDB.
      const sourceBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const record = await buildStoredProject(
        session,
        { file: new File([sourceBytes], session.fileName), options },
        new Date('2026-11-25T12:00:00.000Z'),
      );
      await projectStore.put(record);

      const restored = await restoreStoredProject(db, importer);
      try {
        expect(restored.name).toBe(session.name);
        expect(restored.steps).toBe(1);
        expect(restored.source.options).toEqual(options);
        expect(new Uint8Array(await restored.source.file.arrayBuffer())).toEqual(new Uint8Array(sourceBytes));
        expect(restored.session.schema).toEqual(expectedSchema);
        expect(await rows(restored.session)).toEqual(expectedRows);
      } finally {
        await restored.session.dispose();
      }
    } finally {
      await session.dispose();
    }
  });

  test('a legacy record without source bytes is ignored', async () => {
    const legacy = {
      id: 1,
      name: 'old',
      fileName: 'old.csv',
      savedAt: new Date().toISOString(),
      operationsJson: JSON.stringify([]),
    } as unknown as StoredProject;
    await projectStore.put(legacy);
    expect(await projectStore.get()).toBeNull();
  });
});
