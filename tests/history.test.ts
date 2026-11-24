import { describe, expect, test } from 'vitest';
import * as H from '../src/engine/history/history';
import { createOperation, describeOperation, compileOperation, OperationError } from '../src/engine/history/operations';
import { parseRecipe, recipeToOperations, toRecipe, RecipeError } from '../src/engine/history/recipe';

const op = (column: string) => createOperation({ kind: 'remove_column', params: { column } });

describe('history state machine', () => {
  test('push / undo / redo', () => {
    const a = op('a'), b = op('b');
    let h = H.push(H.push(H.emptyHistory, a), b);
    expect(H.applied(h)).toEqual([a, b]);
    h = H.undo(h);
    expect(H.applied(h)).toEqual([a]);
    expect(H.canRedo(h)).toBe(true);
    h = H.redo(h);
    expect(H.applied(h)).toEqual([a, b]);
    expect(H.redo(h)).toBe(h); // no-op returns same state
  });

  test('push after undo discards the redo branch', () => {
    const a = op('a'), b = op('b'), c = op('c');
    let h = H.push(H.push(H.emptyHistory, a), b);
    h = H.push(H.undo(h), c);
    expect(h.ops).toEqual([a, c]);
    expect(H.canRedo(h)).toBe(false);
  });

  test('undo at start is a no-op', () => expect(H.undo(H.emptyHistory)).toBe(H.emptyHistory));

  test('remove before cursor shifts cursor and reports dirty index', () => {
    const a = op('a'), b = op('b'), c = op('c');
    const h = H.replaceAll([a, b, c]);
    const { state, firstDirtyStep } = H.remove(h, b.id);
    expect(state.ops).toEqual([a, c]);
    expect(state.cursor).toBe(2);
    expect(firstDirtyStep).toBe(1);
  });

  test('remove in redo branch keeps cursor', () => {
    const a = op('a'), b = op('b');
    const h = H.undo(H.replaceAll([a, b]));
    const { state } = H.remove(h, b.id);
    expect(state).toEqual({ ops: [a], cursor: 1 });
  });

  test('jumpTo clamps', () => {
    const h = H.replaceAll([op('a'), op('b')]);
    expect(H.jumpTo(h, 0).cursor).toBe(0);
    expect(H.jumpTo(h, 99).cursor).toBe(2);
  });

  test('states are immutable', () => {
    const h = H.replaceAll([op('a')]);
    const frozen = JSON.stringify(h);
    H.push(h, op('b'));
    H.undo(h);
    H.remove(h, h.ops[0]!.id);
    expect(JSON.stringify(h)).toBe(frozen);
  });
});

describe('operations', () => {
  const schema = [
    { name: 'name', type: 'text' as const },
    { name: 'age', type: 'integer' as const },
  ];
  test('human-readable descriptions', () => {
    expect(describeOperation({ kind: 'rename_column', params: { column: 'name', to: ' Full name ' } })).toBe('Rename “name” to “Full name”');
    expect(describeOperation({ kind: 'remove_duplicates', params: { columns: [] } })).toBe('Remove duplicate rows');
    expect(describeOperation({ kind: 'trim_whitespace', params: { columns: ['a', 'b'] } })).toBe('Trim whitespace in 2 columns');
  });
  test('rename updates schema and quotes identifiers', () => {
    const c = compileOperation({ kind: 'rename_column', params: { column: 'name', to: 'he said "hi"' } }, schema, 'in');
    expect(c.schema.map((s) => s.name)).toEqual(['he said "hi"', 'age']);
    expect(c.sql).toContain('"he said ""hi"""');
  });
  test.each([
    [{ kind: 'rename_column', params: { column: 'nope', to: 'x' } }, /doesn't exist/],
    [{ kind: 'rename_column', params: { column: 'name', to: 'AGE' } }, /already exists/],
    [{ kind: 'rename_column', params: { column: 'name', to: '  ' } }, /empty/],
    [{ kind: 'trim_whitespace', params: { columns: ['age'] } }, /isn't a text column/],
    [{ kind: 'change_case', params: { column: 'age', mode: 'upper' } }, /isn't a text column/],
  ] as const)('rejects invalid %#', (spec, msg) => {
    expect(() => compileOperation(spec as never, schema, 'in')).toThrow(OperationError);
    expect(() => compileOperation(spec as never, schema, 'in')).toThrow(msg);
  });
  test('cannot remove the last column', () => {
    expect(() => compileOperation({ kind: 'remove_column', params: { column: 'a' } }, [{ name: 'a', type: 'text' }], 'in')).toThrow(/last column/);
  });
});

describe('recipes', () => {
  test('round trip strips ids and timestamps', () => {
    const ops = [
      createOperation({ kind: 'trim_whitespace', params: { columns: ['city'] } }),
      createOperation({ kind: 'rename_column', params: { column: 'city', to: 'City' } }),
    ];
    const json = JSON.stringify(toRecipe(ops, 'My recipe'));
    expect(json).not.toContain('op_');
    const back = parseRecipe(json);
    expect(back.name).toBe('My recipe');
    expect(back.operations).toEqual([
      { kind: 'trim_whitespace', params: { columns: ['city'], collapseInner: false } },
      { kind: 'rename_column', params: { column: 'city', to: 'City' } },
    ]);
    const fresh = recipeToOperations(back);
    expect(fresh[0]!.id).not.toBe(ops[0]!.id);
  });
  test.each([
    ['not json', /not JSON/],
    ['{"format":"other"}', /isn't a Tidyfold recipe/],
    ['{"format":"tidyfold-recipe","version":99,"operations":[]}', /newer/],
    ['{"format":"tidyfold-recipe","version":1,"operations":[{"kind":"rm_rf","params":{}}]}', /unknown operation/],
    ['{"format":"tidyfold-recipe","version":1,"operations":[{"kind":"remove_column","params":{"column":5}}]}', /must be text/],
    ['{"format":"tidyfold-recipe","version":1,"operations":[{"kind":"change_case","params":{"column":"a","mode":"sarcastic"}}]}', /unknown case/],
  ])('rejects %s', (json, msg) => {
    expect(() => parseRecipe(json)).toThrow(RecipeError);
    expect(() => parseRecipe(json)).toThrow(msg);
  });
});
