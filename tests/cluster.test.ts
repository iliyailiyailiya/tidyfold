import { describe, expect, test } from 'vitest';
import { boundedLevenshtein, levenshtein, similarity } from '../src/engine/cluster/levenshtein';
import { DEFAULT_NORMALIZE, fingerprint, stripAccents } from '../src/engine/cluster/normalize';
import { clusterValues, type ValueCount } from '../src/engine/cluster/cluster';

const vc = (pairs: [string, number][]): ValueCount[] => pairs.map(([value, count]) => ({ value, count }));

describe('normalize', () => {
  test('accents incl. Romanian ş/ș, ă, and letters NFKD misses', () => {
    expect(stripAccents('Chişinău Chișinău')).toBe('Chisinau Chisinau');
    expect(stripAccents('Straße Ærø Łódź')).toBe('Strasse AEro Lodz');
  });
  test('composed vs decomposed forms match', () => {
    expect(fingerprint('Chişinău')).toBe(fingerprint('Chişinău'));
  });
  test('default fingerprint', () => {
    expect(fingerprint('  CHIȘINĂU ')).toBe('chisinau');
    expect(fingerprint('St. Louis')).toBe(fingerprint('st louis'));
    expect(fingerprint('New  York')).toBe('new york');
  });
  test('options are respected', () => {
    const o = { ...DEFAULT_NORMALIZE, case: false, accents: false };
    expect(fingerprint('Paris', o)).not.toBe(fingerprint('paris', o));
    expect(fingerprint('Chişinău', o)).not.toBe(fingerprint('Chisinau', o));
    expect(fingerprint('Smith, John', { ...DEFAULT_NORMALIZE, wordOrder: true })).toBe(fingerprint('John Smith', { ...DEFAULT_NORMALIZE, wordOrder: true }));
    expect(fingerprint('Smith, John')).not.toBe(fingerprint('John Smith'));
  });
});

describe('levenshtein', () => {
  test.each([
    ['kitten', 'sitting', 3],
    ['', 'abc', 3],
    ['flaw', 'lawn', 2],
    ['chişinău', 'chisinau', 2],
    ['same', 'same', 0],
  ])('%s → %s = %i', (a, b, d) => {
    expect(levenshtein(a, b)).toBe(d);
    expect(levenshtein(b, a)).toBe(d);
  });
  test('bounded version agrees within bound and caps beyond it', () => {
    const words = ['paris', 'pariss', 'parsi', 'london', 'lond', 'p', '', 'abcdefghij', 'abcdxfghij'];
    for (const a of words)
      for (const b of words)
        for (let max = 0; max <= 5; max++) {
          const d = levenshtein(a, b);
          expect(boundedLevenshtein(a, b, max)).toBe(d <= max ? d : max + 1);
        }
  });
  test('similarity', () => {
    expect(similarity('paris', 'paris')).toBe(1);
    expect(similarity('paris', 'pariz')).toBeCloseTo(0.8);
  });
});

describe('clusterValues', () => {
  const cities = vc([
    ['Chisinau', 40],
    ['Chişinău', 25],
    ['Chisinău', 5],
    ['chisinau ', 2],
    ['Kishinev', 3],
    ['Paris', 30],
    ['paris', 4],
    ['Pariss', 1],
    ['Berlin', 20],
    ['Bern', 6],
    ['', 9],
  ]);

  test('exact fingerprints only (threshold 100%)', () => {
    const r = clusterValues(cities, { normalize: DEFAULT_NORMALIZE, threshold: 1 });
    const chis = r.clusters.find((c) => c.id === 'chisinau')!;
    expect(chis.members.map((m) => m.value)).toEqual(['Chisinau', 'Chişinău', 'Chisinău', 'chisinau ']);
    expect(chis.suggested).toBe('Chisinau');
    expect(chis.rows).toBe(72);
    expect(chis.similarity).toBe(1);
    expect(r.clusters.find((c) => c.id === 'paris')!.members.map((m) => m.value)).toEqual(['Paris', 'paris']);
    // Kishinev is a different word: never suggested automatically
    expect(r.clusters.some((c) => c.members.some((m) => m.value === 'Kishinev'))).toBe(false);
    expect(r.clusters.some((c) => c.members.some((m) => m.value === ''))).toBe(false);
  });

  test('suggested target prefers clean spellings, then frequency', async () => {
    const { suggestTarget } = await import('../src/engine/cluster/cluster');
    expect(suggestTarget(vc([['paris', 32], ['Paris', 17]]))).toBe('Paris');
    expect(suggestTarget(vc([[' Chişinău', 50], ['Chisinau', 28], ['Chişinău', 19]]))).toBe('Chisinau');
    expect(suggestTarget(vc([['USA', 9], ['usa', 3]]))).toBe('USA');
  });

  test('fuzzy picks up typos but not different words', () => {
    const r = clusterValues(cities, { normalize: DEFAULT_NORMALIZE, threshold: 0.8 });
    const paris = r.clusters.find((c) => c.id === 'paris')!;
    expect(paris.members.map((m) => m.value)).toEqual(['Paris', 'paris', 'Pariss']);
    expect(paris.similarity).toBeCloseTo(5 / 6);
    expect(r.clusters.some((c) => c.members.some((m) => m.value === 'Bern'))).toBe(false); // berlin vs bern: 0.67
  });

  test('looser threshold widens matches', () => {
    const r = clusterValues(cities, { normalize: DEFAULT_NORMALIZE, threshold: 0.6 });
    expect(r.clusters.find((c) => c.id === 'berlin')!.members.map((m) => m.value)).toEqual(['Berlin', 'Bern']);
  });

  test('no chaining: members are compared to the centre', () => {
    const chain = vc([['aaaaa', 10], ['aaaab', 5], ['aaabb', 4], ['aabbb', 3], ['abbbb', 2], ['bbbbb', 1]]);
    const r = clusterValues(chain, { normalize: DEFAULT_NORMALIZE, threshold: 0.8 });
    for (const c of r.clusters) expect(c.similarity).toBeGreaterThanOrEqual(0.8);
    expect(r.clusters.every((c) => c.members.length < 6)).toBe(true);
  });

  test('fuzzy cap is reported', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ value: `item${i}`, count: 50 - i }));
    const r = clusterValues(many, { normalize: DEFAULT_NORMALIZE, threshold: 0.9, maxFuzzyKeys: 20 });
    expect(r.skippedForFuzzy).toBe(30);
  });

  test('scales to 20k distinct values', () => {
    const vals: ValueCount[] = [];
    for (let i = 0; i < 20000; i++) vals.push({ value: `customer ${i.toString(36)} ${i % 7 === 0 ? 'ltd' : 'inc'}`, count: 1 + (i % 5) });
    const r = clusterValues(vals, { normalize: DEFAULT_NORMALIZE, threshold: 0.85 });
    console.log(`[perf] cluster 20k distinct @85%: ${r.elapsedMs.toFixed(0)} ms, ${r.clusters.length} clusters, skipped ${r.skippedForFuzzy}`);
    expect(r.elapsedMs).toBeLessThan(15000);
  }, 30000);
});
