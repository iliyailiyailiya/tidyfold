import { beforeAll, describe, expect, test } from 'vitest';
import { createNodeDb } from './helpers/nodeDb';
import type { Db } from '../src/engine/duckdb/types';
import { DatasetSession } from '../src/engine/dataset/session';
import { analyze, runImport } from '../src/engine/import/pipeline';
import { parseRecipe, recipeToOperations, toRecipe } from '../src/engine/history/recipe';
import { describeOperation, type OperationSpec } from '../src/engine/history/operations';

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

const BULK = (params: Record<string, unknown>): OperationSpec =>
  ({ kind: 'bulk_edit', params: { columns: [], action: { kind: 'trim' }, conditions: [], match: 'all', ...params } }) as OperationSpec;

describe('bulk_edit: text actions across columns', () => {
  const CSV = 'first,last,city,n\n"  Ana  ","Popescu ","berlin",1\n"Bogdan ","  Ionescu","Berlin",2\n';

  test('trims many columns at once and leaves other columns alone', async () => {
    const s = await load(CSV);
    const spec = BULK({ columns: ['first', 'last', 'city'] });
    const pv = await s.preview(spec);
    expect(pv.changedCells).toBe(4); // Ana, Popescu, Ionescu, berlin
    expect(pv.columns.map((c) => [c.name, c.changed])).toEqual([
      ['first', 2],
      ['last', 2],
    ]);
    expect(pv.samples).toContainEqual({ rowId: 1, column: 'first', before: '  Ana  ', after: 'Ana' });
    await s.apply(spec);
    expect((await page(s)).rows).toEqual([
      ['Ana', 'Popescu', 'berlin', '1'],
      ['Bogdan', 'Ionescu', 'Berlin', '2'],
    ]);
  });

  test('collapses inner runs of spaces when asked', async () => {
    const s = await load('name\n  Ana   Maria  \n');
    await s.apply(BULK({ columns: ['name'], action: { kind: 'trim', collapseInner: true } }));
    expect(await col(s)).toEqual(['Ana Maria']);
  });

  test('changes case in every chosen column', async () => {
    const s = await load(CSV);
    await s.apply(BULK({ columns: ['first', 'city'], action: { kind: 'case', mode: 'upper' } }));
    expect(await col(s, 0)).toEqual(['  ANA  ', 'BOGDAN ']);
    expect(await col(s, 2)).toEqual(['BERLIN', 'BERLIN']);
    await s.undo();
    await s.apply(BULK({ columns: ['first', 'last'], action: { kind: 'case', mode: 'lower' } }));
    expect((await page(s)).rows[0]!.slice(0, 2)).toEqual(['  ana  ', 'popescu ']);
  });

  test('find & replace is plain text (not a pattern) and can ignore case', async () => {
    const s = await load('a,b\n"a.b","A.B"\n"axb","A-B"\n');
    await s.apply(BULK({ columns: ['a', 'b'], action: { kind: 'replace', find: '.', replace: '-', matchCase: true } }));
    expect((await page(s)).rows).toEqual([['a-b', 'A-B'], ['axb', 'A-B']]);
    await s.undo();
    await s.apply(BULK({ columns: ['a', 'b'], action: { kind: 'replace', find: 'a.b', replace: 'yes', matchCase: false } }));
    expect((await page(s)).rows).toEqual([['yes', 'yes'], ['axb', 'A-B']]);
  });

  test('regex replacement supports capture groups and is validated before SQL', async () => {
    const s = await load('email,backup\nana@example.com,ANA@EXAMPLE.COM\nbob@example.com,bob@test.org\n');
    const spec = BULK({ columns: ['email', 'backup'], action: { kind: 'replace', find: '(\\w+)@example\\.com', replace: '\\1@new.test', matchCase: false, regex: true } });
    const pv = await s.preview(spec);
    expect(pv.notes.some((n) => /capture group/.test(n.text))).toBe(true);
    await s.apply(spec);
    expect((await page(s)).rows).toEqual([
      ['ana@new.test', 'ANA@new.test'],
      ['bob@new.test', 'bob@test.org'],
    ]);
    await expect(s.preview(BULK({ columns: ['email'], action: { kind: 'replace', find: '(?=x)', replace: 'y', matchCase: true, regex: true } }))).rejects.toThrow(/Look-ahead/);
    await expect(s.preview(BULK({ columns: ['email'], action: { kind: 'replace', find: '([a-z)', replace: 'y', matchCase: true, regex: true } }))).rejects.toThrow(/closing/);
  });

  test('adds text at the start or end, leaving empty cells empty', async () => {
    const s = await load('code,note\nAB-1,ok\n,x\n');
    await s.apply(BULK({ columns: ['code', 'note'], action: { kind: 'affix', where: 'start', text: '#' } }));
    expect((await page(s)).rows).toEqual([['#AB-1', '#ok'], ['', '#x']]);
    await s.undo();
    await s.apply(BULK({ columns: ['code', 'note'], action: { kind: 'affix', where: 'end', text: '!' } }));
    expect((await page(s)).rows).toEqual([['AB-1!', 'ok!'], ['', 'x!']]);
  });

  test('fills empty cells in many columns, including whitespace-only cells', async () => {
    const s = await load('name,note,city\nAna," ",Berlin\n,"x",\n');
    await s.apply(BULK({ columns: ['name', 'note', 'city'], action: { kind: 'fill_empty', value: 'unknown' } }));
    expect((await page(s)).rows).toEqual([
      ['Ana', 'unknown', 'Berlin'],
      ['unknown', 'x', 'unknown'],
    ]);
  });

  test('clears any column type and keeps the schema types', async () => {
    const s = await load('a,n,d,b\nx,1,2024-01-01,true\ny,2,2024-01-02,false\n');
    expect(s.schema.map((c) => c.type)).toEqual(['text', 'integer', 'date', 'boolean']);
    const pv = await s.preview(BULK({ columns: ['a', 'n', 'd', 'b'], action: { kind: 'clear' } }));
    expect(pv.changedCells).toBe(8);
    expect(pv.notes.some((n) => n.tone === 'warn' && /Clearing removes/.test(n.text))).toBe(true);
    await s.apply(BULK({ columns: ['a', 'n', 'd', 'b'], action: { kind: 'clear' } }));
    expect((await page(s)).rows).toEqual([
      [null, null, null, null],
      [null, null, null, null],
    ]);
    expect(s.schema.map((c) => c.type)).toEqual(['text', 'integer', 'date', 'boolean']);
  });
});

