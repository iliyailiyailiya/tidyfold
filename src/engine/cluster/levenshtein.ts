/**
 * Levenshtein distance with an upper bound: returns `max + 1` as soon as the
 * distance is known to exceed `max` (banded DP, O(n·max) time).
 * Operates on code points so "ş" counts as one character.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const A = [...a];
  const B = [...b];
  let n = A.length;
  let m = B.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (n === 0) return m;
  if (m === 0) return n;
  // keep A the shorter
  if (n > m) {
    const t = A.slice();
    A.length = 0;
    A.push(...B);
    B.length = 0;
    B.push(...t);
    [n, m] = [m, n];
  }
  const INF = max + 1;
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j <= max ? j : INF;
  for (let i = 1; i <= n; i++) {
    const lo = Math.max(1, i - max);
    const hi = Math.min(m, i + max);
    cur[0] = i <= max ? i : INF;
    if (lo > 1) cur[lo - 1] = INF;
    let rowMin = cur[0]!;
    const ai = A[i - 1];
    for (let j = lo; j <= hi; j++) {
      const cost = ai === B[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur[j] = v > INF ? INF : v;
      if (v < rowMin) rowMin = v;
    }
    if (hi < m) cur[hi + 1] = INF;
    if (rowMin > max) return INF;
    [prev, cur] = [cur, prev];
  }
  const d = prev[m]!;
  return d > max ? INF : d;
}

export function levenshtein(a: string, b: string): number {
  return boundedLevenshtein(a, b, Math.max([...a].length, [...b].length));
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const len = Math.max([...a].length, [...b].length);
  return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
}
