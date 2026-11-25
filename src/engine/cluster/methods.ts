/**
 * Extra keying functions and a local PPM-style similarity for clustering.
 * Everything here is pure TypeScript and runs in the data worker — no network,
 * no user-supplied code, no new dependencies.
 */
import { fingerprint, DEFAULT_NORMALIZE, type NormalizeOptions } from './normalize';

const clampInt = (n: number | undefined, lo: number, hi: number, fallback: number) =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n ?? fallback))) : fallback;

/** OpenRefine-style n-gram fingerprint: sorted, de-duplicated character n-grams. */
export function ngramFingerprint(value: string, n = 2, o: NormalizeOptions = DEFAULT_NORMALIZE): string {
  const s = fingerprint(value, o);
  if (!s) return '';
  const size = clampInt(n, 1, 5, 2);
  const chars = [...s];
  if (chars.length <= size) return chars.join('');
  const grams = new Set<string>();
  for (let i = 0; i <= chars.length - size; i++) grams.add(chars.slice(i, i + size).join(''));
  return [...grams].sort().join('');
}

const CONSONANT: Record<string, string> = {
  b: 'P', f: 'P', p: 'P', v: 'P',
  c: 'K', g: 'K', j: 'K', k: 'K', q: 'K', s: 'K', x: 'K', z: 'K',
  d: 'T', t: 'T', l: 'L', m: 'M', n: 'M', r: 'R',
};

/**
 * A deliberately small English phonetic key (simplified Metaphone), not a
 * full Metaphone3/Cologne implementation. It is only a suggestion generator:
 * every merge still needs human approval.
 */
export function phoneticKey(value: string, o: NormalizeOptions = DEFAULT_NORMALIZE): string {
  let s = fingerprint(value, { ...o, case: true, accents: true }).toLocaleLowerCase().replace(/[^a-z]/g, '');
  s = s.replace(/^(kn|gn|pn|wr)/, (m) => m.slice(1)).replace(/^x/, 's');
  s = s.replace(/tch/g, 'x').replace(/ph/g, 'f').replace(/sh/g, 'x').replace(/ch/g, 'x').replace(/th/g, 't');
  s = s.replace(/(.)\1+/g, '$1');
  let out = '';
  let firstVowel = true;
  for (const ch of s) {
    if ('aeiouy'.includes(ch)) {
      if (firstVowel) out += ch;
      firstVowel = false;
      continue;
    }
    firstVowel = false;
    out += CONSONANT[ch] ?? '';
  }
  return out.replace(/(.)\1+/g, '$1');
}

/** Code length in bits of `chars` under an order-`order` PPM model with escapes. */
function ppmCodeLength(chars: string[], order: number): number {
  const ALPHABET = 64;
  const counts = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  let bits = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    for (let k = Math.min(order, i); k >= 0; k--) {
      const ctx = k === 0 ? '' : chars.slice(i - k, i).join('');
      const m = counts.get(ctx);
      const total = totals.get(ctx) ?? 0;
      if (k === 0) {
        // Root context: back off to a uniform symbol model.
        const p = m?.has(ch) ? m.get(ch)! / (total + ALPHABET) : 1 / (total + ALPHABET);
        bits += -Math.log2(p);
        break;
      }
      const distinct = m?.size ?? 0;
      const escape = total === 0 ? 1 : (distinct + 1) / (total + distinct + 1);
      if (m?.has(ch)) {
        bits += -Math.log2(m.get(ch)! / (total + distinct + 1));
        break;
      }
      bits += -Math.log2(escape);
    }
    for (let k = Math.min(order, i); k >= 0; k--) {
      const ctx = k === 0 ? '' : chars.slice(i - k, i).join('');
      const m = counts.get(ctx) ?? new Map<string, number>();
      m.set(ch, (m.get(ch) ?? 0) + 1);
      counts.set(ctx, m);
      totals.set(ctx, (totals.get(ctx) ?? 0) + 1);
    }
  }
  return bits;
}

/**
 * PPM-style normalised compression similarity. Builds a small character model
 * locally from each string and compares how well each predicts the other.
 * 1 = identical, 0 = unrelated. Symmetric.
 */
export function ppmSimilarity(a: string, b: string, order = 2): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const A = [...a];
  const B = [...b];
  const ca = ppmCodeLength(A, order);
  const cb = ppmCodeLength(B, order);
  // Compression of a concatenation depends on order; use the better of the
  // two so the metric is symmetric.
  const cab = Math.min(ppmCodeLength([...A, ...B], order), ppmCodeLength([...B, ...A], order));
  const ncd = Math.min(1, Math.max(0, (cab - Math.min(ca, cb)) / Math.max(ca, cb, 1e-9)));
  // Square root keeps close spellings in the same 60–100% range as the other
  // methods while still pushing unrelated strings down to zero.
  return Math.sqrt(1 - ncd);
}
