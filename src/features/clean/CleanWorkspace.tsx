import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Info, Loader2, OctagonX, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { OperationPreview } from '@/engine/dataset/preview';
import { describeOperation, type OperationSpec } from '@/engine/history/operations';
import { useStudio } from '@/state/studio';
import { cn, fmt, modKey } from '@/lib/utils';
import { visibleWhitespace } from '../table/CellValue';
import { TOOLS, ToolForm, targetColumn, toolForKind, type ToolDef } from './tools';

const GROUPS = ['Categories', 'Text', 'Missing values', 'Formats', 'Rows'] as const;

export function CleanWorkspace() {
  const { session, profile, cleanDraft, openInClean, preview, apply, version } = useStudio();
  const schema = session?.schema ?? [];
  const [spec, setSpec] = useState<OperationSpec | null>(null);
  const manual = useRef(false);

  const pickTool = (tool: ToolDef, column?: string) => {
    const usable = schema.filter(tool.accepts);
    const ok = (c: string | undefined) => c !== undefined && usable.some((u) => u.name === c);
    // the column that most needs this tool, else the one already selected, else the first
    const preferred = profile && tool.prefer ? tool.prefer(profile) : undefined;
    const col = ok(preferred) ? preferred : ok(column) ? column : usable[0]?.name;
    manual.current = false;
    setSpec(col !== undefined || tool.id === 'dedupe' ? tool.initial(col ?? '', profile, schema) : { ...tool.initial('', profile, schema) });
  };

  // A draft sent from Overview ("Review") or elsewhere.
  useEffect(() => {
    if (cleanDraft) {
      manual.current = false;
      setSpec(cleanDraft);
      openInClean(null);
    }
  }, [cleanDraft, openInClean]);

  // Default tool.
  useEffect(() => {
    if (!spec && schema.length && !cleanDraft) pickTool(TOOLS[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.length]);

  // If the target column disappears (undo, rename…) or no longer suits the
  // tool (e.g. it was just converted), reset the tool.
  useEffect(() => {
    if (!spec) return;
    const col = targetColumn(spec);
    const current = schema.find((c) => c.name === col);
    const t = toolForKind(spec.kind)!;
    if (col && !current) pickTool(t);
    else if (current && !t.accepts(current)) pickTool(t);
    else if (current && spec.kind === 'change_type' && spec.params.to === current.type) setSpec(t.initial(current.name, profile, schema));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  // Live preview (debounced).
  const [pv, setPv] = useState<OperationPreview | null>(null);
  const [pvError, setPvError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [justApplied, setJustApplied] = useState<string | null>(null);
  // Nothing chosen yet (e.g. no spelling groups ticked): no preview to compute.
  const idle = spec?.kind === 'merge_values' && spec.params.merges.length === 0;
  useEffect(() => {
    if (!spec) return;
    if (idle) {
      setPv(null);
      setPvError(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      preview(spec)
        .then((p) => live && (setPv(p), setPvError(null)))
        .catch((e: Error) => live && (setPv(null), setPvError(e.message)))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [spec, version, preview, idle]);

  if (!session) return null;
  const tool = spec ? toolForKind(spec.kind) : null;
  const changes = pv ? pv.changedCells + pv.removedCount + pv.removedColumns.length + pv.renamed.length : 0;
  const canApply = !!spec && !!pv && !pv.blocked && !pvError && changes > 0 && !loading && !applying;

  const doApply = async () => {
    if (!spec || !canApply) return;
    setApplying(true);
    const label = describeOperation(spec);
    const ok = await apply(spec);
    setApplying(false);
    if (ok) setJustApplied(label);
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      {/* tool list */}
      <nav aria-label="Cleaning tools" className="shrink-0 border-b border-slate-200 bg-white md:w-64 md:overflow-auto md:border-r md:border-b-0">
        <div className="flex gap-1 overflow-x-auto p-2 md:block md:space-y-4 md:p-3">
          {GROUPS.map((g) => (
            <div key={g} className="contents md:block">
              <p className="hidden px-2 pb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase md:block">{g}</p>
              {TOOLS.filter((t) => t.group === g).map((t) => {
                const active = tool?.id === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setJustApplied(null);
                      pickTool(t, spec ? (targetColumn(spec) ?? undefined) : undefined);
                    }}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'flex shrink-0 items-start gap-2.5 rounded-lg px-2.5 py-2 text-left whitespace-nowrap transition-colors md:w-full md:whitespace-normal',
                      active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <t.icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-brand-600' : 'text-slate-400')} />
                    <span>
                      <span className="block text-[13px] font-medium">{t.label}</span>
                      <span className="hidden text-xs leading-snug text-slate-500 md:block">{t.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* form + preview */}
      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
          {justApplied && (
            <div className="flex animate-in items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-800" role="status">
              <Check className="size-4" /> Applied: {justApplied}. It's in your history. Undo with {modKey}Z.
            </div>
          )}

          {spec && tool && (
            <Card className="p-5">
              <div className="mb-4">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <tool.icon className="size-4 text-brand-600" /> {tool.label}
                </h2>
                <p className="mt-0.5 text-[13px] text-slate-500">{tool.blurb}</p>
              </div>
              <ToolForm
                spec={spec}
                onChange={(s) => {
                  setJustApplied(null);
                  setSpec(s);
                }}
                schema={schema}
                manualRef={manual}
              />
            </Card>
          )}

          {spec && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                    Preview {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
                  </h3>
                  <p className="text-[13px] text-slate-500">{idle ? 'Tick the groups you want to merge.' : pvError ? 'Fix the options above to see a preview.' : <Summary pv={pv} />}</p>
                </div>
                <Button variant="primary" onClick={doApply} disabled={!canApply} title={canApply ? describeOperation(spec) : undefined}>
                  {applying ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                  {applying ? 'Applying…' : changes > 0 && pv && !pv.blocked ? `Apply ${fmt(pv.changedCells || pv.removedCount || changes)} change${(pv.changedCells || pv.removedCount || changes) === 1 ? '' : 's'}` : 'Apply'}
                </Button>
              </div>

              <div className="space-y-3 px-5 py-4">
                {pvError && <Note tone="error" text={pvError} />}
                {pv?.notes.map((n) => (
                  <Note key={n.text} {...n} />
                ))}
                {pv && !pv.blocked && <Diff pv={pv} />}
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Undo2 className="size-3.5" /> Applying adds a step to your history. The original file is never modified.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({ pv }: { pv: OperationPreview | null }) {
  if (!pv) return <>Calculating…</>;
  if (pv.blocked) return <span className="text-rose-600">Can't be applied as it stands.</span>;
  const parts: string[] = [];
  if (pv.changedCells) parts.push(`${fmt(pv.changedCells)} cell${pv.changedCells === 1 ? '' : 's'} will change`);
  if (pv.removedCount) parts.push(`${fmt(pv.removedCount)} row${pv.removedCount === 1 ? '' : 's'} will be removed`);
  if (pv.removedColumns.length) parts.push(`column ${pv.removedColumns.map((c) => `“${c}”`).join(', ')} will be removed`);
  for (const r of pv.renamed) parts.push(`“${r.from}” becomes “${r.to}”`);
  if (!parts.length) return <>No changes</>;
  return (
    <>
      {parts.join(' · ')}
      <span className="text-slate-400"> · computed in {Math.round(pv.elapsedMs)} ms</span>
    </>
  );
}

function Note({ tone, text, examples }: { tone: 'info' | 'warn' | 'error'; text: string; examples?: string[] | undefined }) {
  const Icon = tone === 'error' ? OctagonX : tone === 'warn' ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        'flex gap-2 rounded-lg px-3 py-2 text-[13px]',
        tone === 'error' && 'bg-rose-50 text-rose-800',
        tone === 'warn' && 'bg-amber-50 text-amber-800',
        tone === 'info' && 'bg-slate-50 text-slate-600',
      )}
      role={tone === 'error' ? 'alert' : undefined}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {text}
        {examples && examples.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {examples.map((e) => (
              <code key={e} className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs ring-1 ring-black/5">
                {visibleWhitespace(e)}
              </code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Value({ v, tone }: { v: string | null; tone: 'before' | 'after' }) {
  if (v === null || v === '')
    return <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-400 italic">{v === null ? 'empty' : 'empty text'}</span>;
  return (
    <span
      className={cn(
        'rounded px-1 py-0.5 font-mono text-[12.5px] break-all',
        tone === 'before' ? 'bg-rose-50 text-rose-700 line-through decoration-rose-300' : 'bg-emerald-50 text-emerald-800',
      )}
    >
      {visibleWhitespace(v)}
    </span>
  );
}

function Diff({ pv }: { pv: OperationPreview }) {
  if (pv.samples.length === 0 && pv.removedRows.length === 0) return null;
  const multi = pv.columns.length > 1;
  return (
    <div className="space-y-3">
      {pv.columns.length > 1 && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {pv.columns.map((c) => (
            <span key={c.name} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
              {c.name}: <span className="font-medium tabular">{fmt(c.changed)}</span>
            </span>
          ))}
        </div>
      )}
      {pv.samples.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className={cn('w-full text-[13px]', multi && 'min-w-[520px]')}>
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="w-14 px-3 py-2 text-right font-medium">Row</th>
                {multi && <th className="px-3 py-2 font-medium">Column</th>}
                <th className="px-3 py-2 font-medium">Before{!multi && pv.columns[0] && <span className="font-normal text-slate-400"> · {pv.columns[0].name}</span>}</th>
                <th className="w-6" />
                <th className="px-3 py-2 font-medium">After</th>
              </tr>
            </thead>
            <tbody>
              {pv.samples.map((s) => (
                <tr key={`${s.rowId}-${s.column}`} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-right text-xs text-slate-400 tabular">{fmt(s.rowId)}</td>
                  {multi && <td className="max-w-[160px] truncate px-3 py-1.5 text-slate-600">{s.column}</td>}
                  <td className="px-3 py-1.5">
                    <Value v={s.before} tone="before" />
                  </td>
                  <td className="text-slate-300">
                    <ArrowRight className="size-3.5" />
                  </td>
                  <td className="px-3 py-1.5">
                    <Value v={s.after} tone="after" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pv.changedCells > pv.samples.length && (
            <p className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs text-slate-500">
              Showing {fmt(pv.samples.length)} of {fmt(pv.changedCells)} changes.
            </p>
          )}
        </div>
      )}
      {pv.removedRows.length > 0 && (
        <div className="rounded-lg border border-rose-200">
          <p className="border-b border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700">
            Rows that will be removed {pv.removedCount > pv.removedRows.length && `(first ${pv.removedRows.length} of ${fmt(pv.removedCount)})`}
          </p>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-[13px]">
              <tbody>
                {pv.removedRows.map((r) => (
                  <tr key={r.rowId} className="border-t border-rose-50 text-slate-500 line-through decoration-rose-300">
                    <td className="w-16 px-3 py-1 text-right text-xs tabular">{fmt(r.rowId)}</td>
                    {r.values.map((v, i) => (
                      <td key={i} className="max-w-[160px] truncate px-2 py-1 whitespace-nowrap">
                        {v ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
