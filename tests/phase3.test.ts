import { beforeAll, describe, expect, test } from 'vitest';
import { createNodeDb } from './helpers/nodeDb';
import type { Db } from '../src/engine/duckdb/types';
import { DatasetSession } from '../src/engine/dataset/session';
import { profileTable } from '../src/engine/dataset/profile';
import { analyze, runImport } from '../src/engine/import/pipeline';
import { parseRecipe, recipeToOperations, toRecipe } from '../src/engine/history/recipe';
import { describeOperation } from '../src/engine/history/operations';
import { clusterValues } from '../src/engine/cluster/cluster';
import { DEFAULT_NORMALIZE } from '../src/engine/cluster/normalize';

let db: Db;
beforeAll(async () => {
  db = await createNodeDb();
});

const CSV = 'city,n\nChisinau,1\nChişinău,2\nChisinău,3\n"chisinau ",4\nKishinev,5\nParis,6\nparis,7\nChisinau,8\nRome,9\n,10\n';

async function load(csv = CSV) {
  const bytes = new TextEncoder().encode(csv);
  const { options } = analyze('t.csv', bytes);
  return DatasetSession.create(db, runImport('t.csv', bytes, options));
}
const col = async (s: DatasetSession) => (await s.page({ offset: 0, limit: 100 })).rows.map((r) => r[0]);

describe('merge_values', () => {
  test('end to end: distinct values → clusters → merge (+ a manual group)', async () => {
    const s = await load();
    const { values } = await s.distinctValues('city');
    expect(values[0]).toEqual({ value: 'Chisinau', count: 2 });
    expect(values.some((v) => v.value === '')).toBe(false);

    const { clusters } = clusterValues(values, { normalize: DEFAULT_NORMALIZE, threshold: 1 });
    const chis = clusters.find((c) => c.id === 'chisinau')!;
    // the user adds Kishinev by hand; it's never suggested automatically
    const merges = [
      { from: [...chis.members.map((m) => m.value), 'Kishinev'], to: chis.suggested },
      { from: ['Paris', 'paris'], to: 'Paris' },
    ];
    const pv = await s.preview({ kind: 'merge_values', params: { column: 'city', merges } });
    expect(pv.changedCells).toBe(5);

    await s.apply({ kind: 'merge_values', params: { column: 'city', merges } });
    expect(await col(s)).toEqual(['Chisinau', 'Chisinau', 'Chisinau', 'Chisinau', 'Chisinau', 'Paris', 'Paris', 'Chisinau', 'Rome', '']);
    expect(describeOperation(s.history.ops[0]!)).toBe('In “city”, merge 5 spellings into 2 values');
  });

  test('fuzzy method suggestions round-trip through preview, apply and recipe', async () => {
    const s = await load('city,n\nParis,1\nPariz,2\nPariss,3\nLondon,4\n');
    const { values } = await s.distinctValues('city');
    const { clusters } = clusterValues(values, {
      normalize: DEFAULT_NORMALIZE, threshold: 0.8, method: 'levenshtein', radius: 2,
    });
    const group = clusters.find((c) => c.members.some((m) => m.value === 'Pariz'))!;
    const merges = [{ from: group.members.map((m) => m.value), to: group.suggested }];
    const spec = { kind: 'merge_values' as const, params: { column: 'city', merges } };
    expect((await s.preview(spec)).changedCells).toBeGreaterThan(0);
    await s.apply(spec);
    expect(await col(s)).toEqual([group.suggested, group.suggested, group.suggested, 'London']);
    const fresh = await load('city,n\nParis,1\nPariz,2\nPariss,3\nLondon,4\n');
    expect((await fresh.replay(recipeToOperations(parseRecipe(JSON.stringify(toRecipe(s.history.ops, 'r')))))).failed).toBeNull();
    expect(await col(fresh)).toEqual(await col(s));
  });

  test('exact matching only: untouched values stay byte-identical', async () => {
    const s = await load();
    await s.apply({ kind: 'merge_values', params: { column: 'city', merges: [{ from: ['paris'], to: 'Paris' }] } });
    expect(await col(s)).toContain('chisinau ');
  });

  test('validation', async () => {
    const s = await load();
    const m = (merges: { from: string[]; to: string }[]) => s.apply({ kind: 'merge_values', params: { column: 'city', merges } });
    await expect(m([])).rejects.toThrow(/at least one group/);
    await expect(m([{ from: ['a'], to: ' ' }])).rejects.toThrow(/empty/);
    await expect(m([{ from: ['a'], to: 'x' }, { from: ['a'], to: 'y' }])).rejects.toThrow(/two groups/);
    await expect(s.apply({ kind: 'merge_values', params: { column: 'n', merges: [{ from: ['1'], to: '2' }] } })).rejects.toThrow(/isn't a text column/);
  });

  test('recipe round trip and validation', async () => {
    const s = await load();
    await s.apply({ kind: 'merge_values', params: { column: 'city', merges: [{ from: ['Chişinău', "O'Brien"], to: 'Chisinau' }] } });
    const r = parseRecipe(JSON.stringify(toRecipe(s.history.ops, 'r')));
    const fresh = await load();
    expect((await fresh.replay(recipeToOperations(r))).failed).toBeNull();
    expect(await col(fresh)).toEqual(await col(s));
    expect(() =>
      parseRecipe(JSON.stringify({ format: 'tidyfold-recipe', version: 1, operations: [{ kind: 'merge_values', params: { column: 'c', merges: [{ from: 'x', to: 'y' }] } }] })),
    ).toThrow(/needs "from"/);
  });
});

describe('variant detection in profile', () => {
  test('counts spellings that collapse and suggests a review', async () => {
    const s = await load();
    const p = await profileTable(db, s.currentTable, s.schema);
    const city = p.columns.find((c) => c.name === 'city')!;
    // Chisinau/Chişinău/Chisinău/"chisinau " → 1, Paris/paris → 1
    expect(city.variants).toBe(4);
    const sug = p.suggestions.find((x) => x.id === 'variants:city')!;
    expect(sug.spec).toEqual({ kind: 'merge_values', params: { column: 'city', merges: [] } });
    expect(sug.oneClick).toBe(false);
  });
  test('unique free-text columns are not flagged', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => `note ${i}`);
    rows.push('Note 1');
    const s = await load(`note\n${rows.join('\n')}\n`);
    const p = await profileTable(db, s.currentTable, s.schema);
    expect(p.suggestions.some((x) => x.id.startsWith('variants:'))).toBe(false);
  });
});
