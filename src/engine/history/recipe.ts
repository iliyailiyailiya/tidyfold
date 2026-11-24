import { createOperation, OPERATION_KINDS, type Operation, type OperationSpec } from './operations';
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
    case 'change_type': {
      const to = str('to') as ColumnType;
      if (!TYPES.has(to)) throw new RecipeError(`${where}: unknown type "${to}".`);
      return { kind, params: { column: str('column'), to } };
    }
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
