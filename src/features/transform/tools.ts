import { Combine, Filter, Group, Hash, Info, Regex, Replace, Scissors, Shapes, TableProperties, Trash2, Type, ArrowLeftRight, WandSparkles } from 'lucide-react';
import { autoName, type ColumnSchema, type OperationSpec } from '@/engine/history/operations';
import type { CalcNode } from '@/engine/history/expression';
import type { DatasetProfile } from '@/engine/dataset/profile';

export type TransformToolId = 'split' | 'merge' | 'extract' | 'calculate' | 'filter' | 'group' | 'reorder' | 'rename' | 'remove' | 'type';

export interface TransformToolDef {
  id: TransformToolId;
  kind: OperationSpec['kind'];
  label: string;
  blurb: string;
  group: 'Columns' | 'Rows';
  icon: typeof Scissors;
  accepts: (c: ColumnSchema) => boolean;
  initial: (schema: ColumnSchema[], profile: DatasetProfile | null) => OperationSpec;
}

const isText = (c: ColumnSchema) => c.type === 'text';
const first = (schema: ColumnSchema[], accepts: (c: ColumnSchema) => boolean) => schema.find(accepts)?.name ?? schema[0]?.name ?? '';

export const TRANSFORM_TOOLS: TransformToolDef[] = [
  {
    id: 'split',
    kind: 'split_column',
    label: 'Split a column',
    blurb: 'Turn “city, country” into two columns.',
    group: 'Columns',
    icon: Scissors,
    accepts: isText,
    initial: (schema) => ({
      kind: 'split_column',
      params: { column: first(schema, isText), by: 'delimiter', delimiter: '', maxParts: 2, keepOriginal: true },
    }),
  },
  {
    id: 'merge',
    kind: 'merge_columns',
    label: 'Join columns',
    blurb: 'Combine columns with a separator you choose.',
    group: 'Columns',
    icon: Combine,
    accepts: () => true,
    initial: (schema) => ({
      kind: 'merge_columns',
      params: { columns: [], separator: ' ', into: autoName(schema, 'joined'), skipEmpty: true, keepOriginals: true },
    }),
  },
  {
    id: 'extract',
    kind: 'extract_text',
    label: 'Extract text',
    blurb: 'Pull out a code, a name or a pattern.',
    group: 'Columns',
    icon: Regex,
    accepts: isText,
    initial: (schema) => ({
      kind: 'extract_text',
      params: { column: first(schema, isText), mode: 'regex', pattern: '', into: autoName(schema, 'extracted'), matchCase: false },
    }),
  },
  {
    id: 'calculate',
    kind: 'calculated_column',
    label: 'Calculate a column',
    blurb: 'Build a formula step by step, with no code.',
    group: 'Columns',
    icon: WandSparkles,
    accepts: () => true,
    initial: (schema) => {
      const source = first(schema, (c) => c.type === 'integer' || c.type === 'decimal') || first(schema, () => true);
      const expression: CalcNode = source ? { kind: 'column', name: source } : { kind: 'number', value: 0 };
      return { kind: 'calculated_column', params: { into: autoName(schema, 'calculated'), expression } };
    },
  },
  {
    id: 'rename',
    kind: 'rename_column',
    label: 'Rename column',
    blurb: 'Give a column a clearer name.',
    group: 'Columns',
    icon: Type,
    accepts: () => true,
    initial: (schema) => {
      const column = first(schema, () => true);
      return { kind: 'rename_column', params: { column, to: column ? autoName(schema, `${column}_new`) : '' } };
    },
  },
  {
    id: 'remove',
    kind: 'remove_column',
    label: 'Remove column',
    blurb: 'Drop a column from this step onward.',
    group: 'Columns',
    icon: Trash2,
    accepts: () => true,
    initial: (schema) => ({ kind: 'remove_column', params: { column: first(schema, () => true) } }),
  },
  {
    id: 'type',
    kind: 'change_type',
    label: 'Convert type',
    blurb: 'Turn text into numbers, dates or true/false.',
    group: 'Columns',
    icon: Shapes,
    accepts: () => true,
    initial: (schema) => {
      const column = first(schema, () => true);
      const from = schema.find((c) => c.name === column)?.type ?? 'text';
      return { kind: 'change_type', params: { column, to: from === 'text' ? 'decimal' : 'text' } };
    },
  },
  {
    id: 'reorder',
    kind: 'reorder_columns',
    label: 'Reorder columns',
    blurb: 'Move columns left or right.',
    group: 'Columns',
    icon: ArrowLeftRight,
    accepts: () => true,
    initial: (schema) => ({ kind: 'reorder_columns', params: { order: schema.map((c) => c.name) } }),
  },
  {
    id: 'filter',
    kind: 'filter_rows',
    label: 'Filter rows',
    blurb: 'Keep or remove rows that match conditions.',
    group: 'Rows',
    icon: Filter,
    accepts: () => true,
    initial: () => ({ kind: 'filter_rows', params: { conditions: [], match: 'all', keep: 'matching' } }),
  },
  {
    id: 'group',
    kind: 'group_aggregate',
    label: 'Group & summarise',
    blurb: 'Totals and counts per group. Replaces the rows.',
    group: 'Rows',
    icon: Group,
    accepts: () => true,
    initial: (schema) => ({
      kind: 'group_aggregate',
      params: { by: [], aggregations: [{ fn: 'count', as: autoName(schema, 'count') }] },
    }),
  },
];

export const toolForKind = (kind: OperationSpec['kind']) => TRANSFORM_TOOLS.find((t) => t.kind === kind);

/** The column a tool targets (for multi-column ops: the first). */
export function targetColumn(spec: OperationSpec): string | null {
  const p = spec.params as { column?: string; columns?: string[] };
  return p.column ?? p.columns?.[0] ?? null;
}

/** Friendly icons for the operation descriptions used in history. */
export const KIND_ICON = { calculated_column: Hash, merge_columns: Replace, change_type: Info, reorder_columns: TableProperties } as const;
