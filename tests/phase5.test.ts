import { beforeAll, describe, expect, test } from 'vitest';
import { createNodeDb } from './helpers/nodeDb';
import type { Db } from '../src/engine/duckdb/types';
import { DatasetSession } from '../src/engine/dataset/session';
import { analyze, runImport } from '../src/engine/import/pipeline';
import {
  columnStats,
  exploreSource,
  histogram,
  missingMap,
  outliers,
  topValues,
  type DateHistogram,
  type NumericHistogram,
} from '../src/engine/explore';
import { describeFilter, type ColumnFilter } from '../src/engine/dataset/filters';

let db: Db;
beforeAll(async () => {
  db = await createNodeDb();
});

async function load(csv: string) {
  const bytes = new TextEncoder().encode(csv);
  const { options } = analyze('t.csv', bytes, { inferTypes: true, hasHeader: true });
  return DatasetSession.create(db, runImport('t.csv', bytes, { ...options, inferTypes: true, hasHeader: true }));
}

const source = (s: DatasetSession, filters: ColumnFilter[] = []) => exploreSource(s, filters);
const numbers = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));

describe('Explore: column statistics', () => {
  test('numeric columns get exact means, quartiles and sample standard deviation', async () => {
    const s = await load(`n\n${numbers(10).join('\n')}\n`);
    const stats = await columnStats(source(s), 'n');
    expect(stats).toMatchObject({ type: 'integer', rows: 10, filled: 10, missing: 0, distinct: 10, min: '1', max: '10' });
    expect(stats.numeric).not.toBeNull();
    expect(stats.numeric!.mean).toBeCloseTo(5.5, 10);
    expect(stats.numeric!.median).toBeCloseTo(5.5, 10);
    expect(stats.numeric!.p25).toBeCloseTo(3.25, 10);
    expect(stats.numeric!.p75).toBeCloseTo(7.75, 10);
    expect(stats.numeric!.stddev).toBeCloseTo(3.0276503540974917, 10);
    expect(stats.text).toBeNull();
    expect(stats.booleans).toBeNull();
  });

  test('text missing includes whitespace-only cells; lengths ignore surrounding spaces', async () => {
    const s = await load('name,note\nA,"  "\nB,\n,"x"\nC,"  hello  "\n');
    const name = await columnStats(source(s), 'name');
    expect(name).toMatchObject({ type: 'text', rows: 4, missing: 1, filled: 3, distinct: 3 });
    expect(name.text).toEqual({ minLength: 1, maxLength: 1, avgLength: 1 });

    const note = await columnStats(source(s), 'note');
    expect(note).toMatchObject({ rows: 4, missing: 2, filled: 2, distinct: 2 });
    expect(note.text).toEqual({ minLength: 1, maxLength: 5, avgLength: 3 });
  });

  test('booleans and dates report the right bounds', async () => {
    const s = await load('b,d\ntrue,2024-03-02\nfalse,2024-01-05\ntrue,2024-12-31\n');
    const b = await columnStats(source(s), 'b');
    expect(b.type).toBe('boolean');
    expect(b.booleans).toEqual({ trueCount: 2, falseCount: 1 });
    const d = await columnStats(source(s), 'd');
    expect(d).toMatchObject({ type: 'date', rows: 3, missing: 0, min: '2024-01-05', max: '2024-12-31' });
    expect(d.numeric).toBeNull();
    expect(d.text).toBeNull();
  });

  test('view filters narrow every statistic', async () => {
    const s = await load('city,n\nBerlin,1\nParis,2\nBerlin,10\n');
    const stats = await columnStats(source(s, [{ column: 'city', op: 'equals', value: 'Berlin' }]), 'n');
    expect(stats).toMatchObject({ rows: 2, filled: 2, distinct: 2, min: '1', max: '10' });
    expect(stats.numeric!.mean).toBe(5.5);
  });
});

