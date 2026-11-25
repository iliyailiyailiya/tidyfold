import { describe, expect, test, beforeAll } from 'vitest';
import { analyze, runImport } from '../src/engine/import/pipeline';
import { streamCsvToDuckdb } from '../src/engine/import/stream';
import { PERF_BUDGETS } from '../src/engine/import/perfBudget';
import { createNodeDb } from './helpers/nodeDb';
import type { Db } from '../src/engine/duckdb/types';

let db: Db;
beforeAll(async () => {
  db = await createNodeDb();
});

function csv(n: number): string {
  const cities = ['Paris', 'Chisinau', 'Oslo', 'Lima'];
  const lines = ['id,name,city,amount'];
  for (let i = 1; i <= n; i++) {
    lines.push(`${i},user${i % 97},${cities[i % 4]},${(i % 997) / 10}`);
  }
  return lines.join('\n');
}

describe('Phase 7: streamCsvToDuckdb', () => {
  test('parity baseline: the normal Arrow import path still returns the same row count', async () => {
    const text = csv(50_000);
    const bytes = new TextEncoder().encode(text);
    const { options } = analyze('big.csv', bytes);
    expect(runImport('big.csv', bytes, options).rowCount).toBe(50_000);
  });

  test('inserts rows into the DuckDB source table and reads them back', async () => {
    const bytes = new TextEncoder().encode('a,b,c\n1,2,3\n4,5,6\n');
    const { options } = analyze('t.csv', bytes);
    const r = await streamCsvToDuckdb(db, 't.csv', bytes, options, 10_000);
    expect(r.rowCount).toBe(2);
    expect(r.columns.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    const rows = await db.query<{ a: string; b: string; c: string; __row: number }>(`SELECT CAST(a AS VARCHAR) AS a, CAST(b AS VARCHAR) AS b, CAST(c AS VARCHAR) AS c, __row FROM ${r.sourceTable} ORDER BY __row`);
    expect(rows).toEqual([
      { a: '1', b: '2', c: '3', __row: 1 },
      { a: '4', b: '5', c: '6', __row: 2 },
    ]);
  });

  test('200k-row stream import meets the Phase 7 perf budget', async () => {
    const lines = ['id,name,city,amount,flag,day,code,note'];
    for (let i = 1; i <= 200_000; i++) {
      lines.push(`${i},user${i % 5000},Paris,${(i % 997) / 10},${i % 2 ? 'true' : 'false'},2024-01-${String((i % 28) + 1).padStart(2, '0')},0${i % 100},"note, ${i}"`);
    }
    const bytes = new TextEncoder().encode(lines.join('\n'));
    const { options } = analyze('big.csv', bytes);
    const t0 = performance.now();
    const r = await streamCsvToDuckdb(db, 'big.csv', bytes, options);
    const t = performance.now() - t0;
    const [cnt] = await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${r.sourceTable}`);
    expect(cnt!.n).toBe(200_000);
    expect(r.rowCount).toBe(200_000);
    expect(t).toBeLessThan(PERF_BUDGETS.import200kMs);
    expect(r.peakHeapMb).toBeLessThan(PERF_BUDGETS.peakHeap200kMb);
    console.log(`[phase7] 200k stream import: ${t.toFixed(0)} ms, peak heap Δ ${r.peakHeapMb.toFixed(0)} MB (budget ${PERF_BUDGETS.import200kMs / 1000}s / ${PERF_BUDGETS.peakHeap200kMb} MB)`);
  }, 60_000);
});
