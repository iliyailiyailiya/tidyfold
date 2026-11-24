import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Input, Select, Switch } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { autoName, canConvert, ROW_ID, type Aggregation, type BulkAction, type ColumnSchema, type FilterCondition, type FilterOp, type OperationSpec } from '@/engine/history/operations';
import { TYPE_LABEL } from '@/engine/import/infer';
import type { ColumnType } from '@/engine/import/types';
import { useStudio } from '@/state/studio';
import { cn } from '@/lib/utils';
import { ColumnChecklist, ColumnPicker, Row } from '../shared/form';
import { CalcBuilder } from './CalcBuilder';

const FILTER_OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: 'equals', label: 'equals', needsValue: true },
  { value: 'notEquals', label: 'does not equal', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'startsWith', label: 'starts with', needsValue: true },
  { value: 'isEmpty', label: 'is empty', needsValue: false },
  { value: 'isNotEmpty', label: 'is not empty', needsValue: false },
  { value: 'greater', label: 'is greater than', needsValue: true },
  { value: 'less', label: 'is less than', needsValue: true },
  { value: 'between', label: 'is between', needsValue: true },
];
const AGG_FNS: { value: Aggregation['fn']; label: string }[] = [
  { value: 'count', label: 'Count rows' },
  { value: 'count_distinct', label: 'Count distinct' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Smallest' },
  { value: 'max', label: 'Largest' },
  { value: 'first', label: 'First value' },
];

function TinyButton({ onClick, children, label, disabled }: { onClick: () => void; children: ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function NameField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <Row label={label} hint={hint ?? `Cannot be empty, “${ROW_ID}”, or the name of another column.`}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="New column name" className="max-w-sm" aria-label={label} />
    </Row>
  );
}

function ConditionsEditor({
  conditions,
  onChange,
  schema,
  prefix = 'Condition',
}: {
  conditions: FilterCondition[];
  onChange: (conditions: FilterCondition[]) => void;
  schema: ColumnSchema[];
  prefix?: string;
}) {
  const change = (i: number, patch: Partial<FilterCondition>) => onChange(conditions.map((c, j) => (i === j ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-2">
      {conditions.map((c, i) => {
        const op = FILTER_OPS.find((o) => o.value === c.op)!;
        const col = schema.find((x) => x.name === c.column);
        const valueType = col?.type === 'date' ? 'date' : col?.type === 'timestamp' ? 'datetime-local' : 'text';
        return (
          <div key={i} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-slate-600">{prefix} {i + 1}</span>
              <TinyButton label={`Remove ${prefix.toLowerCase()} ${i + 1}`} onClick={() => onChange(conditions.filter((_, j) => j !== i))}>
                <Trash2 className="size-3.5" />
              </TinyButton>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ColumnPicker label={`${prefix} ${i + 1} column`} value={c.column} onChange={(column) => change(i, { column })} columns={schema} />
              <Select aria-label={`${prefix} ${i + 1} comparison`} value={c.op} onChange={(e) => change(i, { op: e.target.value as FilterOp })} className="h-9">
                {FILTER_OPS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
              {op.needsValue && <Input type={valueType} aria-label={`${prefix} ${i + 1} value`} value={c.value ?? ''} onChange={(e) => change(i, { value: e.target.value })} placeholder="Value" className="w-40" />}
              {c.op === 'between' && <Input type={valueType} aria-label={`${prefix} ${i + 1} upper bound`} value={c.value2 ?? ''} onChange={(e) => change(i, { value2: e.target.value })} placeholder="Upper bound" className="w-40" />}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...conditions, { column: schema[0]?.name ?? '', op: 'equals', value: '' }])}
        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[13px] text-slate-600 hover:border-brand-400 hover:text-brand-700"
      >
        <Plus className="size-4" /> Add condition
      </button>
    </div>
  );
}

export function TransformForm({ spec, onChange, schema }: { spec: OperationSpec; onChange: (s: OperationSpec) => void; schema: ColumnSchema[] }) {
  const { profile } = useStudio();
  const [positionsText, setPositionsText] = useState('');
  const [bulkQuery, setBulkQuery] = useState('');
  const [bulkType, setBulkType] = useState<'all' | ColumnType>('all');
  const set = (params: object) => onChange({ ...spec, params: { ...spec.params, ...params } } as OperationSpec);
  const all = schema;
  const textCols = all.filter((c) => c.type === 'text');

  switch (spec.kind) {
    case 'split_column': {
      const p = spec.params;
      const names = p.names ?? Array.from({ length: p.maxParts }, () => '');
      const parsePositions = (s: string) => s.split(/[,\s]+/).map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
      return (
        <div className="space-y-4">
          <Row label="Column" hint={textCols.length === 0 ? 'No text columns available. Convert one to text first.' : undefined}>
            <ColumnPicker value={p.column} onChange={(column) => set({ column })} columns={textCols.length ? textCols : all} />
          </Row>
          <Row label="Split by">
            <Segmented
              label="Split method"
              value={p.by}
              onChange={(by) => set({ by, ...(by === 'delimiter' ? { delimiter: p.delimiter || ',' } : { positions: p.positions ?? [2], maxParts: 2 }) })}
              options={[
                { value: 'delimiter', label: 'A separator' },
                { value: 'position', label: 'Character positions' },
              ]}
            />
          </Row>
          {p.by === 'delimiter' ? (
            <Row label="Separator" hint="Typed exactly: a dot is a dot, not a wildcard.">
              <Input value={p.delimiter ?? ''} onChange={(e) => set({ delimiter: e.target.value })} placeholder="e.g. | or , or -" aria-label="Separator" className="max-w-sm" />
            </Row>
          ) : (
            <Row label="Positions" hint="Characters are counted from 1. Use commas: 2, 5 splits into 3 parts.">
              <Input
                value={positionsText || (p.positions ?? []).join(', ')}
                onChange={(e) => {
                  const positions = parsePositions(e.target.value);
                  setPositionsText(e.target.value);
                  set({ positions, maxParts: positions.length + 1 });
                }}
                placeholder="2, 5"
                aria-label="Split positions"
                className="max-w-sm"
              />
            </Row>
          )}
          <Row label="Number of parts" hint="Any extra text stays in the last part, so nothing is lost.">
            <Input
              type="number"
              min={2}
              max={50}
              value={p.maxParts}
              onChange={(e) => {
                const maxParts = Math.min(50, Math.max(2, Number(e.target.value) || 2));
                set({ maxParts, names: Array.from({ length: maxParts }, (_, i) => names[i] ?? '') });
              }}
              aria-label="Number of parts"
              className="w-24"
            />
          </Row>
          <Row label="New column names" hint="Leave blank to use “column_1”, “column_2”, and so on.">
            <div className="flex max-w-lg flex-wrap gap-1.5">
              {Array.from({ length: p.maxParts }, (_, i) => (
                <Input
                  key={i}
                  value={names[i] ?? ''}
                  onChange={(e) => {
                    const next = [...names];
                    next[i] = e.target.value;
                    set({ names: next });
                  }}
                  placeholder={`${p.column}_${i + 1}`}
                  aria-label={`Part ${i + 1} name`}
                  className="w-32"
                />
              ))}
            </div>
          </Row>
          <Row label="Original column">
            <Switch id="split-keep" checked={p.keepOriginal} onChange={(keepOriginal) => set({ keepOriginal })} label="Keep the original column too" />
          </Row>
        </div>
      );
    }

    case 'merge_columns': {
      const p = spec.params;
      return (
        <div className="space-y-4">
          <Row label="Columns" hint="Choose at least two.">
            <ColumnChecklist value={p.columns} onChange={(columns) => set({ columns })} columns={all} note={(c) => {
              const missing = profile?.columns.find((x) => x.name === c.name)?.missing ?? 0;
              return missing > 0 ? <span className="text-amber-600">· {missing} empty</span> : null;
            }} />
          </Row>
          <Row label="Separator">
            <Input value={p.separator} onChange={(e) => set({ separator: e.target.value })} placeholder="e.g. space, comma, |" aria-label="Separator" className="max-w-sm" />
          </Row>
          <NameField label="New column" value={p.into} onChange={(into) => set({ into })} />
          <Row label="Empty cells">
            <Switch id="merge-skip" checked={p.skipEmpty} onChange={(skipEmpty) => set({ skipEmpty })} label="Skip empty cells" />
          </Row>
          <Row label="Original columns">
            <Switch id="merge-keep" checked={p.keepOriginals} onChange={(keepOriginals) => set({ keepOriginals })} label="Keep the original columns too" />
          </Row>
        </div>
      );
    }

    case 'extract_text': {
      const p = spec.params;
      return (
        <div className="space-y-4">
          <Row label="Column">
            <ColumnPicker value={p.column} onChange={(column) => set({ column })} columns={textCols.length ? textCols : all} />
          </Row>
          <Row label="Find">
            <Segmented
              label="Extraction method"
              value={p.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: 'regex', label: 'A pattern' },
                { value: 'before', label: 'Before text' },
                { value: 'after', label: 'After text' },
                { value: 'between', label: 'Between text' },
              ]}
            />
          </Row>
          {p.mode === 'regex' && (
            <Row label="Pattern" hint="Simple patterns work best. Back-references and look-ahead aren't supported.">
              <Input value={p.pattern ?? ''} onChange={(e) => set({ pattern: e.target.value })} placeholder="e.g. id=(\\d+)" aria-label="Pattern" className="max-w-sm" />
            </Row>
          )}
          {(p.mode === 'before' || p.mode === 'after') && (
            <Row label="Text to look for">
              <Input value={p.start ?? ''} onChange={(e) => set({ start: e.target.value })} placeholder="e.g. =" aria-label="Text to look for" className="max-w-sm" />
            </Row>
          )}
          {p.mode === 'between' && (
            <>
              <Row label="Starts after">
                <Input value={p.start ?? ''} onChange={(e) => set({ start: e.target.value })} placeholder="e.g. id=" aria-label="Starts after" className="max-w-sm" />
              </Row>
              <Row label="Ends before">
                <Input value={p.end ?? ''} onChange={(e) => set({ end: e.target.value })} placeholder="e.g. ;" aria-label="Ends before" className="max-w-sm" />
              </Row>
            </>
          )}
          <NameField label="New column" value={p.into} onChange={(into) => set({ into })} />
          <Row label="Capital letters">
            <Switch id="extract-case" checked={p.matchCase} onChange={(matchCase) => set({ matchCase })} label="Match upper/lower case exactly" />
          </Row>
        </div>
      );
    }

    case 'calculated_column':
      return (
        <div className="space-y-4">
          <NameField label="New column" value={spec.params.into} onChange={(into) => set({ into })} />
          <CalcBuilder spec={spec} onChange={onChange} schema={schema} />
        </div>
      );

    case 'filter_rows': {
      const p = spec.params;
      return (
        <div className="space-y-4">
          <Row label="Match">
            <Segmented label="How to combine conditions" value={p.match} onChange={(match) => set({ match })} options={[{ value: 'all', label: 'All conditions' }, { value: 'any', label: 'Any condition' }]} />
          </Row>
          <Row label="Keep">
            <Segmented label="Rows to keep" value={p.keep} onChange={(keep) => set({ keep })} options={[{ value: 'matching', label: 'Matching rows' }, { value: 'non-matching', label: 'Non-matching rows' }]} />
          </Row>
          {p.conditions.length === 0 && <p className="text-[13px] text-slate-500">Add a condition to see the rows that will be removed.</p>}
          <ConditionsEditor conditions={p.conditions} onChange={(conditions) => set({ conditions })} schema={all} />
        </div>
      );
    }

    case 'group_aggregate': {
      const p = spec.params;
      const aggs = p.aggregations;
      const change = (i: number, patch: Partial<Aggregation>) => set({ aggregations: aggs.map((a, j) => (i === j ? { ...a, ...patch } : a)) });
      const nextName = () => {
        const used = [...schema, ...aggs.map((a) => ({ name: a.as, type: 'text' as const }))];
        return autoName(used, 'summary');
      };
      return (
        <div className="space-y-4">
          <Row label="Group by" hint="Leave empty for one row with totals for the whole table.">
            <ColumnChecklist value={p.by} onChange={(by) => set({ by })} columns={all} />
          </Row>
          <div className="space-y-2">
            {aggs.map((a, i) => {
              const needsColumn = a.fn !== 'count';
              return (
                <div key={i} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-slate-600">Summary {i + 1}</span>
                    <TinyButton label={`Remove summary ${i + 1}`} onClick={() => set({ aggregations: aggs.filter((_, j) => j !== i) })}>
                      <Trash2 className="size-3.5" />
                    </TinyButton>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Select aria-label={`Summary ${i + 1} function`} value={a.fn} onChange={(e) => change(i, { fn: e.target.value as Aggregation['fn'] })} className="h-9">
                      {AGG_FNS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </Select>
                    {needsColumn && (
                      <ColumnPicker label={`Summary ${i + 1} column`} value={a.column ?? all[0]?.name ?? ''} onChange={(column) => change(i, { column })} columns={all} />
                    )}
                    <span className="text-xs text-slate-500">as</span>
                    <Input aria-label={`Summary ${i + 1} name`} value={a.as} onChange={(e) => change(i, { as: e.target.value })} className="w-40" placeholder="name" />
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => set({ aggregations: [...aggs, { fn: 'sum', column: all[0]?.name, as: nextName() }] })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-[13px] text-slate-600 hover:border-brand-400 hover:text-brand-700"
          >
            <Plus className="size-4" /> Add summary
          </button>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This replaces the table's rows with one row per group (fresh row numbers). Undo restores the original rows.
          </p>
        </div>
      );
    }

    case 'reorder_columns': {
      const order = spec.params.order;
      const move = (i: number, to: number) => {
        if (to < 0 || to >= order.length) return;
        const next = [...order];
        const [item] = next.splice(i, 1);
        if (item !== undefined) next.splice(to, 0, item);
        set({ order: next });
      };
      return (
        <Row label="Column order" hint="Use the arrows to move a column. No values change.">
          <ul className="max-w-md divide-y divide-slate-100 rounded-xl border border-slate-200">
            {order.map((name, i) => (
              <li key={name} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-slate-700">
                <span className="w-5 text-right text-xs text-slate-400 tabular">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <TinyButton label={`Move ${name} left`} onClick={() => move(i, i - 1)} disabled={i === 0}><ArrowUp className="size-3.5" /></TinyButton>
                <TinyButton label={`Move ${name} right`} onClick={() => move(i, i + 1)} disabled={i === order.length - 1}><ArrowDown className="size-3.5" /></TinyButton>
              </li>
            ))}
          </ul>
        </Row>
      );
    }

    case 'rename_column': {
      const p = spec.params;
      return (
        <div className="space-y-4">
          <Row label="Column">
            <ColumnPicker value={p.column} onChange={(column) => set({ column, to: column ? autoName(schema.filter((c) => c.name !== column), `${column}_new`) : '' })} columns={all} />
          </Row>
          <NameField label="New name" value={p.to} onChange={(to) => set({ to })} />
        </div>
      );
    }

    case 'remove_column':
      return (
        <div className="space-y-4">
          <Row label="Column">
            <ColumnPicker value={spec.params.column} onChange={(column) => set({ column })} columns={all} />
          </Row>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">The column disappears from this step onward. Undo brings it back; your original file is never changed.</p>
        </div>
      );

    case 'change_type': {
      const p = spec.params;
      const from = all.find((c) => c.name === p.column)?.type ?? 'text';
      const targets = (['text', 'integer', 'decimal', 'boolean', 'date', 'timestamp'] as ColumnType[]).filter((t) => canConvert(from, t));
      return (
        <div className="space-y-4">
          <Row label="Column">
            <ColumnPicker value={p.column} onChange={(column) => {
              const nextFrom = all.find((c) => c.name === column)?.type ?? 'text';
              set({ column, to: canConvert(nextFrom, p.to) ? p.to : nextFrom === 'text' ? 'decimal' : 'text' });
            }} columns={all} />
          </Row>
          <Row label={`From ${TYPE_LABEL[from].toLowerCase()} to`} hint="Strict: if any value won't fit, the step fails and names example values.">
            <Select aria-label="Target type" value={p.to} onChange={(e) => set({ to: e.target.value as ColumnType })} className="max-w-sm">
              {targets.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </Select>
          </Row>
        </div>
      );
    }

    case 'bulk_edit': {
      const p = spec.params;
      const a = p.action;
      const textOnly = a.kind !== 'clear';
      const typeChoices: ('all' | ColumnType)[] = textOnly ? ['all', 'text'] : ['all', 'text', 'integer', 'decimal', 'boolean', 'date', 'timestamp'];
      const activeType = typeChoices.includes(bulkType) ? bulkType : 'all';
      const query = bulkQuery.trim().toLowerCase();
      const shown = all.filter((c) => (activeType === 'all' || c.type === activeType) && (!query || c.name.toLowerCase().includes(query)));
      const compatible = textOnly ? all.filter((c) => c.type === 'text') : all;
      const shownCompatible = shown.filter((c) => !textOnly || c.type === 'text');
      const toggle = (name: string) => set({ columns: p.columns.includes(name) ? p.columns.filter((x) => x !== name) : [...p.columns, name] });
      const setAction = (action: BulkAction) => {
        const columns = action.kind === 'clear' ? p.columns : p.columns.filter((name) => all.find((c) => c.name === name)?.type === 'text');
        set({ action, columns });
        setBulkType('all');
      };
      return (
        <div className="space-y-4">
          <Row label="What to do" hint="The same edit is applied to every chosen column. Values are never converted to another type.">
            <Select
              aria-label="Bulk edit action"
              className="max-w-sm"
              value={a.kind}
              onChange={(e) => {
                const kind = e.target.value;
                if (kind === 'trim') setAction({ kind: 'trim', collapseInner: false });
                else if (kind === 'case') setAction({ kind: 'case', mode: 'lower' });
                else if (kind === 'replace') setAction({ kind: 'replace', find: '', replace: '', matchCase: false, regex: false });
                else if (kind === 'affix') setAction({ kind: 'affix', where: 'end', text: '' });
                else if (kind === 'fill_empty') setAction({ kind: 'fill_empty', value: '' });
                else setAction({ kind: 'clear' });
              }}
            >
              <option value="trim">Trim spaces</option>
              <option value="case">Change letter case</option>
              <option value="replace">Find & replace</option>
              <option value="affix">Add text at start or end</option>
              <option value="fill_empty">Fill empty cells</option>
              <option value="clear">Clear values</option>
            </Select>
          </Row>

          {a.kind === 'trim' && (
            <Row label="Inner spaces">
              <Switch id="bulk-collapse" checked={!!a.collapseInner} onChange={(collapseInner) => set({ action: { ...a, collapseInner } })} label="Collapse repeated spaces between words to one" />
            </Row>
          )}

          {a.kind === 'case' && (
            <Row label="Make it">
              <Segmented
                label="Letter case"
                value={a.mode}
                onChange={(mode) => set({ action: { ...a, mode } })}
                options={[
                  { value: 'lower', label: 'lowercase' },
                  { value: 'upper', label: 'UPPERCASE' },
                  { value: 'title', label: 'Title Case' },
                ]}
              />
            </Row>
          )}

          {a.kind === 'replace' && (
            <>
              <Row label="Find">
                <Input value={a.find} onChange={(e) => set({ action: { ...a, find: e.target.value } })} placeholder={a.regex ? 'e.g. \\s+' : 'e.g. Berlin'} aria-label="Bulk find" className="max-w-sm" />
              </Row>
              <Row label="Replace with">
                <Input value={a.replace} onChange={(e) => set({ action: { ...a, replace: e.target.value } })} placeholder="Leave empty to delete it" aria-label="Bulk replace with" className="max-w-sm" />
              </Row>
              <Row label="Matching">
                <div className="space-y-2">
                  <Switch id="bulk-case" checked={a.matchCase} onChange={(matchCase) => set({ action: { ...a, matchCase } })} label="Match upper/lower case exactly" />
                  <Switch id="bulk-regex" checked={!!a.regex} onChange={(regex) => set({ action: { ...a, regex } })} label="Treat “find” as a regular expression" />
                </div>
              </Row>
              {a.regex && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Use {'\\1'} for the first capture group. Look-ahead and back-references in the pattern aren't supported.
                </p>
              )}
            </>
          )}

          {a.kind === 'affix' && (
            <>
              <Row label="Where">
                <Segmented label="Where to add text" value={a.where} onChange={(where) => set({ action: { ...a, where } })} options={[{ value: 'start', label: 'At the start' }, { value: 'end', label: 'At the end' }]} />
              </Row>
              <Row label="Text" hint="Blank cells stay empty.">
                <Input value={a.text} onChange={(e) => set({ action: { ...a, text: e.target.value } })} placeholder="e.g. #" aria-label="Text to add" className="max-w-sm" />
              </Row>
            </>
          )}

          {a.kind === 'fill_empty' && (
            <Row label="Fill with" hint="Only blank and empty cells change.">
              <Input value={a.value} onChange={(e) => set({ action: { ...a, value: e.target.value } })} placeholder="e.g. unknown" aria-label="Value for empty cells" className="max-w-sm" />
            </Row>
          )}

          {a.kind === 'clear' && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Clears every chosen cell to empty. The preview shows exactly which cells change, and Undo restores them.
            </p>
          )}

          <Row label="Columns" hint={textOnly ? 'Only text columns can be edited with this action.' : 'Any column type can be cleared.'}>
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Input value={bulkQuery} onChange={(e) => setBulkQuery(e.target.value)} placeholder="Find columns by name" aria-label="Find columns by name" className="w-48" />
                <Select aria-label="Column type filter" value={activeType} onChange={(e) => setBulkType(e.target.value as 'all' | ColumnType)} className="h-9 w-36">
                  {typeChoices.map((t) => <option key={t} value={t}>{t === 'all' ? 'All types' : TYPE_LABEL[t]}</option>)}
                </Select>
                <button
                  type="button"
                  disabled={shownCompatible.length === 0}
                  onClick={() => set({ columns: [...new Set([...p.columns, ...shownCompatible.map((c) => c.name)])] })}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Select shown
                </button>
                <button
                  type="button"
                  disabled={p.columns.length === 0}
                  onClick={() => set({ columns: [] })}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-auto">
                {shown.map((c) => {
                  const on = p.columns.includes(c.name);
                  const disabled = textOnly && c.type !== 'text';
                  return (
                    <button
                      key={c.name}
                      type="button"
                      aria-pressed={on}
                      disabled={disabled}
                      title={disabled ? 'Only text columns can be edited with this action.' : undefined}
                      onClick={() => toggle(c.name)}
                      className={cn(
                        'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                        on ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                        disabled && 'cursor-not-allowed opacity-40',
                      )}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className={cn('text-[10px]', on ? 'text-brand-500' : 'text-slate-400')}>{TYPE_LABEL[c.type]}</span>
                    </button>
                  );
                })}
                {shown.length === 0 && <p className="py-1 text-xs text-slate-400">No columns match this name and type.</p>}
              </div>
              <p className="text-xs text-slate-400">{p.columns.length} of {compatible.length} {textOnly ? 'text ' : ''}columns selected</p>
            </div>
          </Row>

          <div className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2">
              <p className="text-[13px] font-medium text-slate-600">Only edit rows that match</p>
              <p className="text-xs text-slate-400">Optional. With no conditions, every row is edited.</p>
            </div>
            <ConditionsEditor prefix="Row condition" conditions={p.conditions} onChange={(conditions) => set({ conditions })} schema={all} />
            {p.conditions.length > 1 && (
              <div className="mt-2">
                <Segmented label="How to combine row conditions" value={p.match} onChange={(match) => set({ match })} options={[{ value: 'all', label: 'All conditions' }, { value: 'any', label: 'Any condition' }]} />
              </div>
            )}
          </div>
        </div>
      );
    }

    default:
      return <p className="text-sm text-slate-500">Choose a tool.</p>;
  }
}
