import { useEffect, useState } from 'react';
import { Combine, ArrowDownToLine, ArrowUpToLine, Baseline, CalendarCheck, CopyMinus, Hash, Replace, Scissors, Shapes, PaintBucket } from 'lucide-react';
import { Input, Select, Switch } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { dateOrderStats, decimalStats } from '@/engine/dataset/preview';
import type { DatasetProfile } from '@/engine/dataset/profile';
import { canConvert, type ColumnSchema, type DateOrder, type OperationSpec } from '@/engine/history/operations';
import { TYPE_LABEL } from '@/engine/import/infer';
import type { ColumnType } from '@/engine/import/types';
import { useStudio } from '@/state/studio';
import { fmt } from '@/lib/utils';
import { ColumnChecklist, ColumnPicker, Row } from '../shared/form';
import { visibleWhitespace } from '../table/CellValue';
import { ClusterPanel } from './ClusterPanel';

export type ToolId = 'cluster' | 'trim' | 'case' | 'replace' | 'fill' | 'dates' | 'numbers' | 'type' | 'dedupe';

export interface ToolDef {
  id: ToolId;
  kind: OperationSpec['kind'];
  label: string;
  blurb: string;
  group: 'Categories' | 'Text' | 'Missing values' | 'Formats' | 'Rows';
  icon: typeof Scissors;
  /** Which columns the tool applies to. */
  accepts: (c: ColumnSchema) => boolean;
  initial: (column: string, profile: DatasetProfile | null, schema: ColumnSchema[]) => OperationSpec;
  /** The column most in need of this tool, from the profile. */
  prefer?: (profile: DatasetProfile) => string | undefined;
}

const most = (profile: DatasetProfile, score: (c: DatasetProfile['columns'][number]) => number) => {
  let best: string | undefined;
  let top = 0;
  for (const c of profile.columns) {
    const v = score(c);
    if (v > top) (top = v), (best = c.name);
  }
  return best;
};

const isText = (c: ColumnSchema) => c.type === 'text';

