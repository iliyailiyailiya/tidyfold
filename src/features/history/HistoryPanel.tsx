import { useRef } from 'react';
import { Download, FileUp, History, Redo2, Trash2, Undo2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeOperation } from '@/engine/history/operations';
import { useStudio } from '@/state/studio';
import { cn, fmt, modKey } from '@/lib/utils';

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { session, undo, redo, jumpTo, removeOp, exportRecipe, loadRecipe, busy } = useStudio();
  const file = useRef<HTMLInputElement>(null);
  if (!session) return null;
  const { ops, cursor } = session.history;

  return (
    <aside aria-label="History" className="flex h-full w-full flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <History className="size-4 text-slate-400" />
        <h2 className="text-sm font-semibold">History</h2>
        <div className="ml-auto flex gap-0.5">
          <Button size="icon" variant="ghost" onClick={undo} disabled={cursor === 0 || !!busy} title={`Undo (${modKey}Z)`} aria-label="Undo">
            <Undo2 />
          </Button>
          <Button size="icon" variant="ghost" onClick={redo} disabled={cursor >= ops.length || !!busy} title={`Redo (⇧${modKey}Z)`} aria-label="Redo">
            <Redo2 />
          </Button>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close history" title="Close">
            <X />
          </Button>
        </div>
      </div>

      <ol className="min-h-0 flex-1 overflow-auto px-2 py-2">
        <Step index={0} active={cursor === 0} applied title="Original import" sub={`${session.fileName} · ${fmt(session.originalRowCount)} rows`} onClick={() => jumpTo(0)} />
        {ops.map((op, i) => {
          const step = i + 1;
          return (
            <Step
              key={op.id}
              index={step}
              active={cursor === step}
              applied={step <= cursor}
              title={describeOperation(op)}
              sub={new Date(op.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              onClick={() => jumpTo(step)}
              onRemove={() => removeOp(op.id)}
            />
          );
        })}
        {ops.length === 0 && (
          <li className="px-3 py-6 text-center text-[13px] leading-relaxed text-slate-400">
            Changes you make appear here.
            <br />
            The original file is never modified.
          </li>
        )}
      </ol>

      <div className="space-y-2 border-t border-slate-100 p-3">
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Recipe</p>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={exportRecipe} disabled={cursor === 0} title="Save the applied steps as a reusable JSON recipe">
            <Download /> Save
          </Button>
          <Button size="sm" className="flex-1" onClick={() => file.current?.click()} title="Replay a saved recipe on this data">
            <Upload /> Apply…
          </Button>
        </div>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadRecipe(f);
            e.target.value = '';
          }}
        />
        <p className="flex gap-1.5 text-[11px] leading-snug text-slate-400">
          <FileUp className="size-3 shrink-0 translate-y-0.5" /> A recipe stores steps, not data. Applying one replaces the current history.
        </p>
      </div>
    </aside>
  );
}

function Step({
  index,
  title,
  sub,
  active,
  applied,
  onClick,
  onRemove,
}: {
  index: number;
  title: string;
  sub: string;
  active: boolean;
  applied: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <li className="group relative">
      <button
        onClick={onClick}
        aria-current={active ? 'step' : undefined}
        className={cn(
          'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
          active ? 'bg-brand-50' : 'hover:bg-slate-50',
          !applied && 'opacity-45',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular',
            active ? 'bg-brand-600 text-white' : applied ? 'bg-slate-200 text-slate-600' : 'border border-dashed border-slate-300 text-slate-400',
          )}
        >
          {index}
        </span>
        <span className="min-w-0 flex-1 pr-6">
          <span className={cn('block text-[13px] leading-snug', active ? 'font-medium text-brand-800' : 'text-slate-700', !applied && 'line-through decoration-slate-300')}>{title}</span>
          <span className="block truncate text-[11px] text-slate-400">
            {sub}
            {!applied && ' · undone'}
          </span>
        </span>
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute top-2 right-2 rounded-md p-1 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 focus-visible:opacity-100"
          aria-label={`Remove step: ${title}`}
          title="Remove this step (later steps are replayed)"
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </li>
  );
}
