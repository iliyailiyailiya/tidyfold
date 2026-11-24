import { describe, expect, test } from 'vitest';
import { inferColumn, matchesType } from '../src/engine/import/infer';

const t = (vals: (string | null)[]) => inferColumn(vals).type;

describe('inferColumn', () => {
  test('integers', () => expect(t(['1', '-2', '30', '', null])).toBe('integer'));
  test('leading zeros stay text (ZIP codes, IDs)', () => expect(t(['02134', '10001'])).toBe('text'));
  test('decimals', () => expect(t(['1.5', '2', '-0.25', '1e3'])).toBe('decimal'));
  test('thousands separators stay text', () => expect(t(['1,234', '5'])).toBe('text'));
  test('booleans', () => expect(t(['true', 'FALSE', 'True'])).toBe('boolean'));
  test('yes/no is not boolean (ambiguous)', () => expect(t(['yes', 'no'])).toBe('text'));
  test('ISO dates', () => expect(t(['2024-02-29', '2023-12-31'])).toBe('date'));
  test('invalid date stays text', () => expect(t(['2023-02-29'])).toBe('text'));
  test('ambiguous local dates stay text', () => expect(t(['01/02/2024'])).toBe('text'));
  test('timestamps', () => expect(t(['2024-01-01 10:00', '2024-01-01T23:59:59.123'])).toBe('timestamp'));
  test('mixed date + timestamp → text (not lossy)', () => expect(t(['2024-01-01', '2024-01-01 10:00'])).toBe('text'));
  test('whitespace-padded numbers stay text (no silent trimming)', () => expect(t([' 42', '7'])).toBe('text'));
  test('all blank → text', () => expect(t(['', '  ', null])).toBe('text'));
  test('one bad value spoils the type', () => expect(t(['1', '2', 'n/a'])).toBe('text'));
  test('counts blanks', () => expect(inferColumn(['1', ' ', null, '']).blank).toBe(3));
  test('more digits than a double holds stays text', () => expect(t(['12345678901234567890'])).toBe('text'));
  test('19-digit IDs stay text', () => expect(t(['1234567890123456789'])).toBe('text'));
});

describe('matchesType edge cases', () => {
  test.each(['.', '+', 'e5', '', '1.', '--1'])('%s is not decimal', (v) => expect(matchesType(v, 'decimal')).toBe(false));
  test('24:00 is not a time', () => expect(matchesType('2024-01-01 24:00', 'timestamp')).toBe(false));
});
