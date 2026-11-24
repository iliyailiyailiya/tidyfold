import { beforeAll, describe, expect, test } from 'vitest';
import { createNodeDb } from './helpers/nodeDb';
import type { Db } from '../src/engine/duckdb/types';
import { CHECKPOINT_EVERY, DatasetSession, KEEP_RECENT } from '../src/engine/dataset/session';
import { dateOrderStats, decimalStats } from '../src/engine/dataset/preview';
import { analyze, runImport } from '../src/engine/import/pipeline';
import { parseRecipe, recipeToOperations, toRecipe } from '../src/engine/history/recipe';
import type { OperationSpec } from '../src/engine/history/operations';

let db: Db;
beforeAll(async () => {
  db = await createNodeDb();
});

async function load(csv: string, inferTypes = true) {
  const bytes = new TextEncoder().encode(csv);
  const { options } = analyze('t.csv', bytes, { inferTypes });
  return DatasetSession.create(db, runImport('t.csv', bytes, { ...options, inferTypes }));
}
const col = async (s: DatasetSession, i = 0) => (await s.page({ offset: 0, limit: 1000 })).rows.map((r) => r[i]);

describe('replace_values', () => {
  test('exact, case-insensitive', async () => {
    const s = await load('city\nParis\nparis\nParis Hilton\nRome\n');
    await s.apply({ kind: 'replace_values', params: { column: 'city', find: 'PARIS', replace: 'Paris, FR', match: 'exact', matchCase: false } });
    expect(await col(s)).toEqual(['Paris, FR', 'Paris, FR', 'Paris Hilton', 'Rome']);
  });
  test('contains, case-sensitive, with regex characters treated literally', async () => {
    const s = await load('v\na.b.c\naXb\n(1+1)\n');
    await s.apply({ kind: 'replace_values', params: { column: 'v', find: '.', replace: '-', match: 'contains', matchCase: true } });
    expect(await col(s)).toEqual(['a-b-c', 'aXb', '(1+1)']);
  });
  test('contains, case-insensitive escapes regex and backslashes in replacement', async () => {
    const s = await load('v\n(1+1) and (1+1)\nA\n');
    await s.apply({ kind: 'replace_values', params: { column: 'v', find: '(1+1)', replace: 'C:\\two', match: 'contains', matchCase: false } });
    expect(await col(s)).toEqual(['C:\\two and C:\\two', 'A']);
  });
  test('only on text columns', async () => {
    const s = await load('n\n1\n2\n');
    await expect(s.apply({ kind: 'replace_values', params: { column: 'n', find: '1', replace: '3', match: 'exact', matchCase: true } })).rejects.toThrow(/Convert it to text/);
  });
});

