/**
 * Value normalisation for clustering ("fingerprints").
 * Each option ignores one kind of difference between spellings.
 */
export interface NormalizeOptions {
  /** "Paris" = "paris" */
  case: boolean;
  /** "Chişinău" = "Chisinau" (also ß→ss, æ→ae, ø→o, ł→l …) */
  accents: boolean;
  /** "New  York " = "New York" */
  spacing: boolean;
  /** "St. Louis" = "St Louis", "co-op" = "coop" */
  punctuation: boolean;
  /** "Smith, John" = "John Smith" */
  wordOrder: boolean;
}

export const DEFAULT_NORMALIZE: NormalizeOptions = {
  case: true,
  accents: true,
  spacing: true,
  punctuation: true,
  wordOrder: false,
};

// Letters NFKD doesn't decompose into base + combining mark.
const SPECIAL: Record<string, string> = {
  ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L',
  đ: 'd', Đ: 'D', ð: 'd', Ð: 'D', þ: 'th', Þ: 'TH', ı: 'i', ħ: 'h', Ħ: 'H',
};
const SPECIAL_RE = new RegExp(`[${Object.keys(SPECIAL).join('')}]`, 'g');

export function stripAccents(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(SPECIAL_RE, (c) => SPECIAL[c] ?? c);
}

const WS = /[\s  -​　﻿]+/g;

export function fingerprint(value: string, o: NormalizeOptions = DEFAULT_NORMALIZE): string {
  // NFC first so composed and decomposed forms of the same letter always match.
  let s = value.normalize('NFC');
  if (o.accents) s = stripAccents(s);
  if (o.case) s = s.toLocaleLowerCase();
  if (o.punctuation) s = s.replace(/[\p{P}\p{S}]+/gu, o.spacing || o.wordOrder ? ' ' : '');
  if (o.spacing || o.wordOrder || o.punctuation) s = s.replace(WS, ' ').trim();
  if (o.wordOrder) s = [...new Set(s.split(' ').filter(Boolean))].sort().join(' ');
  return s;
}
