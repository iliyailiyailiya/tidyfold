import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Info, Loader2, Plus, Search, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import type { Cluster, ClusterResult, ValueCount } from '@/engine/cluster/cluster';
import { DEFAULT_NORMALIZE, stripAccents, type NormalizeOptions } from '@/engine/cluster/normalize';
import { suggestTarget } from '@/engine/cluster/cluster';
import type { ColumnSchema, OperationSpec } from '@/engine/history/operations';
import { importClient } from '@/engine/import/importClient';
import { useStudio } from '@/state/studio';
import { cn, fmt } from '@/lib/utils';
import { visibleWhitespace } from '../table/CellValue';

type MergeSpec = Extract<OperationSpec, { kind: 'merge_values' }>;

interface Decision {
  accepted: boolean;
  /** members left out of the merge */
  excluded: Set<string>;
  to: string;
}

interface Group extends Cluster {
  manual?: boolean;
}

const NORMALIZE_LABELS: { key: keyof NormalizeOptions; label: string; example: string }[] = [
  { key: 'case', label: 'Capitals', example: 'Paris = paris' },
  { key: 'accents', label: 'Accents', example: 'Chişinău = Chisinau' },
  { key: 'spacing', label: 'Spacing', example: '“New  York ” = New York' },
  { key: 'punctuation', label: 'Punctuation', example: 'St. Louis = St Louis' },
  { key: 'wordOrder', label: 'Word order', example: 'Smith John = John Smith' },
];

/** Rejections survive switching tools/columns for the rest of the session. */
const rejectedStore = new Map<string, Set<string>>();

