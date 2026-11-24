import { describe, expect, test } from 'vitest';
import * as XLSX from 'xlsx';
import { parseDelimited, parseJson, parseXlsx, ImportError } from '../src/engine/import/parse';
import { analyze } from '../src/engine/import/pipeline';

const enc = (s: string) => new TextEncoder().encode(s);

describe('delimited', () => {
  test('quoted fields with delimiters and newlines', () => {
    const { table } = parseDelimited('a,b\n"x, y","line1\nline2"\n', { delimiter: ',', hasHeader: true });
    expect(table).toEqual({ columns: ['a', 'b'], rows: [['x, y', 'line1\nline2']] });
  });
  test('ragged rows are padded and warned about', () => {
    const r = parseDelimited('a,b,c\n1,2\n3,4,5\n', { delimiter: ',', hasHeader: true });
    expect(r.table.rows[0]).toEqual(['1', '2', null]);
    expect(r.warnings[0]).toMatch(/1 row has a different number of fields/);
  });
  test('BOM is stripped from the first header', () => {
    expect(parseDelimited('﻿id,name\n1,a', { delimiter: ',', hasHeader: true }).table.columns).toEqual(['id', 'name']);
  });
  test('no header → generic names, first row kept as data', () => {
    const r = parseDelimited('1,2\n3,4', { delimiter: ',', hasHeader: false });
    expect(r.table.columns).toEqual(['column_1', 'column_2']);
    expect(r.table.rows.length).toBe(2);
  });
});

describe('json', () => {
  test('array of objects with union of keys, nested values kept as JSON', () => {
    const { table } = parseJson('[{"a":1,"b":{"x":true}},{"a":2,"c":null}]');
    expect(table.columns).toEqual(['a', 'b', 'c']);
    expect(table.rows).toEqual([
      ['1', '{"x":true}', null],
      ['2', null, null],
    ]);
  });
  test('NDJSON', () => expect(parseJson('{"a":1}\n{"a":2}\n').table.rows).toEqual([['1'], ['2']]));
  test('wrapped records', () => {
    const r = parseJson('{"meta":{"v":1},"data":[{"a":1}]}');
    expect(r.table.rows).toEqual([['1']]);
    expect(r.warnings[0]).toMatch(/"data"/);
  });
  test('invalid JSON', () => expect(() => parseJson('{oops')).toThrow(ImportError));
});

describe('xlsx', () => {
  function workbook(): ArrayBuffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Joined', 'Score'],
      ['Ana', new Date(2024, 0, 15), 9.5],
      ['Bo', new Date(2023, 11, 1, 14, 30), null],
    ], { cellDates: true });
    XLSX.utils.book_append_sheet(wb, ws, 'People');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x'], [1]]), 'Other');
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  }
  test('reads sheets, dates as ISO text, numbers as text, blanks as null', () => {
    const r = parseXlsx(workbook(), { sheet: null, hasHeader: true });
    expect(r.sheets).toEqual(['People', 'Other']);
    expect(r.table.columns).toEqual(['Name', 'Joined', 'Score']);
    expect(r.table.rows[0]).toEqual(['Ana', '2024-01-15', '9.5']);
    expect(r.table.rows[1]).toEqual(['Bo', '2023-12-01 14:30:00', null]);
  });
  test('selects another sheet', () => {
    expect(parseXlsx(workbook(), { sheet: 'Other', hasHeader: true }).table.rows).toEqual([['1']]);
  });
  test('analyze detects header and sheet list', () => {
    const a = analyze('book.xlsx', new Uint8Array(workbook()));
    expect(a.kind).toBe('xlsx');
    expect(a.sheets).toEqual(['People', 'Other']);
    expect(a.options.hasHeader).toBe(true);
  });
});

describe('analyze', () => {
  test('semicolon CSV with header and types', () => {
    const a = analyze('x.csv', enc('id;name;joined\n1;Ana;2024-01-01\n2;Bo;2024-02-03\n'));
    expect(a.options.delimiter).toBe(';');
    expect(a.options.hasHeader).toBe(true);
    expect(a.preview.columns).toEqual(['id', 'name', 'joined']);
    expect(a.previewTypes).toEqual(['integer', 'text', 'date']);
  });
  test('user overrides win', () => {
    const a = analyze('x.csv', enc('a,b\n1,2\n'), { hasHeader: false, inferTypes: false });
    expect(a.preview.rows.length).toBe(2);
    expect(a.previewTypes).toEqual(['text', 'text']);
  });
  test('empty and unsupported files', () => {
    expect(() => analyze('x.csv', new Uint8Array())).toThrow(/empty/);
    expect(() => analyze('x.pdf', enc('hi'))).toThrow(/Unsupported/);
  });
});