describe('Explore: histograms', () => {
  test('numeric bins are nice, complete and contain every value', async () => {
    const s = await load('n\n0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n');
    const h = (await histogram(source(s), 'n')) as NumericHistogram;
    expect(h.kind).toBe('numeric');
    expect(h).toMatchObject({ min: 0, max: 9, width: 1 });
    expect(h.bins).toHaveLength(10);
    expect(h.bins.map((b) => b.count)).toEqual(Array(10).fill(1));
    expect(h.bins[0]).toMatchObject({ from: '0', to: '1', label: '0–1' });
    expect(h.bins.at(-1)).toMatchObject({ from: '9', to: '10' });
    expect(h.bins.reduce((n, b) => n + b.count, 0)).toBe(10);
  });

  test('a single value gets a filterable bin instead of a division by zero', async () => {
    const s = await load('n\n42\n42\n');
    const h = (await histogram(source(s), 'n')) as NumericHistogram;
    expect(h.width).toBe(1);
    expect(h.bins).toEqual([{ from: '42', to: '43', label: '42', count: 2 }]);
  });

  test('date bins fill empty days and become months or years for long ranges', async () => {
    const s = await load('d\n2024-01-01\n2024-01-01\n2024-01-03\n');
    const days = (await histogram(source(s), 'd')) as DateHistogram;
    expect(days.granularity).toBe('day');
    expect(days.bins).toEqual([
      { from: '2024-01-01', to: '2024-01-02', label: '1 Jan 2024', count: 2 },
      { from: '2024-01-02', to: '2024-01-03', label: '2 Jan 2024', count: 0 },
      { from: '2024-01-03', to: '2024-01-04', label: '3 Jan 2024', count: 1 },
    ]);

    const long = await load('d\n2020-01-01\n2021-06-01\n2024-12-31\n');
    const years = (await histogram(source(long), 'd')) as DateHistogram;
    expect(years.granularity).toBe('year');
    expect(years.bins.map((b) => b.label)).toEqual(['2020', '2021', '2022', '2023', '2024']);
    expect(years.bins.map((b) => b.count)).toEqual([1, 1, 0, 0, 1]);
    expect(years.bins[0]).toMatchObject({ from: '2020-01-01', to: '2021-01-01' });
  });

  test('timestamps use timestamp boundaries so a range filter keeps the whole day', async () => {
    const s = await load('ts\n2024-01-01 10:30:00\n2024-01-01 23:59:59\n2024-01-02 08:00:00\n');
    const h = (await histogram(source(s), 'ts')) as DateHistogram;
    expect(h.granularity).toBe('day');
    expect(h.bins[0]).toEqual({ from: '2024-01-01 00:00:00', to: '2024-01-02 00:00:00', label: '1 Jan 2024', count: 2 });
    const filtered = await columnStats(source(s, [{ column: 'ts', op: 'range', value: h.bins[0]!.from, value2: h.bins[0]!.to }]), 'ts');
    expect(filtered.rows).toBe(2);
  });

  test('filtered histograms only use matching rows', async () => {
    const s = await load('city,n\nBerlin,1\nParis,2\nBerlin,10\n');
    const h = (await histogram(source(s, [{ column: 'city', op: 'equals', value: 'Berlin' }]), 'n')) as NumericHistogram;
    expect(h.bins.reduce((n, b) => n + b.count, 0)).toBe(2);
    expect(h.min).toBe(1);
    expect(h.max).toBe(10);
  });
});

describe('Explore: top values and missing map', () => {
  test('top values keep the most frequent and roll the rest into Other', async () => {
    const s = await load('city\nA\nA\nA\nB\nB\nC\nD\n"  "\n');
    const top = await topValues(source(s), 'city', 2);
    expect(top.values).toEqual([
      { value: 'A', count: 3 },
      { value: 'B', count: 2 },
    ]);
    expect(top.other).toEqual({ values: 2, count: 2 });
    expect(top).toMatchObject({ distinct: 4, total: 7 });
  });

  test('top values for booleans are plain counts', async () => {
    const s = await load('b\ntrue\ntrue\nfalse\n');
    const top = await topValues(source(s), 'b');
    expect(top.values).toEqual([
      { value: 'true', count: 2 },
      { value: 'false', count: 1 },
    ]);
    expect(top.other).toBeNull();
  });

  test('the missing map splits rows into 50 bands and counts blanks per column', async () => {
    const lines = ['a,b'];
    for (let i = 1; i <= 100; i++) lines.push(`${i % 2 === 0 ? '' : 'x'},y`);
    const s = await load(`${lines.join('\n')}\n`);
    const map = await missingMap(source(s));
    expect(map.rows).toBe(100);
    expect(map.columns).toEqual(['a', 'b']);
    expect(map.bands).toHaveLength(50);
    expect(map.bands.every((b) => b.rows === 2)).toBe(true);
    expect(map.bands.every((b) => b.missing[0] === 1 && b.missing[1] === 0)).toBe(true);
    expect(map.bands[0]).toMatchObject({ fromRow: 1, toRow: 2 });
    expect(map.bands.at(-1)).toMatchObject({ fromRow: 99, toRow: 100 });

    const filtered = await missingMap(source(s, [{ column: 'a', op: 'notBlank' }]));
    expect(filtered.rows).toBe(50);
    expect(filtered.bands).toHaveLength(50);
    expect(filtered.bands.every((b) => b.missing[0] === 0 && b.missing[1] === 0)).toBe(true);
  });

  test('an empty filtered view returns empty charts without throwing', async () => {
    const s = await load('n,t\n1,a\n2,b\n');
    const none = source(s, [{ column: 'n', op: 'equals', value: '999' }]);
    expect(await columnStats(none, 'n')).toMatchObject({ rows: 0, filled: 0, distinct: 0 });
    expect((await histogram(none, 'n')).bins).toEqual([]);
    expect(await topValues(none, 't')).toMatchObject({ values: [], other: null, distinct: 0, total: 0 });
    expect(await missingMap(none)).toMatchObject({ rows: 0, bands: [] });
    expect(await outliers(none, 'n')).toMatchObject({ count: 0, rows: [] });
  });
});