describe('bulk_edit: row conditions and history', () => {
  const CSV = 'name,city,n\nana,Berlin,1\nBOB,Berlin,2\nCara,Paris,3\n';

  test('edits only rows that match, and the preview says how many', async () => {
    const s = await load(CSV);
    const spec = BULK({ columns: ['name'], action: { kind: 'case', mode: 'upper' }, conditions: [{ column: 'city', op: 'equals', value: 'Berlin' }] });
    const pv = await s.preview(spec);
    expect(pv.changedCells).toBe(1); // “BOB” is already uppercase
    expect(pv.notes.some((n) => /2 rows of 3 rows match/.test(n.text))).toBe(true);
    await s.apply(spec);
    expect(await col(s)).toEqual(['ANA', 'BOB', 'Cara']);
  });

  test('any/all conditions combine like Filter rows', async () => {
    const s = await load(CSV);
    const base = { columns: ['name'], action: { kind: 'case', mode: 'upper' } } as const;
    await s.apply(BULK({
      ...base,
      match: 'any',
      conditions: [
        { column: 'city', op: 'equals', value: 'Berlin' },
        { column: 'n', op: 'greater', value: '2' },
      ],
    }));
    expect(await col(s)).toEqual(['ANA', 'BOB', 'CARA']);
    await s.undo();
    await s.apply(BULK({
      ...base,
      match: 'all',
      conditions: [
        { column: 'city', op: 'equals', value: 'Berlin' },
        { column: 'n', op: 'greater', value: '2' },
      ],
    }));
    expect(await col(s)).toEqual(['ana', 'BOB', 'Cara']);
  });

  test('is one undoable history step and replays from a recipe', async () => {
    const s = await load(CSV);
    await s.apply(BULK({ columns: ['name', 'city'], action: { kind: 'trim' } }));
    await s.apply(BULK({ columns: ['name'], action: { kind: 'case', mode: 'title' } }));
    expect(await col(s)).toEqual(['Ana', 'Bob', 'Cara']);
    await s.undo();
    expect(await col(s)).toEqual(['ana', 'BOB', 'Cara']);
    await s.redo();
    expect(await col(s)).toEqual(['Ana', 'Bob', 'Cara']);

    const recipe = toRecipe(s.history.ops, 'bulk');
    const parsed = parseRecipe(JSON.stringify(recipe));
    const fresh = await load(CSV);
    expect((await fresh.replay(recipeToOperations(parsed))).failed).toBeNull();
    expect((await page(fresh)).rows).toEqual((await page(s)).rows);
  });
});

