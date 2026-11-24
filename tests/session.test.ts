import { beforeAll, describe, expect, test } from 'vitest';
import Papa from 'papaparse';
import { createNodeDb } from './helpers/nodeDb';
import type { Db } from '../src/engine/duckdb/types';
import { DatasetSession } from '../src/engine/dataset/session';
import { profileTable } from '../src/engine/dataset/profile';
import { runImport, analyze } from '../src/engine/import/pipeline';
import { createOperation } from '../src/engine/history/operations';
import { parseRecipe, recipeToOperations, toRecipe } from '../src/engine/history/recipe';

let db: Db;
beforeAll(async () => {
  db = await createNodeDb();
});

const CSV = [
  'id,city,score,joined,zip',
  '1, Chisinau ,9.5,2024-01-02,02134',
  '2,Paris,7,2024-02-03,75001',
  '2,Paris,7,2024-02-03,75001',
  '3,,  ,2024-03-04,',
  '4,Chişinău,8.25,,10001',
].join('\n');

async function load(csv = CSV, name = 'cities.csv') {
  const bytes = new TextEncoder().encode(csv);
  const { options } = analyze(name, bytes);
  return DatasetSession.create(db, runImport(name, bytes, options));
}

async function all(s: DatasetSession) {
  return (await s.page({ offset: 0, limit: 1000 })).rows;
}

