import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ColumnFilter } from '@/engine/dataset/session';
import type { ColumnType } from '@/engine/import/types';
import { TYPE_LABEL } from '@/engine/import/infer';
import { useStudio } from '@/state/studio';
import { fmt, pct } from '@/lib/utils';
import { TypeBadge } from '../import/TypeBadge';
import { hasEdgeWhitespace, visibleWhitespace } from './CellValue';

export interface SelectedCell {
  rowId: number;
  column: string;
  type: ColumnType;
  value: string | null;
}

function oddChars(v: string): string[] {
  const out = new Set<string>();
  for (const ch of v) {
    const cp = ch.codePointAt(0)!;
    if (cp < 32 || (cp >= 0x7f && cp < 0xa0) || cp === 0xa0 || (cp >= 0x2000 && cp <= 0x200f) || cp === 0xfeff || cp === 0x3000) {
      out.add(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
    }
  }
  return [...out];
}

export function CellInspector({ cell, onClose, onFilter }: { cell: SelectedCell; onClose: () => void; onFilter: (f: ColumnFilter) => void }) {
  const { profile } = useStudio();
  const col = profile?.columns.find((c) => c.name === cell.column);
  const v = cell.value;
  const issues: string[] = [];
  if (v === null || v.trim() === '') issues.push('Empty value');
  else {
    if (hasEdgeWhitespace(v)) issues.push('Leading or trailing whitespace');
    const odd = oddChars(v);
    if (odd.length) issues.push(`Invisible / special characters: ${odd.join(', ')}`);
  }

  return (
    <section aria-label="Cell inspector" className="grid animate-in gap-4 border-t border-slate-200 bg-slate-50/80 px-4 py-3 text-[13px] md:grid-cols-[1fr_1fr_auto]">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
          Row <span className="font-medium text-slate-700 tabular">{fmt(cell.rowId)}</span> · <span className="truncate font-medium text-slate-700">{cell.column}</span>
          <TypeBadge type={cell.type} compact />
        </div>
        <div className="max-h-24 overflow-auto rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-[12.5px] break-all whitespace-pre-wrap">
          {v === null ? <span className="text-slate-400 italic">empty (no value)</span> : v === '' ? <span className="text-slate-400 italic">empty text</span> : visibleWhitespace(v)}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
          {v !== null && <span>{[...v].length} characters</span>}
          {issues.length === 0 ? <span className="text-emerald-700">No issues spotted</span> : issues.map((i) => <span key={i} className="text-amber-700">⚠ {i}</span>)}
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-1 text-xs text-slate-500">Column “{cell.column}” · {TYPE_LABEL[cell.type]}</div>
        {col ? (
          <dl className="grid grid-cols-3 gap-2">
            <Stat label="Empty" value={`${fmt(col.missing)} (${pct(col.missing, profile!.rows)})`} />
            <Stat label="Distinct" value={fmt(col.distinct)} />
            <Stat label="Stray spaces" value={fmt(col.untrimmed)} />
            {col.top.slice(0, 3).map((t) => (
              <div key={t.value} className="col-span-3 flex items-center gap-2 text-xs">
                <span className="truncate text-slate-700">{visibleWhitespace(t.value)}</span>
                <span className="ml-auto text-slate-400 tabular">{fmt(t.count)}</span>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-slate-400">Profiling…</p>
        )}
      </div>
      <div className="flex items-start gap-1">
        {v !== null && (
          <Button size="sm" onClick={() => onFilter({ column: cell.column, op: 'equals', value: v })}>
            <Filter /> Rows with this value
          </Button>
        )}
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close inspector">
          <X />
        </Button>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700 tabular">{value}</dd>
    </div>
  );
}
