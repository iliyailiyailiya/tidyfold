import { beforeAll, describe, expect, test } from 'vitest';
import { createNodeDb } from './helpers/nodeDb';
import type { Db } from '../src/engine/duckdb/types';
import { DatasetSession } from '../src/engine/dataset/session';
import { analyze, runImport } from '../src/engine/import/pipeline';
import { parseRecipe, recipeToOperations, toRecipe } from '../src/engine/history/recipe';
import { describeOperation, type CalcNode, type OperationSpec } from '../src/engine/history/operations';
import { compileCalc, describeCalc, isCalcNode, validateRegex } from '../src/engine/history/expression';

let db: Db;
beforeAll(async () => {
  db = await createNodeDb();
});

async function load(csv: string, inferTypes = true) {
  const bytes = new TextEncoder().encode(csv);
  const { options } = analyze('t.csv', bytes, { inferTypes, hasHeader: true });
  return DatasetSession.create(db, runImport('t.csv', bytes, { ...options, inferTypes, hasHeader: true }));
}
const page = async (s: DatasetSession, limit = 100) => s.page({ offset: 0, limit });
const col = async (s: DatasetSession, i = 0) => (await page(s)).rows.map((r) => r[i]);

const SPLIT: OperationSpec = {
  kind: 'split_column',
  params: { column: 'name', by: 'delimiter', delimiter: '|', maxParts: 2, keepOriginal: true },
};

describe('split_column', () => {
  test('splits on a literal delimiter; missing parts become empty, extra parts stay in the last column', async () => {
    const s = await load('name\n"A|B"\nC\n"D|E|F"\n');
    const pv = await s.preview(SPLIT);
    expect(pv.addedColumns.map((c) => c.name)).toEqual(['name_1', 'name_2']);
    expect(pv.addedColumns[0]!.samples).toEqual(['A', 'C', 'D']);
    expect(pv.notes.some((n) => /fewer parts/.test(n.text))).toBe(true);
    expect(pv.notes.some((n) => /more parts/.test(n.text))).toBe(true);
    await s.apply(SPLIT);
    expect((await page(s)).rows).toEqual([
      ['A|B', 'A', 'B'],
      ['C', 'C', ''],
      ['D|E|F', 'D', 'E|F'],
    ]);
  });

  test('regex-special delimiters are literal; keepOriginal removes the source when asked', async () => {
    const s = await load('name\n"a.b.c"\nx\n');
    await s.apply({ kind: 'split_column', params: { column: 'name', by: 'delimiter', delimiter: '.', maxParts: 3, names: ['one', 'two', 'three'], keepOriginal: false } });
    expect(s.schema.map((c) => c.name)).toEqual(['one', 'two', 'three']);
    expect((await page(s)).rows).toEqual([['a', 'b', 'c'], ['x', '', '']]);
  });

  test('splits by character position', async () => {
    const s = await load('code\nAB123\nx\nABCDE\n');
    await s.apply({ kind: 'split_column', params: { column: 'code', by: 'position', positions: [2, 4], maxParts: 3, keepOriginal: false } });
    expect((await page(s)).rows).toEqual([['AB', '12', '3'], ['x', '', ''], ['AB', 'CD', 'E']]);
  });

  test('validation', async () => {
    const s = await load('name\nA|B\n');
    const split = (p: Record<string, unknown>) => s.apply({ kind: 'split_column', params: { column: 'name', by: 'delimiter', delimiter: '|', maxParts: 2, keepOriginal: true, ...p } } as OperationSpec);
    await expect(split({ delimiter: '' })).rejects.toThrow(/Enter the text/);
    await expect(split({ maxParts: 1 })).rejects.toThrow(/2 and 50/);
    await expect(split({ names: ['x', 'name'] })).rejects.toThrow(/already exists/);
    await expect(split({ names: ['x', 'x'] })).rejects.toThrow(/already exists/);
    await expect(split({ names: ['x', '__row'] })).rejects.toThrow(/reserved/);
    await expect(split({ by: 'position', positions: [] })).rejects.toThrow(/at least one split position/);
    await expect(split({ by: 'position', positions: [3, 2], maxParts: 3 })).rejects.toThrow(/increasing/);
    await expect(split({ by: 'position', positions: [2], maxParts: 3 })).rejects.toThrow(/one more/);
  });
});

