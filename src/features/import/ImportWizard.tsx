import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, FileSpreadsheet, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select, Switch } from '@/components/ui/input';
import { importClient } from '@/engine/import/importClient';
import type { ImportAnalysis, ImportOptions } from '@/engine/import/types';
import { useStudio } from '@/state/studio';
import { cn, formatBytes } from '@/lib/utils';
import { TypeBadge } from './TypeBadge';

const DELIMITERS = [
  { value: ',', label: 'Comma  ,' },
  { value: ';', label: 'Semicolon  ;' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe  |' },
];

const ENCODINGS = ['utf-8', 'windows-1252', 'iso-8859-2', 'windows-1250', 'windows-1251', 'koi8-r', 'utf-16le', 'utf-16be', 'shift_jis', 'gbk', 'big5'];

const KIND_LABEL = { csv: 'CSV', tsv: 'TSV', xlsx: 'Excel workbook', json: 'JSON' } as const;

export function ImportWizard({ file, onClose }: { file: File; onClose: () => void }) {
  const { openDataset } = useStudio();
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [overrides, setOverrides] = useState<Partial<ImportOptions>>({});
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    importClient
      .analyze(file, overrides)
      .then((a) => live && (setAnalysis(a), setError(null)))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [file, overrides]);

  const set = useCallback(<K extends keyof ImportOptions>(k: K, v: ImportOptions[K]) => setOverrides((o) => ({ ...o, [k]: v })), []);

  const confirm = async () => {
    if (!analysis) return;
    setImporting(true);
    setError(null);
    try {
      const result = await importClient.import(file, analysis.options);
      await openDataset(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setImporting(false);
    }
  };

  const o = analysis?.options;
  const textual = o && o.kind !== 'xlsx' && o.kind !== 'json';

  return (
    <Dialog
      open
      onClose={() => !importing && onClose()}
      className="w-[min(1100px,calc(100vw-32px))]"
      title={
        <span className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-brand-600" /> {file.name}
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-x-2">
          {formatBytes(file.size)}
          {analysis && <span>· {KIND_LABEL[analysis.kind]}</span>}
          <span className="inline-flex items-center gap-1 text-emerald-700">
            · <Lock className="size-3" /> read locally, not uploaded
          </span>
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={importing}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm} disabled={!analysis || loading || importing || analysis.preview.columns.length === 0}>
            {importing ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            {importing ? 'Importing…' : 'Import data'}
          </Button>
        </>
      }
    >
      {o && (
        <div className="mb-4 flex flex-wrap items-end gap-x-5 gap-y-3 rounded-xl bg-slate-50 p-3.5">
          {analysis!.kind === 'xlsx' && analysis!.sheets.length > 0 && (
            <Field label="Sheet">
              <Select value={o.sheet ?? ''} onChange={(e) => set('sheet', e.target.value)}>
                {analysis!.sheets.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
          )}
          {textual && (
            <Field label="Separator" hint={analysis!.detected.delimiter === o.delimiter ? 'detected' : undefined}>
              <Select value={o.delimiter} onChange={(e) => set('delimiter', e.target.value)}>
                {DELIMITERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {o.kind !== 'xlsx' && (
            <Field label="Text encoding" hint={analysis!.detected.encoding === o.encoding ? 'detected' : undefined}>
              <Select value={o.encoding} onChange={(e) => set('encoding', e.target.value)}>
                {[...new Set([o.encoding, ...ENCODINGS])].map((enc) => (
                  <option key={enc}>{enc}</option>
                ))}
              </Select>
            </Field>
          )}
          {o.kind !== 'json' && (
            <div className="pb-2">
              <Switch id="hdr" checked={o.hasHeader} onChange={(v) => set('hasHeader', v)} label="First row has column names" />
            </div>
          )}
          <div className="pb-2">
            <Switch id="types" checked={o.inferTypes} onChange={(v) => set('inferTypes', v)} label="Detect numbers & dates" />
          </div>
          {loading && <Loader2 className="mb-2.5 size-4 animate-spin text-slate-400" />}
        </div>
      )}

      {error && (
        <div className="mb-4 flex gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {analysis && analysis.warnings.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          {analysis.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      {!analysis && loading && (
        <div className="flex h-64 items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 size-4 animate-spin" /> Reading file…
        </div>
      )}

      {analysis && analysis.preview.columns.length > 0 && (
        <>
          <div className="mb-2 flex items-baseline justify-between text-[13px] text-slate-500">
            <span>
              Preview · first {analysis.preview.rows.length} rows · {analysis.preview.columns.length} columns
            </span>
            {o?.hasHeader === false && <span className="text-amber-700">Column names were generated</span>}
          </div>
          <div className={cn('max-h-[46vh] overflow-auto rounded-lg border border-slate-200', loading && 'opacity-60')}>
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-white">
                <tr>
                  <th className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-right text-[11px] font-normal text-slate-400">#</th>
                  {analysis.preview.columns.map((c, i) => (
                    <th key={c} className="border-b border-l border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-slate-700">
                      <div className="flex items-center gap-1.5">
                        <span className="max-w-[220px] truncate">{c}</span>
                        <TypeBadge type={analysis.previewTypes[i] ?? 'text'} compact />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.preview.rows.map((r, ri) => (
                  <tr key={ri} className="even:bg-slate-50/50">
                    <td className="px-2 py-1 text-right text-[11px] text-slate-400 tabular">{ri + 1}</td>
                    {analysis.preview.columns.map((_, ci) => {
                      const v = r[ci];
                      return (
                        <td key={ci} className="max-w-[260px] truncate border-l border-slate-100 px-2.5 py-1 whitespace-nowrap">
                          {v == null || v === '' ? <span className="text-slate-300">—</span> : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Types are only assigned when every value fits exactly. Values like <code className="text-slate-500">007</code> or{' '}
            <code className="text-slate-500">1,234</code> stay text so nothing is lost; you can convert them later.
          </p>
        </>
      )}
    </Dialog>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">
        {label} {hint && <span className="font-normal text-slate-400">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}
