import { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { OperationPreview } from '@/engine/dataset/preview';
import type { CalcNode } from '@/engine/history/expression';
import { describeOperation, type ColumnSchema, type OperationSpec } from '@/engine/history/operations';
import { useStudio } from '@/state/studio';
import { cn, fmt, modKey } from '@/lib/utils';
import { hasPreviewChanges } from '../shared/changes';
import { Note, PreviewDiff as Diff, PreviewSummary as Summary } from '../shared/preview';
import { TransformForm } from './TransformForm';
import { targetColumn, toolForKind, TRANSFORM_TOOLS, type TransformToolDef } from './tools';

const GROUPS = ['Columns', 'Rows'] as const;

function calcColumns(n: CalcNode): string[] {
  switch (n.kind) {
    case 'column': return [n.name];
    case 'number':
    case 'text': return [];
    case 'binary': return [...calcColumns(n.left), ...calcColumns(n.right)];
    case 'round':
    case 'upper':
    case 'lower': return calcColumns(n.value);
    case 'ifEmpty': return [...calcColumns(n.value), ...calcColumns(n.fallback)];
    case 'datePart': return calcColumns(n.value);
    case 'daysBetween': return [...calcColumns(n.from), ...calcColumns(n.to)];
  }
}

export function TransformWorkspace() {
  const { session, profile, preview, apply, version } = useStudio();
  const schema = session?.schema ?? [];
  const [spec, setSpec] = useState<OperationSpec | null>(null);

  const pickTool = (tool: TransformToolDef) => setSpec(tool.initial(schema, profile));

  // Default tool; prefer splitting when there's text, otherwise a formula.
  useEffect(() => {
    if (!spec && schema.length) {
      const tool = schema.some((c) => c.type === 'text') ? TRANSFORM_TOOLS[0]! : TRANSFORM_TOOLS.find((t) => t.id === 'calculate')!;
      pickTool(tool);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.length]);

  // Reset a tool whose column has disappeared (undo, remove, rename…).
  useEffect(() => {
    if (!spec) return;
    const tool = toolForKind(spec.kind);
    if (!tool) return;
    const col = targetColumn(spec);
    if (col && !schema.some((c) => c.name === col)) pickTool(tool);
    else if (spec.kind === 'calculated_column' && calcColumns(spec.params.expression).some((name) => !schema.some((c) => c.name === name))) pickTool(tool);
    else if (spec.kind === 'change_type' && schema.find((c) => c.name === spec.params.column)?.type === spec.params.to) pickTool(tool);
    else if (spec.kind === 'bulk_edit') {
      const kept = spec.params.columns.filter((name) => schema.some((c) => c.name === name));
      if (kept.length !== spec.params.columns.length) setSpec({ ...spec, params: { ...spec.params, columns: kept } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  const [pv, setPv] = useState<OperationPreview | null>(null);
  const [pvKey, setPvKey] = useState<string | null>(null);
  const [pvError, setPvError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [justApplied, setJustApplied] = useState<string | null>(null);
  const idle = (spec?.kind === 'filter_rows' && spec.params.conditions.length === 0) || (spec?.kind === 'bulk_edit' && spec.params.columns.length === 0);
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
  // Never show or apply a preview that belongs to a previous form state.
  const shownPv = pvKey === specKey ? pv : null;
  const changes = shownPv ? shownPv.changedCells + shownPv.removedCount + shownPv.removedColumns.length + shownPv.renamed.length + shownPv.addedColumns.length : 0;
  const changed = hasPreviewChanges(shownPv);
  const canApply = !!spec && !!shownPv && !shownPv.blocked && !pvError && changed && !loading && !applying;

  const doApply = async () => {
    if (!spec || !canApply) return;
    setApplying(true);
    const label = describeOperation(spec);
    const ok = await apply(spec);
    setApplying(false);
    if (ok) setJustApplied(label);
  };

  const applyLabel = () => {
    if (!shownPv) return 'Apply';
    if (shownPv.resultRows) return `Apply ${fmt(shownPv.rowsBefore)} → ${fmt(shownPv.rowsAfter)} rows`;
    if (shownPv.reordered) return 'Apply new order';
    if (shownPv.converted) return 'Apply type change';
    if (shownPv.addedColumns.length) return `Add ${shownPv.addedColumns.length} column${shownPv.addedColumns.length === 1 ? '' : 's'}`;
    const n = shownPv.changedCells || shownPv.removedCount || changes;
    return `Apply ${fmt(n)} change${n === 1 ? '' : 's'}`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <nav aria-label="Transform tools" className="shrink-0 border-b border-slate-200 bg-white md:w-64 md:overflow-auto md:border-r md:border-b-0">
        <div className="flex gap-1 overflow-x-auto p-2 md:block md:space-y-4 md:p-3">
          {GROUPS.map((g) => (
            <div key={g} className="contents md:block">
              <p className="hidden px-2 pb-1 text-[11px] font-medium tracking-wide text-slate-400 uppercase md:block">{g}</p>
              {TRANSFORM_TOOLS.filter((t) => t.group === g).map((t) => {
                const active = tool?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setJustApplied(null);
                      pickTool(t);
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
              <div key={tool.id}>
                <TransformForm
                  spec={spec}
                  onChange={(s) => {
                    setJustApplied(null);
                    setSpec(s);
                  }}
                  schema={schema as ColumnSchema[]}
                />
              </div>
            </Card>
          )}

          {spec && (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <h3 className="flex items-center gap-2 text-[15px] font-semibold">
                    Preview {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
                  </h3>
                  <p className="text-[13px] text-slate-500">{idle ? 'Choose at least one column to see a preview.' : pvError ? 'Fix the options above to see a preview.' : <Summary pv={shownPv} />}</p>
                </div>
                <Button variant="primary" onClick={doApply} disabled={!canApply} title={canApply ? describeOperation(spec) : undefined}>
                  {applying ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                  {applying ? 'Applying…' : applyLabel()}
                </Button>
              </div>

              <div className="space-y-3 px-5 py-4">
                {pvError && <Note tone="error" text={pvError} />}
                {shownPv?.notes.map((n) => (
                  <Note key={n.text} {...n} />
                ))}
                {shownPv && !shownPv.blocked && <Diff pv={shownPv} />}
                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Undo2 className="size-3.5" /> Every change is a recorded step. Undo restores the original data.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