export function ClusterPanel({ spec, onChange, columns }: { spec: MergeSpec; onChange: (s: OperationSpec) => void; columns: ColumnSchema[] }) {
  const { read, version, session } = useStudio();
  const column = spec.params.column;
  const [normalize, setNormalize] = useState<NormalizeOptions>(DEFAULT_NORMALIZE);
  const [threshold, setThreshold] = useState(1);
  const [values, setValues] = useState<ValueCount[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [result, setResult] = useState<ClusterResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map());
  const [manual, setManual] = useState<Group[]>([]);
  const [showRejected, setShowRejected] = useState(false);
  const [limit, setLimit] = useState(50);
  const rejectKey = `${session?.prefix ?? ''}:${column}`;
  const [rejected, setRejected] = useState<Set<string>>(() => rejectedStore.get(rejectKey) ?? new Set());
  useEffect(() => setRejected(rejectedStore.get(rejectKey) ?? new Set()), [rejectKey]);
  const persistRejected = (next: Set<string>) => {
    rejectedStore.set(rejectKey, next);
    setRejected(next);
  };

  // distinct values of the column
  useEffect(() => {
    let live = true;
    setValues(null);
    setManual([]);
    void read((s) => s.distinctValues(column))
      .then((r) => live && (setValues(r.values), setTruncated(r.truncated)))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [column, version, read]);

  // clustering in the worker
  useEffect(() => {
    if (!values) return;
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      importClient
        .cluster(values, { normalize, threshold })
        .then((r) => {
          if (!live) return;
          setResult(r);
          setError(null);
          setLimit(50);
          // fresh decisions: exact-fingerprint groups pre-ticked, fuzzy ones not
          setDecisions(new Map(r.clusters.map((c) => [c.id, { accepted: c.similarity >= 1, excluded: new Set<string>(), to: c.suggested }])));
        })
        .catch((e: Error) => live && setError(e.message))
        .finally(() => live && setLoading(false));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [values, normalize, threshold]);

  const groups: Group[] = useMemo(() => [...manual, ...(result?.clusters ?? [])], [manual, result]);
  const visible = groups.filter((g) => showRejected || !rejected.has(g.id));

  // build the operation from decisions
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const merges: { from: string[]; to: string }[] = [];
    // manual groups come first and claim their values, so they win over suggestions
    const claimed = new Set<string>();
    for (const g of groups) {
      const d = decisions.get(g.id);
      if (!d?.accepted || rejected.has(g.id)) continue;
      const from = g.members.map((m) => m.value).filter((v) => !d.excluded.has(v) && !claimed.has(v));
      from.forEach((v) => claimed.add(v));
      if (from.filter((v) => v !== d.to).length === 0) continue;
      merges.push({ from, to: d.to });
    }
    onChangeRef.current({ kind: 'merge_values', params: { column, merges } });
  }, [groups, decisions, rejected, column]);

  const update = (id: string, patch: Partial<Decision>) =>
    setDecisions((m) => {
      const next = new Map(m);
      const cur = next.get(id) ?? { accepted: false, excluded: new Set<string>(), to: '' };
      next.set(id, { ...cur, ...patch });
      return next;
    });

  const setAll = (accepted: boolean) =>
    setDecisions((m) => {
      const next = new Map(m);
      for (const g of visible) if (!rejected.has(g.id)) next.set(g.id, { ...(next.get(g.id) ?? { excluded: new Set(), to: g.suggested }), accepted });
      return next;
    });

  const addManual = (members: ValueCount[]) => {
    const sorted = [...members].sort((a, b) => b.count - a.count);
    const id = `manual:${Date.now()}`;
    const to = suggestTarget(sorted);
    setManual((ms) => [{ id, members: sorted, suggested: to, rows: sorted.reduce((s, m) => s + m.count, 0), similarity: 1, manual: true }, ...ms]);
    update(id, { accepted: true, excluded: new Set(), to });
  };

  const acceptedCount = groups.filter((g) => decisions.get(g.id)?.accepted && !rejected.has(g.id)).length;
  const rejectedCount = groups.filter((g) => rejected.has(g.id)).length;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[150px_1fr] lg:items-start">
        <span className="pt-2 text-[13px] font-medium text-slate-600">Column</span>
        <Select
          value={column}
          onChange={(e) => onChange({ kind: 'merge_values', params: { column: e.target.value, merges: [] } })}
          className="w-full max-w-sm"
          aria-label="Column"
        >
          {columns.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </Select>

        <span className="pt-1 text-[13px] font-medium text-slate-600">Ignore differences in</span>
        <div className="flex flex-wrap gap-1.5">
          {NORMALIZE_LABELS.map((n) => (
            <button
              key={n.key}
              onClick={() => setNormalize((o) => ({ ...o, [n.key]: !o[n.key] }))}
              aria-pressed={normalize[n.key]}
              title={n.example}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                normalize[n.key] ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
              )}
            >
              {normalize[n.key] && <Check className="size-3" />}
              {n.label}
            </button>
          ))}
        </div>

        <span className="pt-1 text-[13px] font-medium text-slate-600">Also match typos</span>
        <div className="max-w-md">
          <input
            type="range"
            min={60}
            max={100}
            step={5}
            value={Math.round(threshold * 100)}
            onChange={(e) => setThreshold(Number(e.target.value) / 100)}
            className="w-full accent-brand-600"
            aria-label="Similarity threshold"
            aria-valuetext={threshold >= 1 ? 'Off' : `${Math.round(threshold * 100)}% similar`}
          />
          <div className="flex justify-between text-[11px] text-slate-400">
            <span>Loose (60%)</span>
            <span className="font-medium text-slate-600">{threshold >= 1 ? 'Off: identical after ignoring the above' : `${Math.round(threshold * 100)}% similar or more`}</span>
            <span>Off</span>
          </div>
        </div>
      </div>

      {/* results */}
      <div className="rounded-xl border border-slate-200">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-[13px]">
          {loading || !values ? (
            <span className="flex items-center gap-1.5 text-slate-500">
              <Loader2 className="size-4 animate-spin" /> Looking for spelling variants…
            </span>
          ) : error ? (
            <span className="text-rose-600">{error}</span>
          ) : result ? (
            <span className="text-slate-600">
              <span className="font-medium text-slate-900">{fmt(groups.length - rejectedCount)}</span> group{groups.length - rejectedCount === 1 ? '' : 's'} among {fmt(result.distinctValues)} distinct values
              <span className="text-slate-400"> · {Math.round(result.elapsedMs)} ms</span>
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            {rejectedCount > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setShowRejected((v) => !v)}>
                {showRejected ? 'Hide' : 'Show'} {rejectedCount} rejected
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setAll(true)} disabled={!visible.length}>
              Select all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAll(false)} disabled={!acceptedCount}>
              Select none
            </Button>
          </div>
        </div>
        {(truncated || (result?.skippedForFuzzy ?? 0) > 0) && (
          <p className="flex gap-1.5 border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {truncated && 'Only the 100,000 most common values were checked. '}
            {(result?.skippedForFuzzy ?? 0) > 0 && `Typo matching compared the ${fmt(20000)} most common spellings; ${fmt(result!.skippedForFuzzy)} rarer ones were only matched exactly.`}
          </p>
        )}

        <ul className={cn('divide-y divide-slate-100', loading && 'opacity-60')}>
          {visible.slice(0, limit).map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              decision={decisions.get(g.id)}
              rejected={rejected.has(g.id)}
              onDecision={(p) => update(g.id, p)}
              onReject={() => {
                if (g.manual) {
                  setManual((ms) => ms.filter((m) => m.id !== g.id));
                  return;
                }
                const next = new Set(rejected);
                if (next.has(g.id)) next.delete(g.id);
                else next.add(g.id);
                persistRejected(next);
              }}
            />
          ))}
          {result && visible.length === 0 && (
            <li className="px-4 py-6 text-center text-[13px] text-slate-500">
              No spelling variants found with these settings. Try ignoring more differences or matching typos.
            </li>
          )}
        </ul>
        {visible.length > limit && (
          <div className="border-t border-slate-100 p-2 text-center">
            <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 100)}>
              <ChevronDown /> Show more ({fmt(visible.length - limit)} left)
            </Button>
          </div>
        )}
      </div>

      {values && <ManualGrouping values={values} onCreate={addManual} />}
    </div>
  );
}

