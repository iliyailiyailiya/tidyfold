import { createOperation, type Operation, type OperationSpec } from './operations';

export const RECIPE_FORMAT = 'tidyfold-recipe';
export const RECIPE_VERSION = 1;

export interface Recipe {
  format: typeof RECIPE_FORMAT;
  version: number;
  name: string;
  createdAt: string;
  operations: OperationSpec[];
}

const KINDS = new Set(['rename_column', 'remove_column', 'trim_whitespace', 'change_case', 'remove_duplicates']);

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
  switch (kind) {
    case 'rename_column':
      return { kind, params: { column: str('column'), to: str('to') } };
    case 'remove_column':
      return { kind, params: { column: str('column') } };
    case 'trim_whitespace':
      return { kind, params: { columns: strs('columns') } };
    case 'change_case': {
      const mode = str('mode');
      if (mode !== 'lower' && mode !== 'upper') throw new RecipeError(`${where}: unknown case "${mode}".`);
      return { kind, params: { column: str('column'), mode } };
    }
    case 'remove_duplicates':
      return { kind, params: { columns: strs('columns') } };
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
