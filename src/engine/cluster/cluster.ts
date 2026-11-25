/**
 * Groups spelling variants of the same value.
 *
 * Each value is reduced to a key by the chosen method (fingerprint, n-gram
 * fingerprint, simplified phonetic key, or the normalised value for the
 * nearest-neighbour methods). Values with the same key are always grouped.
 * Close keys are then attached to the most frequent centre; members are
 * compared to the centre only, so chains like a≈b≈c≈…≈z never collapse into
 * one giant cluster.
 *
 * Nothing is merged here — this only produces suggestions for review.
 */
import { boundedLevenshtein } from './levenshtein';
import { ngramFingerprint, phoneticKey, ppmSimilarity } from './methods';
import { fingerprint, type NormalizeOptions } from './normalize';

export interface ValueCount {
  value: string;
  count: number;
}

export interface Cluster {
  /** Stable id: the centre's key. */
  id: string;
  members: ValueCount[];
  /** Suggested value to merge into (see `suggestTarget`). */
  suggested: string;
  rows: number;
  /** Lowest similarity of any member's key to the centre (1 = same key). */
  similarity: number;
}

export type ClusterMethod = 'fingerprint' | 'ngram' | 'phonetic' | 'levenshtein' | 'ppm';

export interface ClusterOptions {
  normalize: NormalizeOptions;
  /** 0.5–1 for similarity methods. 1 = only identical keys. */
  threshold: number;
  /** Suggestion method. Defaults to `fingerprint` (the original behaviour). */
  method?: ClusterMethod;
  /** N-gram size for `ngram`, 1–5 (default 2). */
  n?: number;
  /** Maximum edit distance for `levenshtein`, 0–5 (default 2). */
  radius?: number;
  /** Only compare keys sharing this prefix length, 0 = off (default 0). */
  block?: number;
  /** Fuzzy matching only compares this many most frequent keys. */
  maxFuzzyKeys?: number;
}

export interface ClusterResult {
  clusters: Cluster[];
  distinctValues: number;
  /** Keys that were left out of fuzzy matching because of the cap. */
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

const clampInt = (n: number | undefined, lo: number, hi: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n ?? fallback))) : fallback;

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
  const method = opts.method ?? 'fingerprint';
  const threshold = Math.min(1, Math.max(0.5, opts.threshold));
  const n = clampInt(opts.n, 1, 5, 2);
  const radius = clampInt(opts.radius, 0, 5, 2);
  const block = clampInt(opts.block, 0, 8, 0);
  const exactOnly = method === 'levenshtein' ? radius === 0 : threshold >= 1;
  const keyFor = (value: string) => {
    if (method === 'ngram') return ngramFingerprint(value, n, opts.normalize);
    if (method === 'phonetic') return phoneticKey(value, opts.normalize);
    return fingerprint(value, opts.normalize);
  };
  const blocked = (a: string, b: string) => block > 0 && a.slice(0, block) !== b.slice(0, block);

  // 1. exact key groups
  const groups = new Map<string, Group>();
  for (const v of values) {
    if (v.value.trim() === '') continue;
    const key = keyFor(v.value);
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

  if (exactOnly) {
    for (const g of ordered) clusters.push({ centre: g, parts: [{ g, sim: 1 }] });
  } else {
    // Centres indexed by length so each group only compares to plausible pairs.
    const byLen = new Map<number, number[]>();
    ordered.forEach((g, i) => {
      if (i >= cap) {
        skipped++;
        clusters.push({ centre: g, parts: [{ g, sim: 1 }] });
        return;
      }
      let best: { ci: number; sim: number } | null = null;
      const minLen = method === 'levenshtein' ? Math.max(1, g.len - radius) : Math.ceil(g.len * threshold) - 1;
      const maxLen = method === 'levenshtein' ? g.len + radius : Math.floor(g.len / threshold) + 1;
      for (let L = Math.max(1, minLen); L <= maxLen; L++) {
        for (const ci of byLen.get(L) ?? []) {
          const c = clusters[ci]!.centre;
          if (blocked(g.key, c.key)) continue;
          const longest = Math.max(c.len, g.len);
          let sim: number;
          if (method === 'levenshtein') {
            const d = boundedLevenshtein(g.key, c.key, radius);
            if (d > radius) continue;
            sim = 1 - d / longest;
          } else if (method === 'ppm') {
            const p = ppmSimilarity(g.key, c.key);
            if (p < threshold) continue;
            sim = p;
          } else {
            const allowed = Math.floor((1 - threshold) * longest + 1e-9);
            if (allowed < 1) continue;
            const d = boundedLevenshtein(g.key, c.key, allowed);
            if (d > allowed) continue;
            sim = 1 - d / longest;
          }
          if (!best || sim > best.sim) best = { ci, sim };
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
