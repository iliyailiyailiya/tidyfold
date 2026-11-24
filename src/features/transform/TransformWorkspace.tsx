import { useEffect, useState } from 'react';
import { ArrowRight, Check, Loader2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { OperationPreview } from '@/engine/dataset/preview';
import type { CalcNode } from '@/engine/history/expression';
import { describeOperation, type ColumnSchema, type OperationSpec } from '@/engine/history/operations';
import { useStudio } from '@/state/studio';
import { cn, fmt, modKey } from '@/lib/utils';
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema]);

  const [pv, setPv] = useState<OperationPreview | null>(null);
  const [pvError, setPvError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [justApplied, setJustApplied] = useState<string | null>(null);
  const idle = spec?.kind === 'filter_rows' && spec.params.conditions.length === 0;

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
  const changes = pv ? pv.changedCells + pv.removedCount + pv.removedColumns.length + pv.renamed.length + pv.addedColumns.length : 0;
  const changed = !!pv && (changes > 0 || !!pv.resultRows || pv.reordered);
  const canApply = !!spec && !!pv && !pv.blocked && !pvError && changed && !loading && !applying;

  const doApply = async () => {
    if (!spec || !canApply) return;
    setApplying(true);
    const label = describeOperation(spec);
    const ok = await apply(spec);
    setApplying(false);
    if (ok) setJustApplied(label);
  };

  const applyLabel = () => {
    if (!pv) return 'Apply';
    if (pv.resultRows) return `Apply ${fmt(pv.rowsBefore)} → ${fmt(pv.rowsAfter)} rows`;
    if (pv.reordered) return 'Apply new order';
    if (pv.addedColumns.length) return `Add ${pv.addedColumns.length} column${pv.addedColumns.length === 1 ? '' : 's'}`;
    const n = pv.changedCells || pv.removedCount || changes;
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
                  <p className="text-[13px] text-slate-500">{idle ? 'Add a condition to see which rows will be removed.' : pvError ? 'Fix the options above to see a preview.' : <Summary pv={pv} />}</p>
                </div>
                <Button variant="primary" onClick={doApply} disabled={!canApply} title={canApply ? describeOperation(spec) : undefined}>
                  {applying ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                  {applying ? 'Applying…' : applyLabel()}
                </Button>
              </div>

              <div className="space-y-3 px-5 py-4">
                {pvError && <Note tone="error" text={pvError} />}
                {pv?.notes.map((n) => (
                  <Note key={n.text} {...n} />
                ))}
                {pv && !pv.blocked && <Diff pv={pv} />}
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