function GroupCard({
  group,
  decision,
  rejected,
  onDecision,
  onReject,
}: {
  group: Group;
  decision: Decision | undefined;
  rejected: boolean;
  onDecision: (p: Partial<Decision>) => void;
  onReject: () => void;
}) {
  const d = decision ?? { accepted: false, excluded: new Set<string>(), to: group.suggested };
  const listId = `to-${group.id}`;
  return (
    <li className={cn('px-4 py-3', rejected && 'bg-slate-50 opacity-60', d.accepted && !rejected && 'bg-brand-50/30')}>
      <div className="flex flex-wrap items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-brand-600"
          checked={d.accepted && !rejected}
          disabled={rejected}
          onChange={(e) => onDecision({ accepted: e.target.checked })}
          aria-label={`Merge group ${group.suggested}`}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
            {group.manual ? (
              <span className="rounded bg-violet-50 px-1.5 py-0.5 font-medium text-violet-700">Grouped by you</span>
            ) : group.similarity >= 1 ? (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">Same after ignoring differences</span>
            ) : (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">Similar ({Math.round(group.similarity * 100)}%) · check carefully</span>
            )}
            <span className="text-slate-400">{fmt(group.rows)} rows</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.members.map((m) => {
              const on = !d.excluded.has(m.value);
              return (
                <label
                  key={m.value}
                  className={cn(
                    'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[13px]',
                    on ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-transparent text-slate-400 line-through',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-brand-600"
                    checked={on}
                    onChange={() => {
                      const ex = new Set(d.excluded);
                      if (on) ex.add(m.value);
                      else ex.delete(m.value);
                      onDecision({ excluded: ex });
                    }}
                    aria-label={`Include ${m.value}`}
                  />
                  <span className="font-mono text-[12.5px]">{visibleWhitespace(m.value)}</span>
                  <span className="text-[11px] text-slate-400 tabular">{fmt(m.count)}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-slate-500">Merge into</span>
            <Input
              list={listId}
              value={d.to}
              onChange={(e) => onDecision({ to: e.target.value, accepted: true })}
              className="h-8 w-56 text-[13px]"
              aria-label="Merge into value"
            />
            <datalist id={listId}>
              {group.members.map((m) => (
                <option key={m.value} value={m.value} />
              ))}
            </datalist>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onReject}
          title={group.manual ? 'Remove this group' : rejected ? 'Bring this group back' : 'These are different things; never suggest this group again in this session'}
        >
          {rejected ? <Undo2 /> : <X />} {group.manual ? 'Remove' : rejected ? 'Restore' : 'Not the same'}
        </Button>
      </div>
    </li>
  );
}

function ManualGrouping({ values, onCreate }: { values: ValueCount[]; onCreate: (members: ValueCount[]) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Map<string, ValueCount>>(new Map());
  const matches = useMemo(() => {
    // accent- and case-insensitive: "chisinau" finds "Chişinău"
    const fold = (x: string) => stripAccents(x).toLocaleLowerCase();
    const needle = fold(q.trim());
    const list = needle ? values.filter((v) => fold(v.value).includes(needle)) : values;
    return list.slice(0, 200);
  }, [q, values]);

  return (
    <div className="rounded-xl border border-dashed border-slate-300">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px]">
        <Plus className="size-4 text-slate-400" />
        <span className="font-medium text-slate-700">Group values by hand</span>
        <span className="text-slate-500">for names no algorithm can match, like “Kishinev” and “Chisinau”</span>
        <ChevronDown className={cn('ml-auto size-4 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 px-4 py-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search values…" className="h-8 pl-8 text-[13px]" aria-label="Search values" />
          </div>
          <div className="flex max-h-56 flex-wrap gap-1.5 overflow-auto">
            {matches.map((v) => {
              const on = picked.has(v.value);
              return (
                <button
                  key={v.value}
                  onClick={() =>
                    setPicked((m) => {
                      const next = new Map(m);
                      if (on) next.delete(v.value);
                      else next.set(v.value, v);
                      return next;
                    })
                  }
                  aria-pressed={on}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[13px]',
                    on ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
                  )}
                >
                  {on && <Check className="size-3" />}
                  <span className="font-mono text-[12.5px]">{visibleWhitespace(v.value)}</span>
                  <span className="text-[11px] text-slate-400 tabular">{fmt(v.count)}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="subtle"
              disabled={picked.size < 2}
              onClick={() => {
                onCreate([...picked.values()]);
                setPicked(new Map());
                setQ('');
              }}
            >
              <Plus /> Group {picked.size || ''} selected
            </Button>
            {picked.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setPicked(new Map())}>
                Clear
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
