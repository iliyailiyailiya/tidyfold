import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { FileSpreadsheet, FileJson, FileText, Lock, Sparkles, Upload, WifiOff, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, fmt } from '@/lib/utils';
import { makeSampleCsv } from './sample';
import { useStudio } from '@/state/studio';
import { RecentProjects } from './RecentProjects';

export const ACCEPT = '.csv,.tsv,.tab,.txt,.xlsx,.xlsm,.xls,.json,.jsonl,.ndjson';

/**
 * Phase 6: zero-touch statistics. Drawn from the engine via the studio;
 * deletions only happen when clicked (and are undoable).
 */
export function SampleWarning() {
  const { session, columnRowCounts } = useStudio();
  const [stats, setStats] = useState<Map<string, number> | null>(null);

  const refresh = () =>
    columnRowCounts().then(setStats).catch(() => setStats(null));

  useEffect(() => {
    if (!session) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, session?.version]);

  if (!session || !stats) return null;

  const zeros = session.schema.filter((c) => (stats.get(c.name) ?? 0) === 0).map((c) => c.name);
  if (zeros.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/80">
      <CardHeader>
        <CardTitle className="text-[13px]">Column statistics (auto, read-only)</CardTitle>
        <CardDescription className="text-[12px]">
          Fully-zero columns — nothing deletes or hides your data unless you click:
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {zeros.map((name) => (
          <div key={name} className="flex items-center justify-between">
            <span className="text-sm text-amber-900">“{name}” — {fmt(stats.get(name) ?? 0)} of {fmt(session.originalRowCount)} filled</span>
            <Button size="sm" variant="ghost" onClick={() => void session.apply({ kind: 'remove_column', params: { column: name } }).then(refresh)}>
              Delete “{name}” (⌘Z to undo)
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function Landing({ onFile }: { onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-4 py-12 sm:px-6">
      <div className="mb-8 text-center">
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          <Lock className="size-3.5" /> Runs entirely in your browser
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">Clean messy data, privately.</h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-slate-500">
          Drop in a spreadsheet to see what's wrong with it and fix it step by step. Your file is processed on this device and never uploaded.
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        aria-label="Choose a file to open"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'group cursor-pointer rounded-2xl border-2 border-dashed bg-white px-6 py-12 text-center shadow-soft transition-all',
          over ? 'border-brand-500 bg-brand-50/50 ring-4 ring-brand-500/10' : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50/50',
        )}
      >
        <div className={cn('mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition-transform', over && 'scale-110')}>
          <Upload className="size-6" />
        </div>
        <p className="text-[15px] font-medium text-slate-800">{over ? 'Drop to open' : 'Drop a file here, or click to browse'}</p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
          <Format icon={<FileText />} label="CSV · TSV" />
          <Format icon={<FileSpreadsheet />} label="Excel .xlsx" />
          <Format icon={<FileJson />} label="JSON · JSON Lines" />
        </div>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="mt-4 text-center">
        <Button variant="ghost" size="sm" className="h-auto min-h-8 py-1.5 whitespace-normal" onClick={() => onFile(makeSampleCsv())}>
          <Sparkles /> Try it with a messy sample dataset
        </Button>
      </div>

      <div className="mt-4 px-4">
        <RecentProjects onFile={onFile} />
      </div>

      <div className="mt-6 space-y-3 px-4">
        <SampleWarning />
      </div>

      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        <Point icon={<WifiOff />} title="Nothing leaves your device" text="No uploads, no accounts, no tracking. Works offline once loaded." />
        <Point icon={<Undo2 />} title="Every change is reversible" text="Each step is recorded. Undo, jump back, or remove any step." />
        <Point icon={<Sparkles />} title="Problems found for you" text="Missing values, duplicates and stray spaces are flagged on import." />
      </div>
    </div>
  );
}

function Format({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 [&_svg]:size-3.5">
      {icon}
      {label}
    </span>
  );
}

function Point({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/60 p-4">
      <div className="mb-2 text-brand-600 [&_svg]:size-4">{icon}</div>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{text}</p>
    </div>
  );
}
