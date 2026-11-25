import { describe, expect, test, beforeAll, vi } from 'vitest';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { planCleanEverything } from '../src/engine/clean/buildClean';
import { projectStore, type StoredProject } from '../src/features/clean/projectStore';
import { describeOperation } from '../src/engine/history/operations';
import type { ColumnProfile, DatasetProfile } from '../src/engine/dataset/profile';

// ---------------------------------------------------------------------------
// Suggestion builder (pure, on DatasetProfile)
// ---------------------------------------------------------------------------

function col(over: Partial<ColumnProfile> & { name: string }): ColumnProfile {
  return {
    type: 'text',
    missing: 0,
    distinct: 0,
    untrimmed: 0,
    dateLike: 0,
    numberLike: 0,
    variants: 0,
    min: null,
    max: null,
    top: [],
    ...over,
  };
}

function profile(over: Partial<DatasetProfile> & { columns: ColumnProfile[] }): DatasetProfile {
  return {
    rows: 10,
    totalCells: 0,
    missingCells: 0,
    duplicateRows: 0,
    untrimmedCells: 0,
    quality: { score: 100, components: [] },
    suggestions: [],
    elapsedMs: 0,
    ...over,
  };
}

describe('Clean: planCleanEverything suggestions', () => {
  test('suggests trim_whitespace when there are untrimmed cells', () => {
    const p = profile({ columns: [col({ name: 'city', untrimmed: 4 })] });
    const plan = planCleanEverything(p);
    expect(plan.items.some((i) => i.spec.kind === 'trim_whitespace')).toBe(true);
    expect(plan.untrimmedCells).toBe(4);
  });

  test('suggests standardize_dates for mostly-date text', () => {
    const p = profile({ columns: [col({ name: 'when', type: 'text', dateLike: 5 })] });
    expect(planCleanEverything(p).items.some((i) => i.spec.kind === 'standardize_dates')).toBe(true);
  });

  test('suggests normalize_numbers for mostly-number text', () => {
    const p = profile({ columns: [col({ name: 'amount', type: 'text', numberLike: 5 })] });
    expect(planCleanEverything(p).items.some((i) => i.spec.kind === 'normalize_numbers')).toBe(true);
  });

  test('suggests remove_duplicates when duplicates exist', () => {
    const p = profile({ columns: [col({ name: 'a' })], duplicateRows: 2 });
    expect(planCleanEverything(p).items.some((i) => i.spec.kind === 'remove_duplicates')).toBe(true);
  });

  test('suggests a merge_values for exact spelling variants', () => {
    const p = profile({
      columns: [col({ name: 'city', top: [{ value: 'Chișinău', count: 8 }, { value: 'chisinau', count: 2 }], variants: 2, distinct: 2 })],
    });
    const merges = planCleanEverything(p).items.filter((i) => i.spec.kind === 'merge_values');
    expect(merges.length).toBeGreaterThan(0);
    const params = merges[0]!.spec.params as { column: string; merges: { from: string[]; to: string }[] };
    expect(params.column).toBe('city');
    expect(params.merges.length).toBeGreaterThan(0);
    expect(params.merges[0]!.from.length).toBeGreaterThan(0);
  });

  test('returns an empty plan for a tidy dataset', () => {
    const p = profile({ columns: [col({ name: 'city' })] });
    expect(planCleanEverything(p).items).toEqual([]);
  });

  test('every suggested spec has a non-empty English description', () => {
    const p = profile({
      rows: 20,
      columns: [
        col({ name: 'city', untrimmed: 3 }),
        col({ name: 'when', type: 'text', dateLike: 5 }),
        col({ name: 'amount', type: 'text', numberLike: 5 }),
        col({ name: 'dupe', top: [{ value: 'a', count: 3 }, { value: 'a ', count: 1 }], variants: 1 }),
      ],
      duplicateRows: 4,
    });
    const plan = planCleanEverything(p);
    expect(plan.items.length).toBeGreaterThan(0);
    for (const item of plan.items) {
      expect(item.preview.length).toBeGreaterThan(0);
      expect(typeof describeOperation(item.spec)).toBe('string');
    }
  });

  test('limitPerKind caps merge_values items', () => {
    const top = [
      { value: 'alpha', count: 5 }, { value: 'alpha ', count: 2 },
      { value: 'beta', count: 4 }, { value: 'beta ', count: 1 },
      { value: 'gamma', count: 3 }, { value: 'gamma ', count: 1 },
    ];
    const p = profile({ columns: [col({ name: 'cities', top, variants: 3, distinct: 6 })] });
    expect(planCleanEverything(p, { limitPerKind: 2 }).items.filter((i) => i.spec.kind === 'merge_values').length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Persistence layer (IndexedDB-backed projectStore)
// ---------------------------------------------------------------------------

beforeAll(() => {
  vi.stubGlobal('indexedDB', fakeIndexedDB);
});

async function put(name: string): Promise<StoredProject> {
  const p: StoredProject = {
    id: 1,
    name,
    fileName: `${name}.csv`,
    savedAt: new Date().toISOString(),
    operationsJson: JSON.stringify([{ kind: 'trim_whitespace', params: { columns: ['a'] } }]),
  };
  await projectStore.put(p);
  return p;
}

describe('Clean: projectStore persistence', () => {
  test('put + get round-trips a StoredProject', async () => {
    await put('round-trip');
    const got = await projectStore.get();
    expect(got).toMatchObject({ name: 'round-trip', fileName: 'round-trip.csv' });
    expect(got!.operationsJson).toContain('trim_whitespace');
  });

  test('put overwrites the previous project', async () => {
    await put('first');
    await put('second');
    expect((await projectStore.get())!.name).toBe('second');
  });

  test('delete removes the stored project', async () => {
    await put('to-delete');
    await projectStore.delete();
    expect(await projectStore.get()).toBeFalsy();
  });
});
