import Papa from 'papaparse';
import type { FileKind, RawCell } from './types';

export const DELIMITER_CANDIDATES = [',', ';', '\t', '|'] as const;

export function detectKind(fileName: string): FileKind | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'csv':
    case 'txt':
      return 'csv';
    case 'tsv':
    case 'tab':
      return 'tsv';
    case 'xlsx':
    case 'xlsm':
    case 'xls':
      return 'xlsx';
    case 'json':
    case 'ndjson':
    case 'jsonl':
      return 'json';
    default:
      return null;
  }
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Detects a byte-order mark; returns the encoding it implies, if any. */
export function encodingFromBom(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return null;
}

/** True when the bytes decode as valid UTF-8 (a truncated trailing sequence is tolerated). */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i]!;
    let need = 0;
    if (b < 0x80) need = 0;
    else if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) need = 2;
    else if (b >= 0xf0 && b <= 0xf4) need = 3;
    else return false;
    if (i + need >= n) return true; // sample cut mid-character
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k]!;
      if (c < 0x80 || c > 0xbf) return false;
    }
    i += need + 1;
  }
  return true;
}

/** Map chardet names to labels TextDecoder accepts. Unknown → utf-8. */
export function normalizeEncodingLabel(name: string | null | undefined): string {
  if (!name) return 'utf-8';
  const n = name.toLowerCase();
  const map: Record<string, string> = {
    ascii: 'utf-8',
    'utf-8': 'utf-8',
    'utf-16le': 'utf-16le',
    'utf-16be': 'utf-16be',
    'windows-1252': 'windows-1252',
    'iso-8859-1': 'windows-1252',
    'iso-8859-2': 'iso-8859-2',
    'windows-1250': 'windows-1250',
    'windows-1251': 'windows-1251',
    'iso-8859-5': 'iso-8859-5',
    'koi8-r': 'koi8-r',
    'iso-8859-7': 'iso-8859-7',
    'windows-1253': 'windows-1253',
    'iso-8859-8': 'iso-8859-8',
    'windows-1255': 'windows-1255',
    shift_jis: 'shift_jis',
    'euc-jp': 'euc-jp',
    'euc-kr': 'euc-kr',
    big5: 'big5',
    gb2312: 'gbk',
    gb18030: 'gb18030',
    'x-mac-cyrillic': 'x-mac-cyrillic',
    maccyrillic: 'x-mac-cyrillic',
  };
  return map[n] ?? 'utf-8';
}

export interface DelimiterScore {
  delimiter: string;
  fields: number;
  consistency: number;
}

/**
 * Picks the delimiter that splits the sample into the most consistent
 * multi-column shape. Quote-aware (uses PapaParse on the sample).
 */
export function detectDelimiter(sample: string, maxLines = 50): string {
  const scores = scoreDelimiters(sample, maxLines);
  return scores[0]?.delimiter ?? ',';
}

export function scoreDelimiters(sample: string, maxLines = 50): DelimiterScore[] {
  const scores: DelimiterScore[] = [];
  for (const delimiter of DELIMITER_CANDIDATES) {
    const res = Papa.parse<string[]>(sample, {
      delimiter,
      preview: maxLines,
      skipEmptyLines: true,
    });
    const rows = res.data;
    // drop the last row — the sample may have cut it in half
    const usable = rows.length > 2 ? rows.slice(0, -1) : rows;
    if (usable.length === 0) continue;
    const counts = new Map<number, number>();
    for (const r of usable) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    let mode = 1;
    let modeCount = 0;
    for (const [len, c] of counts) {
      if (c > modeCount || (c === modeCount && len > mode)) {
        mode = len;
        modeCount = c;
      }
    }
    if (mode < 2) continue;
    scores.push({ delimiter, fields: mode, consistency: modeCount / usable.length });
  }
  // Consistency first, then more fields.
  scores.sort((a, b) => b.consistency - a.consistency || b.fields - a.fields);
  return scores;
}

type CellShape = 'blank' | 'number' | 'boolean' | 'date' | 'text';

function shapeOf(v: RawCell): CellShape {
  if (v === null) return 'blank';
  const t = v.trim();
  if (t === '') return 'blank';
  if (/^[-+]?(\d+([.,]\d+)*|\.\d+)([eE][-+]?\d+)?%?$/.test(t)) return 'number';
  if (/^(true|false)$/i.test(t)) return 'boolean';
  if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(t)) return 'date';
  return 'text';
}

/**
 * Header heuristic. The first row is a header when its cells are all present,
 * unique and textual, and at least one column whose header is text holds
 * non-text values below it — or when the data rows are themselves all text
 * but the first row is clearly distinct (no repeats with the body).
 */
export function detectHeader(rows: RawCell[][]): boolean {
  const first = rows[0];
  if (!first || first.length === 0) return false;
  const body = rows.slice(1, 51);

  const names = first.map((c) => (c ?? '').trim());
  if (names.some((n) => n === '')) return false;
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return false;
  if (first.some((c) => shapeOf(c) !== 'text')) return false;
  if (body.length === 0) return true;

  for (let col = 0; col < first.length; col++) {
    const shapes = body.map((r) => shapeOf(r[col] ?? null)).filter((s) => s !== 'blank');
    if (shapes.length > 0 && shapes.every((s) => s !== 'text')) return true;
  }
  // All-text table: header if none of its values reappear in its column.
  for (let col = 0; col < first.length; col++) {
    const h = names[col]!.toLowerCase();
    if (body.some((r) => (r[col] ?? '').trim().toLowerCase() === h)) return false;
  }
  return true;
}

/** Makes column names non-empty and unique: "", "a", "a" → "column_1", "a", "a_2". */
export function uniqueColumnNames(raw: RawCell[]): string[] {
  const used = new Set<string>();
  return raw.map((c, i) => {
    let base = (c ?? '').trim().replace(/\s+/g, ' ');
    if (base === '' || base === '__row') base = `column_${i + 1}`;
    let name = base;
    let k = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${k++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function genericColumnNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `column_${i + 1}`);
}
