/**
 * Groups spelling variants of the same value.
 *
 * 1. Values with the same fingerprint (after the chosen normalisations) are
 *    always grouped — "Chişinău", "chisinau ", "CHISINAU".
 * 2. If similarity < 100%, fingerprints are then grouped with the most
 *    frequent fingerprint they are close enough to (Levenshtein). Each group
 *    has one centre and members are compared to the centre only, so chains
 *    like a≈b≈c≈…≈z never collapse into one giant cluster.
 *
 * Nothing is merged here — this only produces suggestions for review.
 */
import { boundedLevenshtein } from './levenshtein';
import { fingerprint, type NormalizeOptions } from './normalize';

export interface ValueCount {
  value: string;
  count: number;
}

export interface Cluster {
  /** Stable id: the centre's fingerprint. */
  id: string;
  members: ValueCount[];
  /** Suggested value to merge into (see `suggestTarget`). */
  suggested: string;
  rows: number;
  /** Lowest similarity of any member's fingerprint to the centre (1 = same fingerprint). */
  similarity: number;
}

export interface ClusterOptions {
  normalize: NormalizeOptions;
  /** 0.5–1. 1 = only identical fingerprints. */
  threshold: number;
  /** Fuzzy matching only compares this many most frequent fingerprints. */
  maxFuzzyKeys?: number;
}

export interface ClusterResult {
  clusters: Cluster[];
  distinctValues: number;
  /** Fingerprints that were left out of fuzzy matching because of the cap. */
  skippedForFuzzy: number;
  elapsedMs: number;
}

export const DEFAULT_MAX_FUZZY_KEYS = 20000;

interface Group {
  key: string;
  len: number;
  members: ValueCount[];
  rows: number;
}

function byFrequency(a: ValueCount, b: ValueCount) {
  return b.count - a.count || a.value.localeCompare(b.value);
}

/**
 * The value to suggest merging into: prefer clean-looking spellings (no stray
 * edge spaces; Capitalised over all-lower/ALL-UPPER), then the most common.
 */
export function suggestTarget(members: ValueCount[]): string {
  const score = (v: string) => {
    let s = 0;
    if (v === v.trim()) s += 2;
    const letters = v.replace(/[^\p{L}]/gu, '');
    if (letters && letters !== letters.toLocaleLowerCase() && letters !== letters.toLocaleUpperCase()) s += 1;
    return s;
  };
  return [...members].sort((a, b) => score(b.value) - score(a.value) || byFrequency(a, b))[0]!.value;
}

export function clusterValues(values: ValueCount[], opts: ClusterOptions): ClusterResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // 1. exact fingerprint groups
  const groups = new Map<string, Group>();
  for (const v of values) {
    if (v.value.trim() === '') continue;
    const key = fingerprint(v.value, opts.normalize);
    if (key === '') continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, len: [...key].length, members: [], rows: 0 }));
    g.members.push(v);
    g.rows += v.count;
  }

  // 2. fuzzy: attach each group to the closest, more frequent centre
  const ordered = [...groups.values()].sort((a, b) => b.rows - a.rows || a.key.localeCompare(b.key));
  const cap = opts.maxFuzzyKeys ?? DEFAULT_MAX_FUZZY_KEYS;
  const clusters: { centre: Group; parts: { g: Group; sim: number }[] }[] = [];
  let skipped = 0;

  if (opts.threshold >= 1) {
    for (const g of ordered) clusters.push({ centre: g, parts: [{ g, sim: 1 }] });
  } else {
    // centres indexed by length for the length filter
    const byLen = new Map<number, number[]>();
    ordered.forEach((g, i) => {
      if (i >= cap) {
        skipped++;
        clusters.push({ centre: g, parts: [{ g, sim: 1 }] });
        return;
      }
      // smallest distance allowed for this pair is bounded by the longer key;
      // check centres whose length could possibly qualify
      let best: { ci: number; sim: number } | null = null;
      const maxLen = Math.floor(g.len / opts.threshold) + 1;
      const minLen = Math.ceil(g.len * opts.threshold) - 1;
      for (let L = Math.max(1, minLen); L <= maxLen; L++) {
        for (const ci of byLen.get(L) ?? []) {
          const c = clusters[ci]!.centre;
          const longest = Math.max(c.len, g.len);
          const allowed = Math.floor((1 - opts.threshold) * longest + 1e-9);
          if (allowed < 1) continue;
          const d = boundedLevenshtein(g.key, c.key, allowed);
          if (d <= allowed) {
            const sim = 1 - d / longest;
            if (!best || sim > best.sim) best = { ci, sim };
          }
        }
      }
      if (best) clusters[best.ci]!.parts.push({ g, sim: best.sim });
      else {
        clusters.push({ centre: g, parts: [{ g, sim: 1 }] });
        const list = byLen.get(g.len) ?? [];
        list.push(clusters.length - 1);
        byLen.set(g.len, list);
      }
    });
  }

  const out: Cluster[] = [];
  for (const c of clusters) {
    const members = c.parts.flatMap((p) => p.g.members).sort(byFrequency);
    if (members.length < 2) continue;
    out.push({
      id: c.centre.key,
      members,
      suggested: suggestTarget(members),
      rows: members.reduce((s, m) => s + m.count, 0),
      similarity: Math.min(...c.parts.map((p) => p.sim)),
    });
  }
  out.sort((a, b) => b.rows - a.rows || a.id.localeCompare(b.id));
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { clusters: out, distinctValues: values.length, skippedForFuzzy: skipped, elapsedMs: t1 - t0 };
}
