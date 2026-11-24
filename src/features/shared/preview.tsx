import { AlertTriangle, ArrowRight, Info, OctagonX } from 'lucide-react';
import type { OperationPreview } from '@/engine/dataset/preview';
import { TYPE_LABEL } from '@/engine/import/infer';
import { cn, fmt } from '@/lib/utils';
import { visibleWhitespace } from '../table/CellValue';

export function PreviewSummary({ pv }: { pv: OperationPreview | null }) {
  if (!pv) return <>Calculating…</>;
  if (pv.blocked) return <span className="text-rose-600">Can't be applied as it stands.</span>;
  const parts: string[] = [];
  if (pv.changedCells) parts.push(`${fmt(pv.changedCells)} cell${pv.changedCells === 1 ? '' : 's'} will change`);
  if (pv.removedCount) parts.push(`${fmt(pv.removedCount)} row${pv.removedCount === 1 ? '' : 's'} will be removed`);
  if (pv.removedColumns.length) {
    const shown = pv.removedColumns.slice(0, 3).map((c) => `“${c}”`).join(', ');
    const rest = pv.removedColumns.length - 3;
    parts.push(`column${pv.removedColumns.length === 1 ? '' : 's'} ${shown}${rest > 0 ? ` and ${rest} more` : ''} will be removed`);
  }
  for (const r of pv.renamed) parts.push(`“${r.from}” becomes “${r.to}”`);
  if (pv.converted) parts.push(`“${pv.converted.column}” becomes ${TYPE_LABEL[pv.converted.to].toLowerCase()}`);
  if (pv.addedColumns.length) parts.push(`${pv.addedColumns.length === 1 ? 'column' : 'columns'} ${pv.addedColumns.map((c) => `“${c.name}”`).join(', ')} will be added`);
  if (pv.resultRows) parts.push(`${fmt(pv.rowsBefore)} rows → ${fmt(pv.rowsAfter)} rows`);
  if (pv.reordered) parts.push('column order will change');
  if (!parts.length) return <>No changes</>;
  return (
    <>
      {parts.join(' · ')}
      <span className="text-slate-400"> · computed in {Math.round(pv.elapsedMs)} ms</span>
    </>
  );
}

export function Note({ tone, text, examples }: { tone: 'info' | 'warn' | 'error'; text: string; examples?: string[] | undefined }) {
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
              <code key={e} className="max-w-full truncate rounded bg-white/70 px-1.5 py-0.5 font-mono text-xs ring-1 ring-black/5" title={e}>
                {visibleWhitespace(e)}
              </code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Value({ v, tone }: { v: string | null; tone: 'before' | 'after' | 'new' }) {
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

function ResultTable({ pv }: { pv: OperationPreview }) {
  if (!pv.resultRows) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <p className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
        {fmt(pv.rowsBefore)} rows → {fmt(pv.rowsAfter)} rows · first {pv.resultRows.length} result rows
      </p>
      <table className="w-full min-w-[420px] text-[13px]">
        <thead className="bg-slate-50/70 text-left text-xs text-slate-500">
          <tr>
            {pv.reshaped && <th className="px-3 py-2 font-medium">Row</th>}
            <th className="px-3 py-2 font-medium">Result values</th>
          </tr>
        </thead>
        <tbody>
          {pv.resultRows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {pv.reshaped && <td className="px-3 py-1.5 text-xs text-slate-400 tabular">{i + 1}</td>}
              <td className="flex flex-wrap gap-1 px-3 py-1.5">
                {r.values.map((v, j) => (
                  <span key={j} className="max-w-[220px] truncate rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[12px] text-slate-600" title={v ?? ''}>
                    {v === null || v === '' ? <span className="italic text-slate-400">empty</span> : visibleWhitespace(v)}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pv.rowsAfter > pv.resultRows.length && (
        <p className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs text-slate-500">
          Showing {fmt(pv.resultRows.length)} of {fmt(pv.rowsAfter)} result rows.
        </p>
      )}
    </div>
  );
}

function AddedTable({ pv }: { pv: OperationPreview }) {
  if (pv.addedColumns.length === 0) return null;
  const width = Math.max(...pv.addedColumns.map((c) => c.samples.length), 1);
  return (
    <div className="overflow-x-auto rounded-lg border border-emerald-200">
      <p className="border-b border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">New columns · Before = new column</p>
      <table className="w-full min-w-[360px] text-[13px]">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2 font-medium">Column</th>
            <th className="px-3 py-2 font-medium">Before</th>
            <th className="px-3 py-2 font-medium">Sample results</th>
          </tr>
        </thead>
        <tbody>
          {pv.addedColumns.map((c) => (
            <tr key={c.name} className="border-t border-slate-100">
              <td className="max-w-[160px] truncate px-3 py-1.5 font-medium text-slate-700">{c.name}</td>
              <td className="px-3 py-1.5">
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] text-brand-700">new column</span>
              </td>
              <td className="px-3 py-1.5">
                <span className="flex flex-wrap gap-1">
                  {c.samples.length === 0 && <span className="text-xs text-slate-400 italic">no non-empty results</span>}
                  {c.samples.slice(0, 8).map((v, i) => (
                    <Value key={i} v={v} tone="new" />
                  ))}
                  {c.samples.length > 8 && <span className="text-xs text-slate-400">+{c.samples.length - 8} more</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pv.addedColumns.some((c) => c.samples.length === 0 || width === 0) && (
        <p className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 text-xs text-slate-500">Empty results are hidden in samples but kept in the data.</p>
      )}
    </div>
  );
}

export function PreviewDiff({ pv }: { pv: OperationPreview }) {
  if (pv.samples.length === 0 && pv.removedRows.length === 0 && pv.addedColumns.length === 0 && !pv.resultRows) return null;
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
      <AddedTable pv={pv} />
      <ResultTable pv={pv} />
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