describe('bulk_edit: validation and descriptions', () => {
  const CSV = 'a,b,n,d\nx,y,1,2024-01-01\n';

  test('rejects empty, duplicate and missing columns', async () => {
    const s = await load(CSV);
    await expect(s.preview(BULK({ columns: [] }))).rejects.toThrow(/at least one column/);
    await expect(s.preview(BULK({ columns: ['a', 'a'] }))).rejects.toThrow(/only once/);
    await expect(s.preview(BULK({ columns: ['nope'] }))).rejects.toThrow(/doesn't exist/);
  });

  test('text actions refuse non-text columns; clearing accepts them', async () => {
    const s = await load(CSV);
    await expect(s.preview(BULK({ columns: ['a', 'n'] }))).rejects.toThrow(/isn't a text column/);
    await expect(s.preview(BULK({ columns: ['n'], action: { kind: 'clear' } }))).resolves.toBeTruthy();
  });

  test('rejects empty action settings', async () => {
    const s = await load(CSV);
    await expect(s.preview(BULK({ columns: ['a'], action: { kind: 'replace', find: '', replace: 'y', matchCase: true } }))).rejects.toThrow(/Enter the text to find/);
    await expect(s.preview(BULK({ columns: ['a'], action: { kind: 'affix', where: 'start', text: '' } }))).rejects.toThrow(/Enter the text to add/);
    await expect(s.preview(BULK({ columns: ['a'], action: { kind: 'fill_empty', value: '  ' } }))).rejects.toThrow(/Enter a value/);
  });

  test('reversed between bounds are refused with a clear message', async () => {
    const s = await load(CSV);
    const conditions = [{ column: 'n', op: 'between' as const, value: '5', value2: '2' }];
    await expect(s.preview(BULK({ columns: ['a'], conditions }))).rejects.toThrow(/lower bound.*after the upper bound/);
    await expect(s.preview({ kind: 'filter_rows', params: { conditions, match: 'all', keep: 'matching' } })).rejects.toThrow(/lower bound.*after the upper bound/);
    await expect(s.preview(BULK({ columns: ['a'], conditions: [{ column: 'n', op: 'between', value: '1' }] }))).rejects.toThrow(/upper bound/);
  });

  test('describes the action and row scope in plain English', () => {
    expect(describeOperation(BULK({ columns: ['a', 'b'], action: { kind: 'trim' } }))).toBe('Bulk edit 2 columns: trim spaces');
    expect(describeOperation(BULK({ columns: ['a'], action: { kind: 'replace', find: 'x', replace: 'y', matchCase: false } }))).toBe('Bulk edit “a”: replace “x” with “y”');
    expect(describeOperation(BULK({ columns: ['a'], action: { kind: 'affix', where: 'start', text: '#' } }))).toBe('Bulk edit “a”: add “#” at the start');
    expect(describeOperation(BULK({ columns: ['a'], action: { kind: 'clear' }, conditions: [{ column: 'n', op: 'greater', value: '0' }] }))).toBe('Bulk edit “a”: clear the values, only in rows matching 1 condition');
  });
});

describe('bulk_edit: recipes', () => {
  test('round-trips every action', () => {
    const actions = [
      { kind: 'trim', collapseInner: true },
      { kind: 'case', mode: 'title' },
      { kind: 'replace', find: '(\\d+)', replace: '\\1!', matchCase: false, regex: true },
      { kind: 'affix', where: 'end', text: '!' },
      { kind: 'fill_empty', value: 'n/a' },
      { kind: 'clear' },
    ] as const;
    for (const action of actions) {
      const recipe = { format: 'tidyfold-recipe', version: 1, name: 'r', createdAt: '', operations: [BULK({ columns: ['a', 'b'], action })] };
      expect(parseRecipe(JSON.stringify(recipe)).operations).toEqual(recipe.operations);
    }
  });

  test('rejects malformed actions and conditions', () => {
    const bad = (params: unknown) => JSON.stringify({ format: 'tidyfold-recipe', version: 1, operations: [{ kind: 'bulk_edit', params }] });
    expect(() => parseRecipe(bad({ columns: ['a'], action: { kind: 'polish' }, match: 'all' }))).toThrow(/unknown bulk action/);
    expect(() => parseRecipe(bad({ columns: 'a', action: { kind: 'trim' }, match: 'all' }))).toThrow(/list of column names/);
    expect(() => parseRecipe(bad({ columns: ['a'], action: { kind: 'replace', find: 'x', replace: 'y', matchCase: 'yes' }, match: 'all' }))).toThrow(/true or false/);
    expect(() => parseRecipe(bad({ columns: ['a'], action: { kind: 'affix', where: 'side', text: 'x' }, match: 'all' }))).toThrow(/"start" or "end"/);
    expect(() => parseRecipe(bad({ columns: ['a'], action: { kind: 'trim' }, conditions: 'no', match: 'all' }))).toThrow(/"conditions" must be a list/);
  });
});
