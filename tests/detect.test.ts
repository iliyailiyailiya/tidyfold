import { describe, expect, test } from 'vitest';
import {
  detectDelimiter,
  detectHeader,
  detectKind,
  encodingFromBom,
  isValidUtf8,
  uniqueColumnNames,
} from '../src/engine/import/detect';
import { detectEncoding } from '../src/engine/import/pipeline';

describe('detectKind', () => {
  test.each([
    ['a.csv', 'csv'],
    ['A.TSV', 'tsv'],
    ['x.txt', 'csv'],
    ['book.xlsx', 'xlsx'],
    ['data.jsonl', 'json'],
    ['nope.pdf', null],
  ])('%s → %s', (f, k) => expect(detectKind(f)).toBe(k));
});

describe('detectDelimiter', () => {
  test('comma', () => expect(detectDelimiter('a,b,c\n1,2,3\n4,5,6\n')).toBe(','));
  test('semicolon with decimal commas', () =>
    expect(detectDelimiter('name;price\nTea;1,50\nCoffee;2,75\nCake;3,10\n')).toBe(';'));
  test('tab', () => expect(detectDelimiter('a\tb\n1\t2\n3\t4\n')).toBe('\t'));
  test('pipe', () => expect(detectDelimiter('a|b|c\n1|2|3\n')).toBe('|'));
  test('quoted commas do not fool it', () =>
    expect(detectDelimiter('city;note\n"Paris";"a, b, c, d"\n"Rome";"x, y, z, w"\n"Oslo";"p, q, r, s"\n')).toBe(';'));
});

describe('detectHeader', () => {
  test('text header over numbers', () =>
    expect(detectHeader([['name', 'age'], ['Ana', '31'], ['Bo', '45']])).toBe(true));
  test('no header when first row is data', () =>
    expect(detectHeader([['1', '2'], ['3', '4']])).toBe(false));
  test('duplicate names → not a header', () =>
    expect(detectHeader([['a', 'a'], ['1', '2']])).toBe(false));
  test('all-text table where first row repeats in body → no header', () =>
    expect(detectHeader([['red', 'apple'], ['green', 'pear'], ['red', 'plum']])).toBe(false));
  test('all-text table with distinct first row → header', () =>
    expect(detectHeader([['colour', 'fruit'], ['green', 'pear'], ['red', 'plum']])).toBe(true));
});

describe('encoding', () => {
  test('BOMs', () => {
    expect(encodingFromBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('utf-8');
    expect(encodingFromBom(new Uint8Array([0xff, 0xfe, 0x41, 0]))).toBe('utf-16le');
    expect(encodingFromBom(new Uint8Array([0x41]))).toBe(null);
  });
  test('valid utf-8 incl. diacritics', () => {
    expect(isValidUtf8(new TextEncoder().encode('Chişinău, Kishinev'))).toBe(true);
  });
  test('latin-1 bytes are not utf-8 and are detected as a single-byte encoding', () => {
    // "café;naïve\nrésumé;über\n" in windows-1252, repeated so the detector has signal
    const text = 'nom;ville;note\nCafé crème;Besançon;très élevé\nGâteau;Orléans;déjà vu\n'.repeat(20);
    const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0));
    expect(isValidUtf8(bytes)).toBe(false);
    const { encoding } = detectEncoding(bytes);
    expect(['windows-1252', 'iso-8859-2', 'windows-1250']).toContain(encoding);
    expect(new TextDecoder(encoding).decode(bytes)).toContain('crème');
  });
});

describe('uniqueColumnNames', () => {
  test('fills blanks and dedupes case-insensitively', () =>
    expect(uniqueColumnNames(['', 'a', 'A', null, 'a', '__row'])).toEqual(['column_1', 'a', 'A_2', 'column_4', 'a_3', 'column_6']));
});