describe('DatasetSession', () => {
  test('imports with lossless types; text values untouched', async () => {
    const s = await load();
    expect(s.schema).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'city', type: 'text' },
      { name: 'score', type: 'decimal' },
      { name: 'joined', type: 'date' },
      { name: 'zip', type: 'text' }, // leading zero → text
    ]);
    const rows = await all(s);
    expect(rows[0]).toEqual(['1', ' Chisinau ', '9.5', '2024-01-02', '02134']);
    expect(rows[3]).toEqual(['3', '', null, '2024-03-04', '']); // whitespace-only number → missing
    expect(await s.rowCount()).toBe(5);
  });

  test('apply, undo, redo — source table is never modified', async () => {
    const s = await load();
    const before = await db.query(`SELECT * FROM ${s.sourceTable} ORDER BY __row`);
    await s.apply({ kind: 'trim_whitespace', params: { columns: ['city'] } });
    await s.apply({ kind: 'remove_duplicates', params: { columns: [] } });
    expect(await s.rowCount()).toBe(4);
    expect((await all(s))[0]![1]).toBe('Chisinau');
    await s.undo();
    expect(await s.rowCount()).toBe(5);
    await s.undo();
    expect((await all(s))[0]![1]).toBe(' Chisinau ');
    await s.redo();
    await s.redo();
    expect(await s.rowCount()).toBe(4);
    expect(await db.query(`SELECT * FROM ${s.sourceTable} ORDER BY __row`)).toEqual(before);
  });

  test('trim handles non-breaking and zero-width spaces but keeps inner spacing', async () => {
    const s = await load('name\n" New  York​"\nx\n', 'nb.csv');
    await s.apply({ kind: 'trim_whitespace', params: { columns: ['name'] } });
    expect((await all(s))[0]).toEqual(['New  York']);
  });

  test('dedupe keeps the first occurrence in original order', async () => {
    const s = await load('k,v\na,1\nb,2\na,1\n', 'd.csv');
    await s.apply({ kind: 'remove_duplicates', params: { columns: [] } });
    const p = await s.page({ offset: 0, limit: 10 });
    expect(p.rowIds).toEqual([1, 2]);
  });

  test('invalid operation is rejected without changing history', async () => {
    const s = await load();
    await expect(s.apply({ kind: 'remove_column', params: { column: 'ghost' } })).rejects.toThrow(/doesn't exist/);
    expect(s.history.ops.length).toBe(0);
  });

  test('new operation after undo replaces the redo branch', async () => {
    const s = await load();
    await s.apply({ kind: 'remove_column', params: { column: 'zip' } });
    await s.undo();
    await s.apply({ kind: 'remove_column', params: { column: 'score' } });
    expect(s.history.ops.length).toBe(1);
    expect(s.schema.map((c) => c.name)).toEqual(['id', 'city', 'joined', 'zip']);
  });

  test('removing an operation replays the rest', async () => {
    const s = await load();
    const a = await s.apply({ kind: 'trim_whitespace', params: { columns: ['city'] } });
    await s.apply({ kind: 'change_case', params: { column: 'city', mode: 'upper' } });
    const r = await s.remove(a.id);
    expect(r.blockedBy).toBeNull();
    expect((await all(s))[0]![1]).toBe(' CHISINAU ');
  });

  test('removing an operation a later step depends on is refused', async () => {
    const s = await load();
    const rename = await s.apply({ kind: 'rename_column', params: { column: 'city', to: 'town' } });
    await s.apply({ kind: 'change_case', params: { column: 'town', mode: 'lower' } });
    const r = await s.remove(rename.id);
    expect(r.blockedBy?.error).toMatch(/"town" doesn't exist/);
    expect(s.history.ops.length).toBe(2); // unchanged
    expect(s.schema.map((c) => c.name)).toContain('town');
  });

  test('jumpTo any step and recipe replay on a fresh import', async () => {
    const s = await load();
    await s.apply({ kind: 'trim_whitespace', params: { columns: ['city'] } });
    await s.apply({ kind: 'rename_column', params: { column: 'city', to: 'City' } });
    await s.apply({ kind: 'remove_duplicates', params: { columns: [] } });
    await s.jumpTo(1);
    expect(s.schema.map((c) => c.name)).toContain('city');
    await s.jumpTo(3);

    const recipe = parseRecipe(JSON.stringify(toRecipe(s.history.ops, 'r')));
    const fresh = await load();
    const res = await fresh.replay(recipeToOperations(recipe));
    expect(res.failed).toBeNull();
    expect(await all(fresh)).toEqual(await all(s));
  });

  test('recipe that does not fit the data is refused up front', async () => {
    const s = await load();
    const res = await s.replay([createOperation({ kind: 'remove_column', params: { column: 'nope' } })]);
    expect(res.failed?.index).toBe(0);
    expect(s.history.ops.length).toBe(0);
  });

  test('search, filters, sort', async () => {
    const s = await load();
    expect((await s.page({ offset: 0, limit: 10, search: 'paris' })).total).toBe(2);
    expect((await s.page({ offset: 0, limit: 10, filters: [{ column: 'city', op: 'blank' }] })).rowIds).toEqual([4]);
    expect((await s.page({ offset: 0, limit: 10, search: '100%' })).total).toBe(0); // % is literal
    const sorted = await s.page({ offset: 0, limit: 10, sort: { column: 'score', desc: true } });
    expect(sorted.rows.map((r) => r[2])).toEqual(['9.5', '8.25', '7.0', '7.0', null]);
  });

  test('profile counts issues and builds suggestions', async () => {
    const s = await load();
    const p = await profileTable(db, s.currentTable, s.schema);
    expect(p.rows).toBe(5);
    expect(p.duplicateRows).toBe(1);
    expect(p.untrimmedCells).toBe(1);
    const city = p.columns.find((c) => c.name === 'city')!;
    expect(city.missing).toBe(1);
    expect(p.columns.find((c) => c.name === 'score')!.max).toBe('9.5');
    expect(p.suggestions.map((x) => x.id)).toEqual(['trim', 'dedupe']);
    expect(p.quality.score).toBeGreaterThan(0);
    expect(p.quality.score).toBeLessThan(100);
  });

  test('CSV export round-trips the current step', async () => {
    const s = await load();
    await s.apply({ kind: 'remove_duplicates', params: { columns: [] } });
    const text = new TextDecoder().decode(await s.exportCsv());
    const parsed = Papa.parse<string[]>(text.trim()).data;
    expect(parsed[0]).toEqual(['id', 'city', 'score', 'joined', 'zip']);
    expect(parsed.length).toBe(5);
    expect(parsed[1]).toEqual(['1', ' Chisinau ', '9.5', '2024-01-02', '02134']);
  });

  test('awkward column names (quotes, spaces, SQL keywords)', async () => {
    const s = await load('"select","a ""b""",from\n1,2,3\n', 'k.csv');
    expect(s.schema.map((c) => c.name)).toEqual(['select', 'a "b"', 'from']);
    await s.apply({ kind: 'rename_column', params: { column: 'a "b"', to: "it's" } });
    expect((await all(s))[0]).toEqual(['1', '2', '3']);
  });

  test('dispose drops all tables', async () => {
    const s = await load();
    await s.apply({ kind: 'remove_column', params: { column: 'zip' } });
    await s.dispose();
    const left = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_name LIKE '${s.prefix}%'`);
    expect(left).toEqual([]);
  });
});

describe('large dataset', () => {
  test('200k rows × 8 columns: import, profile, operation, page', async () => {
    const header = 'id,name,city,amount,flag,day,code,note';
    const cities = ['Paris', 'Chisinau', ' Rome', 'Oslo ', 'Lima'];
    const lines = [header];
    for (let i = 1; i <= 200_000; i++) {
      lines.push(`${i},user${i % 5000},${cities[i % 5]},${(i % 997) / 10},${i % 2 ? 'true' : 'false'},2024-01-${String((i % 28) + 1).padStart(2, '0')},0${i % 100},"note, ${i}"`);
    }
    const bytes = new TextEncoder().encode(lines.join('\n'));
    const heap0 = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    const { options } = analyze('big.csv', bytes);
    const result = runImport('big.csv', bytes, options);
    const tParse = performance.now() - t0;
    const s = await DatasetSession.create(db, result);
    const tLoad = performance.now() - t0;
    const p = await profileTable(db, s.currentTable, s.schema);
    const tProfile = performance.now() - t0;
    await s.apply({ kind: 'trim_whitespace', params: { columns: ['city'] } });
    const page = await s.page({ offset: 150_000, limit: 100, search: 'user42' });
    const tEnd = performance.now() - t0;
    const heapMb = (process.memoryUsage().heapUsed - heap0) / 1e6;

    expect(result.rowCount).toBe(200_000);
    expect(s.schema.map((c) => c.type)).toEqual(['integer', 'text', 'text', 'decimal', 'boolean', 'date', 'text', 'text']);
    expect(p.untrimmedCells).toBe(80_000);
    expect(page.total).toBeGreaterThan(0);
    console.log(
      `[perf] 200k rows (${(bytes.byteLength / 1e6).toFixed(1)} MB): parse+infer+arrow ${tParse.toFixed(0)} ms, ` +
        `→duckdb ${(tLoad - tParse).toFixed(0)} ms, profile ${(tProfile - tLoad).toFixed(0)} ms, ` +
        `op+page ${(tEnd - tProfile).toFixed(0)} ms, JS heap Δ ${heapMb.toFixed(0)} MB, arrow ${(result.arrowIpc.byteLength / 1e6).toFixed(1)} MB`,
    );
    await s.dispose();
  }, 120_000);
});
