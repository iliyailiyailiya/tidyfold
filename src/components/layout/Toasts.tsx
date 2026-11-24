import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useStudio } from '@/state/studio';
import { cn } from '@/lib/utils';

export function Toasts() {
  const { toasts, dismiss } = useStudio();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex w-[min(440px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex animate-in items-start gap-2.5 rounded-xl bg-slate-900 px-3.5 py-2.5 text-[13px] text-white shadow-pop">
          {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" /> : t.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" /> : <Info className="mt-0.5 size-4 shrink-0 text-sky-400" />}
          <span className={cn('flex-1 leading-snug', t.tone === 'error' && 'text-rose-50')}>{t.message}</span>
          {t.action && (
            <button
              className="rounded-md px-1.5 font-medium text-brand-200 hover:bg-white/10"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-slate-400 hover:text-white" aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
