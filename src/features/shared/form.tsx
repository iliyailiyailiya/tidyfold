import type { ReactNode } from 'react';
import { Select } from '@/components/ui/input';
import type { ColumnSchema } from '@/engine/history/operations';
import { TYPE_LABEL } from '@/engine/import/infer';
import { cn } from '@/lib/utils';

/** One labelled field, stacking on phones and aligning on wide screens. */
export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1.5 lg:grid-cols-[150px_1fr] lg:items-center lg:gap-4">
      <span className="text-[13px] font-medium text-slate-600">{label}</span>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}

export function ColumnPicker({ value, onChange, columns, label = 'Column' }: { value: string; onChange: (v: string) => void; columns: ColumnSchema[]; label?: string }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-full max-w-sm" aria-label={label}>
      {columns.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name} · {TYPE_LABEL[c.type]}
        </option>
      ))}
    </Select>
  );
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
        active ? 'border-brand-200 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
      )}
    >
      {children}
    </button>
  );
}

export function ColumnChecklist({
  value,
  onChange,
  columns,
  allLabel,
  note,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  columns: ColumnSchema[];
  allLabel?: string;
  /** Optional per-column annotation, e.g. how many cells need cleaning. */
  note?: (c: ColumnSchema) => ReactNode;
}) {
  return (
    <div className="flex max-h-44 flex-wrap gap-1.5 overflow-auto">
      {allLabel && (
        <Chip active={value.length === 0} onClick={() => onChange([])}>
          {allLabel}
        </Chip>
      )}
      {columns.map((c) => {
        const on = value.includes(c.name);
        return (
          <Chip key={c.name} active={on} onClick={() => onChange(on ? value.filter((v) => v !== c.name) : [...value, c.name])}>
            <span className="truncate">{c.name}</span>
            {note?.(c)}
          </Chip>
        );
      })}
    </div>
  );
}
