import { createOperation, OPERATION_KINDS, type Aggregation, type FilterCondition, type Operation, type OperationSpec } from './operations';
import { isCalcNode } from './expression';
import type { ColumnType } from '../import/types';

export const RECIPE_FORMAT = 'tidyfold-recipe';
export const RECIPE_VERSION = 1;

export interface Recipe {
  format: typeof RECIPE_FORMAT;
  version: number;
  name: string;
  createdAt: string;
  operations: OperationSpec[];
}

const KINDS = new Set<string>(OPERATION_KINDS);
const TYPES = new Set<ColumnType>(['text', 'integer', 'decimal', 'boolean', 'date', 'timestamp']);

export function toRecipe(ops: readonly Operation[], name: string, now = new Date()): Recipe {
  return {
    format: RECIPE_FORMAT,
    version: RECIPE_VERSION,
    name,
    createdAt: now.toISOString(),
    // strip ids/timestamps: a recipe is portable intent, not a log
    operations: ops.map(({ kind, params }) => ({ kind, params }) as OperationSpec),
  };
}

export class RecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeError';
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validateSpec(raw: unknown, i: number): OperationSpec {
  const where = `Step ${i + 1}`;
  if (!raw || typeof raw !== 'object') throw new RecipeError(`${where} is not an object.`);
  const { kind, params } = raw as { kind?: unknown; params?: unknown };
  if (typeof kind !== 'string' || !KINDS.has(kind)) throw new RecipeError(`${where}: unknown operation "${String(kind)}".`);
  if (!params || typeof params !== 'object') throw new RecipeError(`${where}: missing parameters.`);
  const p = params as Record<string, unknown>;
  const str = (k: string) => {
    if (typeof p[k] !== 'string') throw new RecipeError(`${where}: "${k}" must be text.`);
    return p[k] as string;
  };
  const strs = (k: string) => {
    if (!isStringArray(p[k])) throw new RecipeError(`${where}: "${k}" must be a list of column names.`);
    return p[k] as string[];
  };
  const oneOf = <T extends string>(k: string, allowed: readonly T[]): T => {
    const v = str(k);
    if (!(allowed as readonly string[]).includes(v)) throw new RecipeError(`${where}: "${k}" can't be "${v}".`);
    return v as T;
  };
  const bool = (k: string, fallback: boolean) => {
    if (p[k] === undefined) return fallback;
    if (typeof p[k] !== 'boolean') throw new RecipeError(`${where}: "${k}" must be true or false.`);
    return p[k] as boolean;
  };
  const maybeStr = (k: string) => {
    if (p[k] === undefined) return undefined;
    if (typeof p[k] !== 'string') throw new RecipeError(`${where}: "${k}" must be text.`);
    return p[k] as string;
  };
  const integer = (k: string) => {
    if (typeof p[k] !== 'number' || !Number.isInteger(p[k])) throw new RecipeError(`${where}: "${k}" must be a whole number.`);
    return p[k] as number;
  };
  switch (kind) {
    case 'rename_column':
      return { kind, params: { column: str('column'), to: str('to') } };
    case 'remove_column':
      return { kind, params: { column: str('column') } };
    case 'trim_whitespace':
      return { kind, params: { columns: strs('columns'), collapseInner: bool('collapseInner', false) } };
    case 'change_case': {
      const mode = str('mode');
      if (mode !== 'lower' && mode !== 'upper' && mode !== 'title') throw new RecipeError(`${where}: unknown case "${mode}".`);
      return { kind, params: { column: str('column'), mode } };
    }
    case 'remove_duplicates':
      return { kind, params: { columns: strs('columns') } };
    case 'replace_values':
      return {
        kind,
        params: { column: str('column'), find: str('find'), replace: str('replace'), match: oneOf('match', ['exact', 'contains'] as const), matchCase: bool('matchCase', false) },
      };
    case 'fill_missing': {
      const mode = oneOf('mode', ['value', 'down', 'up'] as const);
      return { kind, params: { column: str('column'), mode, ...(mode === 'value' ? { value: str('value') } : {}) } };
    }
    case 'standardize_dates':
      return { kind, params: { column: str('column'), order: oneOf('order', ['DMY', 'MDY', 'YMD'] as const) } };
    case 'normalize_numbers':
      return { kind, params: { column: str('column'), decimal: oneOf('decimal', ['.', ','] as const) } };
    case 'merge_values': {
      const raw = p.merges;
      if (!Array.isArray(raw)) throw new RecipeError(`${where}: "merges" must be a list.`);
      const merges = raw.map((m, i) => {
        const mm = m as { from?: unknown; to?: unknown };
        if (!mm || !isStringArray(mm.from) || typeof mm.to !== 'string') throw new RecipeError(`${where}: merge group ${i + 1} needs "from" (list) and "to" (text).`);
        return { from: mm.from, to: mm.to };
      });
      return { kind, params: { column: str('column'), merges } };
    }
    case 'change_type': {
      const to = str('to') as ColumnType;
      if (!TYPES.has(to)) throw new RecipeError(`${where}: unknown type "${to}".`);
      return { kind, params: { column: str('column'), to } };
    }
    case 'split_column': {
      const positions = p.positions === undefined ? undefined : (() => {
        if (!Array.isArray(p.positions) || !p.positions.every((x) => typeof x === 'number' && Number.isInteger(x))) {
          throw new RecipeError(`${where}: "positions" must be a list of whole numbers.`);
        }
        return p.positions as number[];
      })();
      return {
        kind,
        params: {
          column: str('column'),
          by: oneOf('by', ['delimiter', 'position'] as const),
          delimiter: maybeStr('delimiter'),
          positions,
          maxParts: integer('maxParts'),
          names: p.names === undefined ? undefined : strs('names'),
          keepOriginal: bool('keepOriginal', false),
        },
      };
    }
    case 'merge_columns':
      return {
        kind,
        params: { columns: strs('columns'), separator: str('separator'), into: str('into'), skipEmpty: bool('skipEmpty', true), keepOriginals: bool('keepOriginals', true) },
      };
    case 'extract_text':
      return {
        kind,
        params: {
          column: str('column'),
          mode: oneOf('mode', ['regex', 'before', 'after', 'between'] as const),
          pattern: maybeStr('pattern'),
          start: maybeStr('start'),
          end: maybeStr('end'),
          into: str('into'),
          matchCase: bool('matchCase', false),
        },
      };
    case 'calculated_column': {
      const expression = p.expression;
      if (!isCalcNode(expression)) throw new RecipeError(`${where}: "expression" isn't a valid formula.`);
      return { kind, params: { into: str('into'), expression } };
    }
    case 'filter_rows': {
      const raw = p.conditions;
      if (!Array.isArray(raw)) throw new RecipeError(`${where}: "conditions" must be a list.`);
      const conditions: FilterCondition[] = raw.map((c, i) => {
        const cc = c as Record<string, unknown>;
        if (!cc || typeof cc !== 'object') throw new RecipeError(`${where}: condition ${i + 1} isn't an object.`);
        const value = cc.value;
        const value2 = cc.value2;
        if (typeof cc.column !== 'string') throw new RecipeError(`${where}: condition ${i + 1} needs a "column".`);
        if (typeof cc.op !== 'string' || !['equals', 'notEquals', 'contains', 'startsWith', 'isEmpty', 'isNotEmpty', 'greater', 'less', 'between'].includes(cc.op)) {
          throw new RecipeError(`${where}: condition ${i + 1} has an unknown comparison.`);
        }
        if (value !== undefined && typeof value !== 'string') throw new RecipeError(`${where}: condition ${i + 1} "value" must be text.`);
        if (value2 !== undefined && typeof value2 !== 'string') throw new RecipeError(`${where}: condition ${i + 1} "value2" must be text.`);
        return { column: cc.column, op: cc.op as FilterCondition['op'], ...(value !== undefined ? { value } : {}), ...(value2 !== undefined ? { value2 } : {}) };
      });
      return { kind, params: { conditions, match: oneOf('match', ['all', 'any'] as const), keep: oneOf('keep', ['matching', 'non-matching'] as const) } };
    }
    case 'group_aggregate': {
      const raw = p.aggregations;
      if (!Array.isArray(raw)) throw new RecipeError(`${where}: "aggregations" must be a list.`);
      const aggregations: Aggregation[] = raw.map((a, i) => {
        const aa = a as Record<string, unknown>;
        if (!aa || typeof aa !== 'object') throw new RecipeError(`${where}: summary ${i + 1} isn't an object.`);
        if (typeof aa.fn !== 'string' || !['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'first'].includes(aa.fn)) {
          throw new RecipeError(`${where}: summary ${i + 1} has an unknown function.`);
        }
        if (typeof aa.as !== 'string') throw new RecipeError(`${where}: summary ${i + 1} needs an "as" name.`);
        const column = aa.column;
        if (column !== undefined && typeof column !== 'string') throw new RecipeError(`${where}: summary ${i + 1} "column" must be text.`);
        return { ...(column !== undefined ? { column } : {}), fn: aa.fn as Aggregation['fn'], as: aa.as };
      });
      return { kind, params: { by: strs('by'), aggregations } };
    }
    case 'reorder_columns':
      return { kind, params: { order: strs('order') } };
  }
  throw new RecipeError(`${where}: unknown operation.`);
}

export function parseRecipe(json: string): Recipe {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new RecipeError("This isn't a valid recipe file (not JSON).");
  }
  const d = data as Partial<Recipe> | null;
  if (!d || d.format !== RECIPE_FORMAT) throw new RecipeError("This isn't a Tidyfold recipe.");
  if (typeof d.version !== 'number' || d.version > RECIPE_VERSION) {
    throw new RecipeError(`Recipe version ${String(d.version)} is newer than this app supports.`);
  }
  if (!Array.isArray(d.operations)) throw new RecipeError('Recipe has no operations list.');
  return {
    format: RECIPE_FORMAT,
    version: d.version,
    name: typeof d.name === 'string' ? d.name : 'Untitled recipe',
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
    operations: d.operations.map(validateSpec),
  };
}

export function recipeToOperations(recipe: Recipe): Operation[] {
  return recipe.operations.map((s) => createOperation(s));
}
