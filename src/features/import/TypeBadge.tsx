import { Binary, Calendar, CalendarClock, Hash, ToggleLeft, Type } from 'lucide-react';
import type { ColumnType } from '@/engine/import/types';
import { TYPE_LABEL } from '@/engine/import/infer';
import { cn } from '@/lib/utils';

const ICON: Record<ColumnType, typeof Type> = {
  text: Type,
  integer: Hash,
  decimal: Binary,
  boolean: ToggleLeft,
  date: Calendar,
  timestamp: CalendarClock,
};

const TONE: Record<ColumnType, string> = {
  text: 'text-slate-500 bg-slate-100',
  integer: 'text-sky-700 bg-sky-50',
  decimal: 'text-sky-700 bg-sky-50',
  boolean: 'text-violet-700 bg-violet-50',
  date: 'text-amber-700 bg-amber-50',
  timestamp: 'text-amber-700 bg-amber-50',
};

export function TypeBadge({ type, compact, className }: { type: ColumnType; compact?: boolean; className?: string }) {
  const Icon = ICON[type];
  return (
    <span
      title={TYPE_LABEL[type]}
      className={cn('inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10.5px] font-medium leading-none', TONE[type], className)}
    >
      <Icon className="size-3" aria-hidden />
      {!compact && TYPE_LABEL[type]}
      {compact && <span className="sr-only">{TYPE_LABEL[type]}</span>}
    </span>
  );
}