describe('merge_columns', () => {
  test('joins columns, optionally skipping blank cells', async () => {
    const s = await load('a,b,c\nParis,,"FR"\nNice,2,\n');
    await s.apply({ kind: 'merge_columns', params: { columns: ['a', 'b', 'c'], separator: ' | ', into: 'full', skipEmpty: true, keepOriginals: true } });
    expect(await col(s, 3)).toEqual(['Paris | FR', 'Nice | 2']);
    expect(s.schema.map((c) => c.name)).toEqual(['a', 'b', 'c', 'full']);
  });
  test('keeps empty cells when skipEmpty is false, and can remove the originals', async () => {
    const s = await load('a,b\nX,\n,Y\n');
    await s.apply({ kind: 'merge_columns', params: { columns: ['a', 'b'], separator: '-', into: 'joined', skipEmpty: false, keepOriginals: false } });
    expect(s.schema.map((c) => c.name)).toEqual(['joined']);
    expect(await col(s)).toEqual(['X-', '-Y']);
  });
  test('validation', async () => {
    const s = await load('a,b\nX,Y\n');
    const merge = (p: Record<string, unknown>) => s.apply({ kind: 'merge_columns', params: { columns: ['a', 'b'], separator: '-', into: 'joined', skipEmpty: true, keepOriginals: true, ...p } } as OperationSpec);
    await expect(merge({ columns: ['a'] })).rejects.toThrow(/at least two/);
    await expect(merge({ columns: ['a', 'a'] })).rejects.toThrow(/only once/);
    await expect(merge({ columns: ['a', 'missing'] })).rejects.toThrow(/doesn't exist/);
    await expect(merge({ into: 'A' })).rejects.toThrow(/already exists/);
  });
});

describe('extract_text', () => {
  const CSV = 'v\n"id=42;done"\n"nothing here"\n"ID=7;later"\n';
  test('before / after / between', async () => {
    const s = await load(CSV);
    const pv = await s.preview({ kind: 'extract_text', params: { column: 'v', mode: 'before', start: '=', into: 'part', matchCase: true } });
    expect(pv.notes.some((n) => /empty cells/.test(n.text))).toBe(true);
    expect(pv.addedColumns[0]!.samples).toEqual(['id', 'ID']);
    await s.apply({ kind: 'extract_text', params: { column: 'v', mode: 'before', start: '=', into: 'part', matchCase: true } });
    expect(await col(s, 1)).toEqual(['id', '', 'ID']);
    await s.undo();
    await s.apply({ kind: 'extract_text', params: { column: 'v', mode: 'between', start: '=', end: ';', into: 'part', matchCase: true } });
    expect(await col(s, 1)).toEqual(['42', '', '7']);
    await s.undo();
    await s.apply({ kind: 'extract_text', params: { column: 'v', mode: 'after', start: '=', into: 'part', matchCase: true } });
    expect(await col(s, 1)).toEqual(['42;done', '', '7;later']);
  });
  test('case-insensitive regex keeps the original spelling', async () => {
    const s = await load(CSV);
    await s.apply({ kind: 'extract_text', params: { column: 'v', mode: 'regex', pattern: 'id=(\\d+)', into: 'id', matchCase: false } });
    expect(await col(s, 1)).toEqual(['id=42', '', 'ID=7']);
  });
  test('invalid regex gets a friendly error before any SQL runs', async () => {
    const s = await load(CSV);
    const bad = (pattern: string) => s.apply({ kind: 'extract_text', params: { column: 'v', mode: 'regex', pattern, into: 'id', matchCase: true } });
    await expect(bad('([a-z)')).rejects.toThrow(/missing its closing/);
    await expect(bad('(?=x)')).rejects.toThrow(/Look-ahead/);
    await expect(bad('(a)\\1')).rejects.toThrow(/Backreferences/);
    await expect(bad('')).rejects.toThrow(/Enter a pattern/);
    expect(validateRegex('(?:a|b)+')).toBeNull();
  });
  test('validation', async () => {
    const s = await load(CSV);
    await expect(s.apply({ kind: 'extract_text', params: { column: 'v', mode: 'between', start: '=', into: 'id', matchCase: true } })).rejects.toThrow(/both/);
    await expect(s.apply({ kind: 'extract_text', params: { column: 'v', mode: 'before', start: '', into: 'id', matchCase: true } })).rejects.toThrow(/Enter the text/);
  });
});

describe('calculated_column', () => {
  const CSV = 'price,qty\n10,3\n2.5,4\n,2\n';
  const schema = [{ name: 'price', type: 'decimal' as const }, { name: 'qty', type: 'integer' as const }];
  const total: CalcNode = { kind: 'binary', op: 'multiply', left: { kind: 'column', name: 'price' }, right: { kind: 'column', name: 'qty' } };
  test('nested expression with rounding, and a readable sentence', async () => {
    const s = await load(CSV, true);
    const expression: CalcNode = { kind: 'round', value: total, digits: 1 };
    expect(describeCalc(expression, s.schema)).toContain('price × qty, rounded to 1 decimal');
    await s.apply({ kind: 'calculated_column', params: { into: 'total', expression } });
    expect(await col(s, 2)).toEqual(['30.0', '10.0', null]);
    expect(s.schema[2]!.type).toBe('decimal');
  });
  test('divide by zero gives an empty cell and a preview warning', async () => {
    const s = await load('a,b\n10,0\n8,2\n');
    const spec: OperationSpec = { kind: 'calculated_column', params: { into: 'ratio', expression: { kind: 'binary', op: 'divide', left: { kind: 'column', name: 'a' }, right: { kind: 'column', name: 'b' } } } };
    const pv = await s.preview(spec);
    expect(pv.notes.some((n) => /division by zero/.test(n.text))).toBe(true);
    await s.apply(spec);
    expect(await col(s, 2)).toEqual([null, '4.0']);
  });
  test('text, date-part and days-between functions; type errors are clear', async () => {
    const s = await load('name,day,other\n"ana popescu",2024-01-05,2024-01-08\n');
    await s.apply({ kind: 'calculated_column', params: { into: 'label', expression: { kind: 'upper', value: { kind: 'column', name: 'name' } } } });
    expect(await col(s, 3)).toEqual(['ANA POPESCU']);
    await s.apply({ kind: 'calculated_column', params: { into: 'yr', expression: { kind: 'datePart', part: 'year', value: { kind: 'column', name: 'day' } } } });
    expect(await col(s, 4)).toEqual(['2024']);
    await s.apply({ kind: 'calculated_column', params: { into: 'gap', expression: { kind: 'daysBetween', from: { kind: 'column', name: 'day' }, to: { kind: 'column', name: 'other' } } } });
    expect(await col(s, 5)).toEqual(['3']);
    const bad: OperationSpec = { kind: 'calculated_column', params: { into: 'bad', expression: { kind: 'binary', op: 'add', left: { kind: 'column', name: 'name' }, right: { kind: 'number', value: 1 } } } };
    await expect(s.preview(bad)).rejects.toThrow(/Expected a number on the left in the formula, got text/);
    await expect(s.apply({ kind: 'calculated_column', params: { into: 'bad', expression: { kind: 'datePart', part: 'year', value: { kind: 'column', name: 'name' } } } })).rejects.toThrow(/Expected a date/);
  });
  test('column names and text literals can never become SQL', async () => {
    const tricky = 'a"; DROP TABLE x; --';
    const s = await load(`"${tricky.replace(/"/g, '""')}",v\n1,2\n`);
    const spec: OperationSpec = {
      kind: 'calculated_column',
      params: { into: 'calc', expression: { kind: 'binary', op: 'concat', left: { kind: 'column', name: tricky }, right: { kind: 'text', value: "'; DROP TABLE source; --" } } },
    };
    await s.apply(spec);
    expect(await col(s, 2)).toEqual([`1'; DROP TABLE source; --`]);
    // the source table is still there and the session still works
    expect((await s.page({ offset: 0, limit: 5 })).total).toBe(1);
    const calc = compileCalc({ kind: 'number', value: 1 }, schema);
    expect(calc.sql).toContain('CAST(1 AS DOUBLE)');
    expect(isCalcNode({ kind: 'number', value: 1e999 })).toBe(false);
    expect(isCalcNode({ kind: 'text', value: 'x', evil: 'DROP' })).toBe(true); // extra keys are ignored, but never compiled
  });
  test('recipe validation rejects non-AST expressions', () => {
    const bad = (expression: unknown) => JSON.stringify({ format: 'tidyfold-recipe', version: 1, operations: [{ kind: 'calculated_column', params: { into: 'x', expression } }] });
    expect(() => parseRecipe(bad({ kind: 'rawSql', sql: 'DROP TABLE x' }))).toThrow(/valid formula/);
    expect(() => parseRecipe(bad({ kind: 'binary', op: 'add', left: { kind: 'number', value: 1 }, right: { kind: 'number', value: NaN } }))).toThrow(/valid formula/);
  });
});

describe('filter_rows', () => {
  const CSV = 'city,n,day\na,1,2024-01-01\nb,2,2024-01-02\nc,10,2024-01-03\n';
  test('all/any and keep non-matching', async () => {
    const s = await load(CSV);
    const spec: OperationSpec = {
      kind: 'filter_rows',
      params: { match: 'all', keep: 'matching', conditions: [{ column: 'n', op: 'greater', value: '1' }, { column: 'city', op: 'notEquals', value: 'c' }] },
    };
    const pv = await s.preview(spec);
    expect(pv.removedCount).toBe(2);
    expect(pv.removedRows[0]!.values).toEqual(['a', '1', '2024-01-01']);
    await s.apply(spec);
    expect(await col(s)).toEqual(['b']);
    await s.undo();
    await s.apply({
      kind: 'filter_rows',
      params: {
        match: 'any',
        keep: 'non-matching',
        conditions: [{ column: 'city', op: 'equals', value: 'a' }, { column: 'city', op: 'equals', value: 'b' }],
      },
    });
    expect(await col(s)).toEqual(['c']);
  });
  test('contains, startsWith, empties and between dates', async () => {
    const s = await load('v\nAlpha\nbeta\n\nGamma\n');
    const spec = (op: string, value?: string) => ({ kind: 'filter_rows', params: { match: 'all', keep: 'matching', conditions: [{ column: 'v', op, ...(value !== undefined ? { value } : {}) }] } }) as OperationSpec;
    await s.apply(spec('startsWith', 'A'));
    expect(await col(s)).toEqual(['Alpha']);
    await s.undo();
    await s.apply(spec('contains', 'a'));
    expect(await col(s)).toEqual(['Alpha', 'beta', 'Gamma']);
    await s.undo();
    await s.apply(spec('isNotEmpty'));
    expect(await col(s)).toEqual(['Alpha', 'beta', 'Gamma']);

    const d = await load(CSV);
    await d.apply({ kind: 'filter_rows', params: { match: 'all', keep: 'matching', conditions: [{ column: 'day', op: 'between', value: '2024-01-02', value2: '2024-01-03' }] } });
    expect(await col(d)).toEqual(['b', 'c']);
  });
  test('validation and recorded-step description', async () => {
    const s = await load(CSV);
    expect(describeOperation({ kind: 'filter_rows', params: { conditions: [{ column: 'n', op: 'greater', value: '5' }], match: 'all', keep: 'matching' } })).toMatch(/Keep rows/);
    await expect(s.apply({ kind: 'filter_rows', params: { conditions: [], match: 'all', keep: 'matching' } })).rejects.toThrow(/at least one condition/);
    await expect(s.apply({ kind: 'filter_rows', params: { conditions: [{ column: 'n', op: 'greater', value: 'abc' }], match: 'all', keep: 'matching' } })).rejects.toThrow(/isn't a valid/);
    await expect(s.apply({ kind: 'filter_rows', params: { conditions: [{ column: 'n', op: 'greater', value: '' }], match: 'all', keep: 'matching' } })).rejects.toThrow(/Enter a value/);
    await expect(s.apply({ kind: 'filter_rows', params: { conditions: [{ column: 'city', op: 'greater', value: 'a' }], match: 'all', keep: 'matching' } })).rejects.toThrow(/works with numbers and dates/);
  });
});

describe('group_aggregate', () => {
  const CSV = 'city,amount,code\nB,10,x\nA,5,y\nB,7,z\nA,2,w\n';
  const GROUP: OperationSpec = {
    kind: 'group_aggregate',
    params: {
      by: ['city'],
      aggregations: [
        { fn: 'count', as: 'orders' },
        { fn: 'sum', column: 'amount', as: 'total' },
        { fn: 'max', column: 'amount', as: 'biggest' },
        { fn: 'first', column: 'code', as: 'first_code' },
      ],
    },
  };
  test('groups correctly with a fresh __row in first-occurrence order', async () => {
    const s = await load(CSV);
    const pv = await s.preview(GROUP);
    expect(pv.reshaped).toBe(true);
    expect(pv.rowsBefore).toBe(4);
    expect(pv.rowsAfter).toBe(2);
    expect(pv.resultRows).toEqual([
      { values: ['B', '2', '17', '10', 'x'] },
      { values: ['A', '2', '7', '5', 'y'] },
    ]);
    expect(pv.addedColumns.map((c) => c.name)).toEqual(['orders', 'total', 'biggest', 'first_code']);
    expect(pv.samples).toEqual([]); // no by-__row cell diff
    await s.apply(GROUP);
    expect((await page(s)).rows).toEqual(pv.resultRows!.map((r) => r.values));
    expect((await page(s)).rowIds).toEqual([1, 2]); // fresh __row, starting at 1
  });
  test('no group keys produces a single total; empty groups and validation', async () => {
    const s = await load(CSV);
    await s.apply({ kind: 'group_aggregate', params: { by: [], aggregations: [{ fn: 'count_distinct', column: 'city', as: 'cities' }, { fn: 'avg', column: 'amount', as: 'mean' }] } });
    expect((await page(s)).rows).toEqual([['2', '6.0']]);
    const v = await load(CSV);
    await expect(v.apply({ kind: 'group_aggregate', params: { by: ['city'], aggregations: [] } })).rejects.toThrow(/at least one summary/);
    await expect(v.apply({ kind: 'group_aggregate', params: { by: ['nope'], aggregations: [{ fn: 'count', as: 'n' }] } })).rejects.toThrow(/doesn't exist/);
    await expect(v.apply({ kind: 'group_aggregate', params: { by: ['city'], aggregations: [{ fn: 'count', as: 'city' }] } })).rejects.toThrow(/already exists/);
    await expect(v.apply({ kind: 'group_aggregate', params: { by: ['city'], aggregations: [{ fn: 'sum', column: 'city', as: 's' }] } })).rejects.toThrow(/needs a number column/);
    await expect(v.apply({ kind: 'group_aggregate', params: { by: ['city'], aggregations: [{ fn: 'median', as: 'm' }] } } as unknown as OperationSpec)).rejects.toThrow(/Unknown summary/);
  });
  test('undo / redo / remove across a group step', async () => {
    const s = await load(CSV);
    await s.apply(GROUP);
    await s.apply({ kind: 'calculated_column', params: { into: 'double', expression: { kind: 'binary', op: 'multiply', left: { kind: 'column', name: 'total' }, right: { kind: 'number', value: 2 } } } });
    expect((await page(s)).rows[0]![5]).toBe('34.0');
    await s.undo();
    expect(s.schema.some((c) => c.name === 'double')).toBe(false);
    await s.redo();
    expect((await page(s)).rows[0]![5]).toBe('34.0');
    // removing the group step is blocked while a later step depends on its output
    expect((await s.remove(s.history.ops[0]!.id)).blockedBy).not.toBeNull();
    expect(s.history.ops.length).toBe(2);
    expect((await s.remove(s.history.ops[1]!.id)).blockedBy).toBeNull();
    expect((await s.remove(s.history.ops[0]!.id)).blockedBy).toBeNull();
    expect(s.history.ops.length).toBe(0);
    expect((await page(s)).rows.length).toBe(4);
  });
});

describe('reorder_columns and existing Transform tools', () => {
  test('reorder, rename, remove and convert type are recorded steps', async () => {
    const s = await load('a,b,c\n1,2,3\n');
    const pv = await s.preview({ kind: 'reorder_columns', params: { order: ['c', 'a', 'b'] } });
    expect(pv.reordered).toBe(true);
    expect(pv.notes.some((n) => /Only the column order/.test(n.text))).toBe(true);
    await s.apply({ kind: 'reorder_columns', params: { order: ['c', 'a', 'b'] } });
    expect(s.schema.map((c) => c.name)).toEqual(['c', 'a', 'b']);
    await s.apply({ kind: 'rename_column', params: { column: 'c', to: 'first' } });
    await s.apply({ kind: 'remove_column', params: { column: 'b' } });
    await s.apply({ kind: 'change_type', params: { column: 'a', to: 'text' } });
    expect(s.schema.map((c) => [c.name, c.type])).toEqual([['first', 'integer'], ['a', 'text']]);
    expect((await page(s)).rows).toEqual([['3', '1']]);
    await s.undo();
    expect(s.schema[1]!.type).toBe('integer');
    await expect(s.apply({ kind: 'reorder_columns', params: { order: ['a'] } })).rejects.toThrow(/exactly once/);
  });
});

describe('recipes with phase-4 operations', () => {
  const SPECS: OperationSpec[] = [
    SPLIT,
    { kind: 'merge_columns', params: { columns: ['name_1', 'name_2'], separator: ':', into: 'joined', skipEmpty: true, keepOriginals: true } },
    { kind: 'extract_text', params: { column: 'joined', mode: 'before', start: ':', into: 'head', matchCase: true } },
    { kind: 'calculated_column', params: { into: 'upper_name', expression: { kind: 'upper', value: { kind: 'column', name: 'name_2' } } } },
    { kind: 'filter_rows', params: { conditions: [{ column: 'head', op: 'isEmpty' }], match: 'all', keep: 'non-matching' } },
    { kind: 'group_aggregate', params: { by: ['head'], aggregations: [{ fn: 'count', as: 'n' }] } },
    { kind: 'reorder_columns', params: { order: ['n', 'head'] } },
  ];
  test('round-trips every new kind and replays on a fresh session', async () => {
    const csv = 'name\n"A|B"\nC\n"D|E"\n';
    const s = await load(csv);
    for (const spec of SPECS) {
      // each spec must at least compile at this step
      await s.apply(spec);
    }
    const recipe = toRecipe(s.history.ops, 'phase 4');
    const parsed = parseRecipe(JSON.stringify(recipe));
    expect(parsed.operations).toEqual(SPECS);
    const fresh = await load(csv);
    expect((await fresh.replay(recipeToOperations(parsed))).failed).toBeNull();
    expect((await page(fresh)).rows).toEqual((await page(s)).rows);
  });
  test('rejects invalid recipes for the new kinds', () => {
    const bad = (op: object) => JSON.stringify({ format: 'tidyfold-recipe', version: 1, operations: [op] });
    expect(() => parseRecipe(bad({ kind: 'split_column', params: { column: 'a', by: 'sideways', maxParts: 2 } }))).toThrow(/can't be "sideways"/);
    expect(() => parseRecipe(bad({ kind: 'merge_columns', params: { columns: ['a', 'b'], separator: '-' } }))).toThrow(/"into" must be text/);
    expect(() => parseRecipe(bad({ kind: 'extract_text', params: { column: 'a', mode: 'sideways', into: 'b' } }))).toThrow(/can't be "sideways"/);
    expect(() => parseRecipe(bad({ kind: 'filter_rows', params: { conditions: [{ column: 'a', op: 'like' }], match: 'all', keep: 'matching' } }))).toThrow(/unknown comparison/);
    expect(() => parseRecipe(bad({ kind: 'group_aggregate', params: { by: [], aggregations: [{ fn: 'median', as: 'm' }] } }))).toThrow(/unknown function/);
    expect(() => parseRecipe(bad({ kind: 'reorder_columns', params: { order: 'abc' } }))).toThrow(/"order" must be a list/);
  });
});