export const TOOLS: ToolDef[] = [
  {
    id: 'cluster',
    kind: 'merge_values',
    label: 'Group spelling variants',
    blurb: 'Find values that mean the same thing and merge them.',
    group: 'Categories',
    icon: Combine,
    accepts: isText,
    prefer: (p) => most(p, (c) => (c.type === 'text' ? c.variants : 0)),
    initial: (column) => ({ kind: 'merge_values', params: { column, merges: [] } }),
  },
  {
    id: 'trim',
    kind: 'trim_whitespace',
    label: 'Trim whitespace',
    blurb: 'Remove stray spaces at the start and end of values.',
    group: 'Text',
    icon: Scissors,
    accepts: isText,
    prefer: (p) => most(p, (c) => c.untrimmed),
    initial: (column, profile) => {
      const dirty = profile?.columns.filter((c) => c.untrimmed > 0).map((c) => c.name) ?? [];
      return { kind: 'trim_whitespace', params: { columns: dirty.length ? dirty : [column], collapseInner: false } };
    },
  },
  {
    id: 'case',
    kind: 'change_case',
    label: 'Change case',
    blurb: 'lowercase, UPPERCASE or Title Case.',
    group: 'Text',
    icon: Baseline,
    accepts: isText,
    initial: (column) => ({ kind: 'change_case', params: { column, mode: 'title' } }),
  },
  {
    id: 'replace',
    kind: 'replace_values',
    label: 'Replace values',
    blurb: 'Swap one value or piece of text for another.',
    group: 'Text',
    icon: Replace,
    accepts: isText,
    initial: (column) => ({ kind: 'replace_values', params: { column, find: '', replace: '', match: 'exact', matchCase: false } }),
  },
  {
    id: 'fill',
    kind: 'fill_missing',
    label: 'Fill empty cells',
    blurb: 'Use a fixed value or copy from the row above or below.',
    group: 'Missing values',
    icon: PaintBucket,
    accepts: () => true,
    prefer: (p) => most(p, (c) => c.missing),
    initial: (column) => ({ kind: 'fill_missing', params: { column, mode: 'down' } }),
  },
  {
    id: 'dates',
    kind: 'standardize_dates',
    label: 'Standardise dates',
    blurb: 'Rewrite mixed date formats as YYYY-MM-DD.',
    group: 'Formats',
    icon: CalendarCheck,
    accepts: isText,
    prefer: (p) => most(p, (c) => (c.type === 'text' ? c.dateLike : 0)),
    initial: (column) => ({ kind: 'standardize_dates', params: { column, order: 'DMY' } }),
  },
  {
    id: 'numbers',
    kind: 'normalize_numbers',
    label: 'Normalise numbers',
    blurb: 'Remove thousands separators, currency signs and spaces.',
    group: 'Formats',
    icon: Hash,
    accepts: isText,
    prefer: (p) => most(p, (c) => (c.type === 'text' ? c.numberLike : 0)),
    initial: (column) => ({ kind: 'normalize_numbers', params: { column, decimal: '.' } }),
  },
  {
    id: 'type',
    kind: 'change_type',
    label: 'Convert type',
    blurb: 'Turn text into numbers, dates or true/false, or back.',
    group: 'Formats',
    icon: Shapes,
    accepts: () => true,
    initial: (column, _p, schema) => {
      const from = schema.find((c) => c.name === column)?.type ?? 'text';
      return { kind: 'change_type', params: { column, to: from === 'text' ? 'decimal' : 'text' } };
    },
  },
  {
    id: 'dedupe',
    kind: 'remove_duplicates',
    label: 'Remove duplicates',
    blurb: 'Keep the first of rows that repeat.',
    group: 'Rows',
    icon: CopyMinus,
    accepts: () => true,
    initial: () => ({ kind: 'remove_duplicates', params: { columns: [] } }),
  },
];

export const toolForKind = (kind: OperationSpec['kind']) => TOOLS.find((t) => t.kind === kind);

/** The column an operation targets (for multi-column ops: the first). */
export function targetColumn(spec: OperationSpec): string | null {
  const p = spec.params as { column?: string; columns?: string[] };
  return p.column ?? p.columns?.[0] ?? null;
}

// ---------------- form ----------------