describe('fill_missing', () => {
  const csv = 'g,v,n\na,x,1\nb,,\nc,  ,3\nd,y,\ne,,5\n';
  test('constant value on text (blank-only counts as missing)', async () => {
    const s = await load(csv);
    await s.apply({ kind: 'fill_missing', params: { column: 'v', mode: 'value', value: 'unknown' } });
    expect(await col(s, 1)).toEqual(['x', 'unknown', 'unknown', 'y', 'unknown']);
  });
  test('typed constant must be valid', async () => {
    const s = await load(csv);
    await expect(s.apply({ kind: 'fill_missing', params: { column: 'n', mode: 'value', value: 'abc' } })).rejects.toThrow(/isn't a valid/);
    await s.apply({ kind: 'fill_missing', params: { column: 'n', mode: 'value', value: '0' } });
    expect(await col(s, 2)).toEqual(['1', '0', '3', '0', '5']);
  });
  test('fill down and up follow original row order', async () => {
    const s = await load(csv);
    await s.apply({ kind: 'fill_missing', params: { column: 'v', mode: 'down' } });
    expect(await col(s, 1)).toEqual(['x', 'x', 'x', 'y', 'y']);
    await s.undo();
    await s.apply({ kind: 'fill_missing', params: { column: 'n', mode: 'up' } });
    expect(await col(s, 2)).toEqual(['1', '3', '3', '5', '5']);
  });
});

describe('change_case title', () => {
  test('title case', async () => {
    const s = await load('n\nana POPESCU\nJEAN-luc\n');
    await s.apply({ kind: 'change_case', params: { column: 'n', mode: 'title' } });
    expect(await col(s)).toEqual(['Ana Popescu', 'Jean-luc']);
  });
});

describe('trim collapseInner', () => {
  test('collapses inner whitespace runs only when asked', async () => {
    const s = await load('n\n"  New    York  "\n');
    await s.apply({ kind: 'trim_whitespace', params: { columns: ['n'], collapseInner: true } });
    expect(await col(s)).toEqual(['New York']);
  });
});

describe('standardize_dates', () => {
  const csv = 'd,k\n05/03/2024,1\n5.3.24,2\n2024-03-05,3\n3 March 2024,4\n"Mar 5, 2024",5\n31/02/2024,6\nsoon,7\n,8\n';
  test('DMY converts what it can and leaves the rest untouched', async () => {
    const s = await load(csv);
    await s.apply({ kind: 'standardize_dates', params: { column: 'd', order: 'DMY' } });
    expect(await col(s)).toEqual(['2024-03-05', '2024-03-05', '2024-03-05', '2024-03-03', '2024-03-05', '31/02/2024', 'soon', '']);
  });
  test('two- and four-digit years, and no year-0024 surprises', async () => {
    const s = await load('d\n5.3.24\n05/03/1999\n1-2-2003\n');
    await s.apply({ kind: 'standardize_dates', params: { column: 'd', order: 'DMY' } });
    expect(await col(s)).toEqual(['2024-03-05', '1999-03-05', '2003-02-01']);
  });
  test('MDY reads the same text differently', async () => {
    const s = await load('d\n05/03/2024\n');
    await s.apply({ kind: 'standardize_dates', params: { column: 'd', order: 'MDY' } });
    expect(await col(s)).toEqual(['2024-05-03']);
  });
  test('preview reports unparseable values; stats help pick an order', async () => {
    const s = await load(csv);
    const p = await s.preview({ kind: 'standardize_dates', params: { column: 'd', order: 'DMY' } });
    expect(p.changedCells).toBe(4);
    expect(p.notes[0]!.text).toMatch(/2 values can't be read/);
    expect(p.notes[0]!.examples).toEqual(expect.arrayContaining(['31/02/2024', 'soon']));
    const st = await dateOrderStats(db, s.currentTable, 'd');
    expect(st.nonBlank).toBe(7);
    expect(st.DMY).toBeGreaterThan(st.YMD);
  });
});

describe('normalize_numbers', () => {
  test('decimal comma', async () => {
    const s = await load('p\n"1.234,50"\n"€ 12,5"\n(1.000)\n-3\n12%\nabc\n');
    expect((await decimalStats(db, s.currentTable, 'p'))[',']).toBeGreaterThan((await decimalStats(db, s.currentTable, 'p'))['.']);
    await s.apply({ kind: 'normalize_numbers', params: { column: 'p', decimal: ',' } });
    expect(await col(s)).toEqual(['1234.50', '12.5', '-1000', '-3', '12%', 'abc']);
  });
  test('decimal point with thousands commas, then strict convert', async () => {
    const s = await load('p\n"1,234.5"\n$ 99\n.5\n');
    await s.apply({ kind: 'normalize_numbers', params: { column: 'p', decimal: '.' } });
    expect(await col(s)).toEqual(['1234.5', '99', '0.5']);
    await s.apply({ kind: 'change_type', params: { column: 'p', to: 'decimal' } });
    expect(s.schema[0]!.type).toBe('decimal');
  });
});

describe('change_type', () => {
  test('text → integer blocked by a bad value: preview explains, apply rolls back', async () => {
    const s = await load('n\n1\n2\nthree\n');
    const p = await s.preview({ kind: 'change_type', params: { column: 'n', to: 'integer' } });
    expect(p.blocked).toMatch(/1 value can't be converted/);
    expect(p.notes[0]!.examples).toEqual(['three']);
    await expect(s.apply({ kind: 'change_type', params: { column: 'n', to: 'integer' } })).rejects.toThrow(/three/);
    expect(s.history.ops.length).toBe(0);
    expect(s.schema[0]!.type).toBe('text');
    expect(await col(s)).toEqual(['1', '2', 'three']);
  });
  test('decimal → integer only when whole', async () => {
    const s = await load('n\n1.5\n2\n');
    await expect(s.apply({ kind: 'change_type', params: { column: 'n', to: 'integer' } })).rejects.toThrow(/Not a whole number/);
  });
  test('round trip integer → text → integer', async () => {
    const s = await load('n,k\n1,a\n,b\n3,c\n');
    await s.apply({ kind: 'change_type', params: { column: 'n', to: 'text' } });
    await s.apply({ kind: 'change_type', params: { column: 'n', to: 'integer' } });
    expect(await col(s)).toEqual(['1', null, '3']);
  });
  test('unsupported direct conversion', async () => {
    const s = await load('d\n2024-01-01\n');
    await expect(s.apply({ kind: 'change_type', params: { column: 'd', to: 'integer' } })).rejects.toThrow(/Convert to text first/);
  });
});

describe('preview', () => {
  test('diff samples, renamed and removed columns, removed rows', async () => {
    const s = await load('k,v\na, 1\nb,2\na, 1\n');
    const trim = await s.preview({ kind: 'trim_whitespace', params: { columns: ['v'] } });
    expect(trim.changedCells).toBe(2);
    expect(trim.samples[0]).toEqual({ rowId: 1, column: 'v', before: ' 1', after: '1' });
    const dd = await s.preview({ kind: 'remove_duplicates', params: { columns: [] } });
    expect(dd.removedCount).toBe(1);
    expect(dd.removedRows[0]).toEqual({ rowId: 3, values: ['a', ' 1'] });
    const rn = await s.preview({ kind: 'rename_column', params: { column: 'k', to: 'key' } });
    expect(rn.renamed).toEqual([{ from: 'k', to: 'key' }]);
    expect(rn.changedCells).toBe(0);
    const rm = await s.preview({ kind: 'remove_column', params: { column: 'v' } });
    expect(rm.removedColumns).toEqual(['v']);
    // preview never changes anything
    expect(s.history.ops.length).toBe(0);
  });
  test('invalid params throw', async () => {
    const s = await load('k\na\n');
    await expect(s.preview({ kind: 'replace_values', params: { column: 'k', find: '', replace: 'x', match: 'exact', matchCase: true } })).rejects.toThrow(/Enter the text/);
  });
});

describe('step retention', () => {
  test('keeps few tables, still answers correctly after undo/redo/jumps', async () => {
    const s = await load('v\na\n');
    const steps: OperationSpec[] = [];
    for (let i = 0; i < 20; i++) steps.push({ kind: 'replace_values', params: { column: 'v', find: i === 0 ? 'a' : `a${i - 1}`, replace: `a${i}`, match: 'exact', matchCase: true } });
    for (const st of steps) await s.apply(st);
    const kept = s.materialisedSteps;
    expect(kept.length).toBeLessThanOrEqual(1 + KEEP_RECENT + 1 + Math.floor(20 / CHECKPOINT_EVERY));
    expect(await col(s)).toEqual(['a19']);
    await s.jumpTo(11); // not materialised → rebuilt from checkpoint 8
    expect(await col(s)).toEqual(['a10']);
    for (let i = 0; i < 5; i++) await s.undo();
    expect(await col(s)).toEqual(['a5']);
    await s.jumpTo(20);
    expect(await col(s)).toEqual(['a19']);
    await s.remove(s.history.ops[19]!.id);
    expect(await col(s)).toEqual(['a18']);
  });
});

describe('recipes with phase-2 operations', () => {
  test('round trip and replay', async () => {
    const csv = 'd,p\n05/03/2024,"1.234,5"\n,\n';
    const s = await load(csv);
    await s.apply({ kind: 'standardize_dates', params: { column: 'd', order: 'DMY' } });
    await s.apply({ kind: 'fill_missing', params: { column: 'd', mode: 'value', value: 'n/a' } });
    await s.apply({ kind: 'normalize_numbers', params: { column: 'p', decimal: ',' } });
    const r = parseRecipe(JSON.stringify(toRecipe(s.history.ops, 'r')));
    const fresh = await load(csv);
    expect((await fresh.replay(recipeToOperations(r))).failed).toBeNull();
    expect((await fresh.page({ offset: 0, limit: 10 })).rows).toEqual((await s.page({ offset: 0, limit: 10 })).rows);
  });
  test('replay that fails on the data changes nothing', async () => {
    const s = await load('n\n1\nx\n');
    const r = recipeToOperations({ format: 'tidyfold-recipe', version: 1, name: 'r', createdAt: '', operations: [{ kind: 'change_type', params: { column: 'n', to: 'integer' } }] });
    const res = await s.replay(r);
    expect(res.failed?.error).toMatch(/x/);
    expect(s.history.ops.length).toBe(0);
    expect(await col(s)).toEqual(['1', 'x']);
  });
  test('rejects bad params for new kinds', () => {
    const bad = (op: object) => JSON.stringify({ format: 'tidyfold-recipe', version: 1, operations: [op] });
    expect(() => parseRecipe(bad({ kind: 'standardize_dates', params: { column: 'd', order: 'YDM' } }))).toThrow(/can't be "YDM"/);
    expect(() => parseRecipe(bad({ kind: 'change_type', params: { column: 'd', to: 'money' } }))).toThrow(/unknown type/);
    expect(() => parseRecipe(bad({ kind: 'fill_missing', params: { column: 'd', mode: 'value' } }))).toThrow(/"value" must be text/);
  });
});

describe('export builders', async () => {
  const XLSX = await import('xlsx');
  const { buildJson, buildXlsx } = await import('../src/engine/export/formats');
  test('JSON and XLSX keep types; huge IDs stay exact', async () => {
    const s = await load('id,big,price,ok,day,at,name\n1,12345678901234567,9.5,true,2024-03-05,2024-03-05 10:30:00,Ana\n2,,,,,,\n');
    const { schema, rows } = await s.exportRows();
    const json = JSON.parse(new TextDecoder().decode(buildJson(schema, rows)));
    expect(json[0]).toEqual({ id: 1, big: '12345678901234567', price: 9.5, ok: true, day: '2024-03-05', at: '2024-03-05 10:30:00', name: 'Ana' });
    expect(json[1]).toEqual({ id: 2, big: null, price: null, ok: null, day: null, at: null, name: '' }); // empty text stays empty text

    const wb = XLSX.read(buildXlsx(schema, rows, 'My data'), { type: 'array', cellDates: true, cellNF: true });
    expect(wb.SheetNames).toEqual(['My data']);
    const ws = wb.Sheets['My data']!;
    expect(ws['A2'].v).toBe(1);
    expect(ws['B2'].v).toBe('12345678901234567');
    expect(ws['D2'].v).toBe(true);
    expect(ws['E2'].t).toBe('d');
    const d = ws['E2'].v as Date;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2024, 2, 5]);
    expect(ws['F2'].z).toBe('yyyy-mm-dd hh:mm:ss');
  });
  test('Excel row limit is enforced with a clear message', () => {
    const rows = new Array(1_048_576).fill(['x']);
    expect(() => buildXlsx([{ name: 'a', type: 'text' }], rows)).toThrow(/Export as CSV instead/);
  });
});