describe('Explore: outliers', () => {
  test('uses Tukey fences and lists the offending rows and values', async () => {
    const s = await load(`n\n${numbers(10).join('\n')}\n100\n`);
    const report = await outliers(source(s), 'n');
    expect(report).toMatchObject({ q1: 3.5, median: 6, q3: 8.5, lower: -4, upper: 16, count: 1 });
    expect(report.rows).toEqual([{ rowId: 11, value: '100' }]);
  });

  test('leaves ordinary data and constant columns alone', async () => {
    const clean = await load(`n\n${numbers(10).join('\n')}\n`);
    expect(await outliers(source(clean), 'n')).toMatchObject({ count: 0, rows: [] });

    const constant = await load('n\n5\n5\n5\n5\n');
    const report = await outliers(source(constant), 'n');
    expect(report).toMatchObject({ q1: 5, q3: 5, lower: 5, upper: 5, count: 0, rows: [] });
  });

  test('outlier bounds respect view filters and ignore text columns', async () => {
    const s = await load(`city,n\nBerlin,${numbers(10).join('\nBerlin,')}\nParis,1000\n`);
    expect(await outliers(source(s, [{ column: 'city', op: 'equals', value: 'Berlin' }]), 'n')).toMatchObject({ count: 0, rows: [] });
    expect(await outliers(source(s), 'city')).toMatchObject({ count: 0, rows: [] });
  });

  test('flags date outliers on the epoch timeline and formats the fences as dates', async () => {
    const days = Array.from({ length: 10 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`);
    const s = await load(`d\n${days.join('\n')}\n2025-12-31\n`);
    const report = await outliers(source(s), 'd');
    expect(report.count).toBe(1);
    expect(report.rows).toEqual([{ rowId: 11, value: '2025-12-31' }]);
    expect(report.labels).toBeDefined();
    expect(report.labels!.lower).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(report.labels!.upper).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('leaves an even spread of dates alone', async () => {
    const days = Array.from({ length: 10 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`);
    const s = await load(`d\n${days.join('\n')}\n`);
    expect(await outliers(source(s), 'd')).toMatchObject({ count: 0, rows: [] });
  });
});

describe('View filters', () => {
  test('range [from, to) and outside work on native numbers and dates', async () => {
    const s = await load('n,d,city\n1,2024-01-01,Berlin\n2,2024-01-02,Paris\n10,2024-01-10,Berlin\n');
    expect((await s.page({ offset: 0, limit: 10, filters: [{ column: 'n', op: 'range', value: '1', value2: '3' }] })).total).toBe(2);
    expect((await s.page({ offset: 0, limit: 10, filters: [{ column: 'n', op: 'outside', value: '1', value2: '3' }] })).total).toBe(1);
    expect((await s.page({ offset: 0, limit: 10, filters: [{ column: 'd', op: 'range', value: '2024-01-02', value2: '2024-01-11' }] })).total).toBe(2);
    expect((await s.page({ offset: 0, limit: 10, filters: [{ column: 'city', op: 'contains', value: 'ber' }] })).total).toBe(2);
  });

  test('unknown columns and malformed stale filters are ignored', async () => {
    const s = await load('n\n1\n2\n');
    expect((await s.page({ offset: 0, limit: 10, filters: [{ column: 'gone', op: 'equals', value: 'x' }] })).total).toBe(2);
  });

  test('filter chips describe each kind in plain English', () => {
    expect(describeFilter({ column: 'a', op: 'equals', value: 'x' })).toBe('= “x”');
    expect(describeFilter({ column: 'a', op: 'contains', value: 'x' })).toBe('contains “x”');
    expect(describeFilter({ column: 'a', op: 'blank' })).toBe('is empty');
    expect(describeFilter({ column: 'a', op: 'range', value: '1', value2: '5' })).toBe('from “1” to “5”');
    expect(describeFilter({ column: 'a', op: 'outside', value: '1', value2: '5' })).toBe('outside “1”–“5”');
  });
});