export function ToolForm({
  spec,
  onChange,
  schema,
  manualRef,
}: {
  spec: OperationSpec;
  onChange: (s: OperationSpec) => void;
  schema: ColumnSchema[];
  /** Set when the user picked an option by hand, so auto-detection stops overriding it. */
  manualRef: { current: boolean };
}) {
  const { profile, read, version } = useStudio();
  const tool = toolForKind(spec.kind)!;
  const cols = schema.filter(tool.accepts);
  const set = (params: object, manual = true) => {
    if (manual) manualRef.current = true;
    onChange({ ...spec, params: { ...spec.params, ...params } } as OperationSpec);
  };
  const setColumn = (column: string) => {
    manualRef.current = false;
    if (spec.kind === 'change_type') {
      const from = schema.find((c) => c.name === column)?.type ?? 'text';
      onChange({ kind: 'change_type', params: { column, to: from === 'text' ? 'decimal' : 'text' } });
    } else set({ column }, false);
  };
  const column = targetColumn(spec) ?? '';

  // Auto-detect date order / decimal separator from the data.
  const [dateStats, setDateStats] = useState<Record<DateOrder, number> | null>(null);
  const [decStats, setDecStats] = useState<Record<'.' | ',', number> | null>(null);
  useEffect(() => {
    let live = true;
    if (spec.kind === 'standardize_dates') {
      void read((s) => dateOrderStats(s.database, s.currentTable, spec.params.column)).then((st) => {
        if (!live) return;
        setDateStats(st);
        if (!manualRef.current) {
          const best = (['DMY', 'MDY', 'YMD'] as const).reduce((a, b) => (st[b] > st[a] ? b : a), spec.params.order);
          if (best !== spec.params.order) onChange({ ...spec, params: { ...spec.params, order: best } });
        }
      });
    } else if (spec.kind === 'normalize_numbers') {
      void read((s) => decimalStats(s.database, s.currentTable, spec.params.column)).then((st) => {
        if (!live) return;
        setDecStats(st);
        if (!manualRef.current) {
          const best = st[','] > st['.'] ? ',' : '.';
          if (best !== spec.params.decimal) onChange({ ...spec, params: { ...spec.params, decimal: best } });
        }
      });
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec.kind, column, version]);

  if (cols.length === 0) {
    return <p className="text-sm text-slate-500">No suitable columns. This tool works on {tool.id === 'type' || tool.id === 'fill' || tool.id === 'dedupe' ? 'any' : 'text'} columns.</p>;
  }

  switch (spec.kind) {
    case 'trim_whitespace':
      return (
        <div className="space-y-4">
          <Row label="Columns" hint="Amber numbers show how many values have stray spaces.">
            <ColumnChecklist
              value={spec.params.columns}
              onChange={(columns) => set({ columns })}
              columns={cols}
              note={(c) => {
                const issues = profile?.columns.find((p) => p.name === c.name)?.untrimmed ?? 0;
                return issues > 0 ? <span className="text-amber-600">· {fmt(issues)}</span> : null;
              }}
            />
          </Row>
          <Row label="Inside values">
            <Switch id="collapse" checked={!!spec.params.collapseInner} onChange={(v) => set({ collapseInner: v })} label="Also squeeze repeated spaces into one" />
          </Row>
        </div>
      );
    case 'change_case':
      return (
        <div className="space-y-4">
          <Row label="Column">
            <ColumnPicker value={spec.params.column} onChange={setColumn} columns={cols} />
          </Row>
          <Row label="Make it">
            <Segmented
              label="Case"
              value={spec.params.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: 'title', label: 'Title Case' },
                { value: 'lower', label: 'lowercase' },
                { value: 'upper', label: 'UPPERCASE' },
              ]}
            />
          </Row>
        </div>
      );
    case 'replace_values': {
      const top = profile?.columns.find((c) => c.name === spec.params.column)?.top ?? [];
      return (
        <div className="space-y-4">
          <Row label="Column">
            <ColumnPicker value={spec.params.column} onChange={setColumn} columns={cols} />
          </Row>
          <Row label="Match">
            <Segmented
              label="Match"
              value={spec.params.match}
              onChange={(match) => set({ match })}
              options={[
                { value: 'exact', label: 'Whole value' },
                { value: 'contains', label: 'Text inside values' },
              ]}
            />
          </Row>
          <Row
            label="Find"
            hint={
              top.length > 0 && (
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  Common values:
                  {top.map((t) => (
                    <button key={t.value} onClick={() => set({ find: t.value })} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-brand-50 hover:text-brand-700">
                      {t.value === '' ? '(empty)' : visibleWhitespace(t.value)}
                    </button>
                  ))}
                </span>
              )
            }
          >
            <Input value={spec.params.find} onChange={(e) => set({ find: e.target.value })} placeholder="Text to find" className="max-w-sm" aria-label="Find" />
          </Row>
          <Row label="Replace with" hint="Leave empty to clear the matched text.">
            <Input value={spec.params.replace} onChange={(e) => set({ replace: e.target.value })} placeholder="Replacement" className="max-w-sm" aria-label="Replace with" />
          </Row>
          <Row label="Options">
            <Switch id="case" checked={spec.params.matchCase} onChange={(v) => set({ matchCase: v })} label="Match upper/lower case exactly" />
          </Row>
        </div>
      );
    }
    case 'fill_missing': {
      const missing = profile?.columns.find((c) => c.name === spec.params.column)?.missing;
      return (
        <div className="space-y-4">
          <Row label="Column" hint={missing !== undefined ? `${fmt(missing)} empty cells` : undefined}>
            <ColumnPicker value={spec.params.column} onChange={setColumn} columns={cols} />
          </Row>
          <Row label="Fill with">
            <Segmented
              label="Fill mode"
              value={spec.params.mode}
              onChange={(mode) => set({ mode, ...(mode === 'value' ? { value: spec.params.value ?? '' } : {}) })}
              options={[
                { value: 'down', label: <><ArrowDownToLine className="size-3.5" /> Value above</> },
                { value: 'up', label: <><ArrowUpToLine className="size-3.5" /> Value below</> },
                { value: 'value', label: 'A fixed value' },
              ]}
            />
          </Row>
          {spec.params.mode === 'value' && (
            <Row label="Value">
              <Input value={spec.params.value ?? ''} onChange={(e) => set({ value: e.target.value })} placeholder="e.g. Unknown" className="max-w-sm" aria-label="Fill value" />
            </Row>
          )}
        </div>
      );
    }
    case 'standardize_dates':
      return (
        <div className="space-y-4">
          <Row label="Column">
            <ColumnPicker value={spec.params.column} onChange={setColumn} columns={cols} />
          </Row>
          <Row label="Dates are written" hint={dateStats ? 'Numbers show how many values each reading understands. The best one is picked for you.' : undefined}>
            <Segmented
              label="Date order"
              value={spec.params.order}
              onChange={(order) => set({ order })}
              options={(['DMY', 'MDY', 'YMD'] as const).map((o) => ({
                value: o,
                label: o === 'DMY' ? 'Day / Month / Year' : o === 'MDY' ? 'Month / Day / Year' : 'Year / Month / Day',
                hint: dateStats ? fmt(dateStats[o]) : undefined,
              }))}
            />
          </Row>
        </div>
      );
    case 'normalize_numbers':
      return (
        <div className="space-y-4">
          <Row label="Column">
            <ColumnPicker value={spec.params.column} onChange={setColumn} columns={cols} />
          </Row>
          <Row label="Decimal mark">
            <Segmented
              label="Decimal separator"
              value={spec.params.decimal}
              onChange={(decimal) => set({ decimal })}
              options={[
                { value: '.', label: 'Point  1,234.50', hint: decStats ? fmt(decStats['.']) : undefined },
                { value: ',', label: 'Comma  1.234,50', hint: decStats ? fmt(decStats[',']) : undefined },
              ]}
            />
          </Row>
        </div>
      );
    case 'change_type': {
      const from = schema.find((c) => c.name === spec.params.column)?.type ?? 'text';
      const targets = (['text', 'integer', 'decimal', 'boolean', 'date', 'timestamp'] as ColumnType[]).filter((t) => canConvert(from, t));
      return (
        <div className="space-y-4">
          <Row label="Column">
            <ColumnPicker value={spec.params.column} onChange={setColumn} columns={cols} />
          </Row>
          <Row label={`From ${TYPE_LABEL[from].toLowerCase()} to`} hint="Conversion is strict: if any value doesn't fit, nothing changes and you'll see which values to fix.">
            <Select value={spec.params.to} onChange={(e) => set({ to: e.target.value as ColumnType })} aria-label="Target type">
              {targets.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Row>
        </div>
      );
    }
    case 'merge_values':
      return <ClusterPanel spec={spec} onChange={onChange} columns={cols} />;
    case 'remove_duplicates':
      return (
        <Row label="Compare" hint="Rows count as duplicates when the chosen columns all match. The first row is kept.">
          <ColumnChecklist value={spec.params.columns} onChange={(columns) => set({ columns })} columns={cols} allLabel="All columns" />
        </Row>
      );
    default:
      return null;
  }
}
