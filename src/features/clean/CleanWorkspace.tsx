import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { OperationPreview } from '@/engine/dataset/preview';
import { describeOperation, type OperationSpec } from '@/engine/history/operations';
import { useStudio } from '@/state/studio';
import { cn, fmt, modKey } from '@/lib/utils';
import { hasPreviewChanges } from '../shared/changes';
import { Note, PreviewDiff as Diff, PreviewSummary as Summary } from '../shared/preview';
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

  // Live preview (debounced). Keyed to the exact spec so a preview from the
  // previous tool can never be shown or applied.
  const [pv, setPv] = useState<OperationPreview | null>(null);
  const [pvKey, setPvKey] = useState<string | null>(null);
  const [pvError, setPvError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [justApplied, setJustApplied] = useState<string | null>(null);
  // Nothing chosen yet (e.g. no spelling groups ticked): no preview to compute.
  const idle = spec?.kind === 'merge_values' && spec.params.merges.length === 0;
  const specKey = spec ? JSON.stringify(spec) : '';
  useEffect(() => {
    if (!spec) return;
    if (idle) {
      setPv(null);
      setPvKey(specKey);
      setPvError(null);
      setLoading(false);
      return;
    }
    let live = true;
    const key = JSON.stringify(spec);
    setLoading(true);
    const t = setTimeout(() => {
      preview(spec)
        .then((p) => live && (setPv(p), setPvKey(key), setPvError(null)))
        .catch((e: Error) => live && (setPv(null), setPvKey(key), setPvError(e.message)))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [spec, specKey, version, preview, idle]);

  if (!session) return null;
  const tool = spec ? toolForKind(spec.kind) : null;
  const shownPv = pvKey === specKey ? pv : null;
  const changes = shownPv ? shownPv.changedCells + shownPv.removedCount + shownPv.removedColumns.length + shownPv.renamed.length : 0;
  const changed = hasPreviewChanges(shownPv);
  const canApply = !!spec && !!shownPv && !pvError && changed && !loading && !applying;

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
                  <p className="text-[13px] text-slate-500">{idle ? 'Tick the groups you want to merge.' : pvError ? 'Fix the options above to see a preview.' : <Summary pv={shownPv} />}</p>
                </div>
                <Button variant="primary" onClick={doApply} disabled={!canApply} title={canApply ? describeOperation(spec) : undefined}>
                  {applying ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                  {applying ? 'Applying…' : changes > 0 && shownPv && !shownPv.blocked ? `Apply ${fmt(shownPv.changedCells || shownPv.removedCount || changes)} change${(shownPv.changedCells || shownPv.removedCount || changes) === 1 ? '' : 's'}` : spec.kind === 'change_type' && shownPv?.converted ? 'Apply type change' : 'Apply'}
                </Button>
              </div>

              <div className="space-y-3 px-5 py-4">
                {pvError && <Note tone="error" text={pvError} />}
                {shownPv?.notes.map((n) => (
                  <Note key={n.text} {...n} />
                ))}
                {shownPv && !shownPv.blocked && <Diff pv={shownPv} />}
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

