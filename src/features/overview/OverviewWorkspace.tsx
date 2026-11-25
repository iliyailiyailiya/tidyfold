import { useState, type ReactNode } from 'react';
import { AlertTriangle, Copy, CheckCircle2, Clock, Info, Wand2, Rows3, Columns3, CircleDashed, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ColumnType } from '@/engine/import/types';
import { useStudio } from '@/state/studio';
import { cn, fmt, pct } from '@/lib/utils';
import { TypeBadge } from '../import/TypeBadge';
import { visibleWhitespace } from '../table/CellValue';

export function OverviewWorkspace() {
  const { session, profile, profileError, apply, setWorkspace, openInClean } = useStudio();
  const [applying, setApplying] = useState<string | null>(null);
  if (!session) return null;

  if (profileError) {
    return (
      <div className="p-6">
        <Card className="border-rose-200">
          <CardContent className="flex gap-2 pt-5 text-sm text-rose-700">
            <AlertTriangle className="size-4" /> Couldn't analyse this dataset: {profileError}
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 size-4 animate-spin" /> Analysing your data locally…
      </div>
    );
  }

  const typeCounts = profile.columns.reduce<Partial<Record<ColumnType, number>>>((m, c) => ((m[c.type] = (m[c.type] ?? 0) + 1), m), {});

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      {session.warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
          {session.warnings.map((w) => (
            <li key={w} className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Rows3 />} label="Rows" value={fmt(profile.rows)} sub={profile.rows !== session.originalRowCount ? `${fmt(session.originalRowCount)} imported` : 'as imported'} />
        <Kpi
          icon={<Columns3 />}
          label="Columns"
          value={fmt(profile.columns.length)}
          sub={
            <span className="flex flex-wrap gap-1">
              {Object.entries(typeCounts).map(([t, n]) => (
                <span key={t} className="inline-flex items-center gap-0.5">
                  <TypeBadge type={t as ColumnType} compact /> {n}
                </span>
              ))}
            </span>
          }
        />
        <Kpi icon={<CircleDashed />} label="Empty cells" value={fmt(profile.missingCells)} sub={`${pct(profile.missingCells, profile.totalCells)} of all cells`} tone={profile.missingCells ? 'amber' : 'green'} />
        <Kpi icon={<Copy />} label="Duplicate rows" value={fmt(profile.duplicateRows)} sub={profile.duplicateRows ? 'exact repeats' : 'none found'} tone={profile.duplicateRows ? 'amber' : 'green'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <QualityCard />

        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="size-4 text-brand-600" /> Suggested fixes
              </CardTitle>
              <CardDescription>Review shows exactly what will change. Every fix becomes an undoable step in your history.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {profile.suggestions.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
                <CheckCircle2 className="size-4" /> Nothing to fix among the checks that are available so far.
              </div>
            )}
            {profile.suggestions.map((s) => (
              <div key={s.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{s.title}</p>
                  <p className="mt-0.5 text-[13px] text-slate-500">{s.detail}</p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant={s.oneClick ? 'ghost' : 'subtle'} onClick={() => openInClean(s.spec)} title="See exactly what will change first">
                    Review
                  </Button>
                  {s.oneClick && (
                    <Button
                      size="sm"
                      variant="subtle"
                      disabled={applying !== null}
                      onClick={async () => {
                        setApplying(s.id);
                        await apply(s.spec);
                        setApplying(null);
                      }}
                    >
                      {applying === s.id && <Loader2 className="animate-spin" />} Apply
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <CheckCircle2 className="size-3.5 text-emerald-500" /> Checked in Explore
              </p>
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                <ul className="grid gap-1 text-[13px] text-slate-500 sm:grid-cols-2">
                  <li>· Outliers in numbers and dates</li>
                  <li>· Missing values and per-column statistics</li>
                </ul>
                <Button size="sm" variant="ghost" onClick={() => setWorkspace('explore')}>
                  Open Explore
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-dashed border-slate-200 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Clock className="size-3.5" /> Not checked yet
              </p>
              <ul className="mt-1.5 grid gap-1 text-[13px] text-slate-500 sm:grid-cols-2">
                <li>· Values outside an expected list</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Columns</CardTitle>
            <CardDescription>Profiled with DuckDB in {Math.round(profile.elapsedMs)} ms, in this tab.</CardDescription>
          </div>
          <Button size="sm" onClick={() => setWorkspace('table')}>
            Open table
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto px-0 pb-2">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="py-2 pl-5 font-medium">Column</th>
                <th className="py-2 font-medium">Type</th>
                <th className="py-2 font-medium">Filled</th>
                <th className="py-2 text-right font-medium">Distinct</th>
                <th className="py-2 pl-6 font-medium">Most common / range</th>
                <th className="py-2 pr-5 text-right font-medium">Issues</th>
              </tr>
            </thead>
            <tbody>
              {profile.columns.map((c) => {
                const filled = profile.rows - c.missing;
                const fillPct = profile.rows ? filled / profile.rows : 1;
                return (
                  <tr key={c.name} className="border-b border-slate-50 last:border-0">
                    <td className="max-w-[220px] truncate py-2.5 pl-5 font-medium text-slate-800">{c.name}</td>
                    <td className="py-2.5">
                      <TypeBadge type={c.type} />
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${pct(filled, profile.rows)} filled`}>
                          <div className={cn('h-full rounded-full', fillPct >= 0.98 ? 'bg-emerald-500' : fillPct >= 0.8 ? 'bg-amber-400' : 'bg-rose-400')} style={{ width: `${fillPct * 100}%` }} />
                        </div>
                        <span className="text-xs text-slate-500 tabular">{pct(filled, profile.rows)}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-right text-slate-600 tabular">{fmt(c.distinct)}</td>
                    <td className="max-w-[320px] py-2.5 pl-6 text-slate-500">
                      {c.type !== 'text' && c.min !== null ? (
                        <span className="tabular">
                          {c.min} → {c.max}
                        </span>
                      ) : (
                        <span className="flex gap-1.5 truncate">
                          {c.top.slice(0, 3).map((t) => (
                            <Badge key={t.value} tone="outline" className="max-w-[120px] truncate font-normal">
                              <span className="truncate">{t.value === '' ? '(empty)' : visibleWhitespace(t.value)}</span>
                              <span className="text-slate-400">{fmt(t.count)}</span>
                            </Badge>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-5 text-right">
                      <span className="inline-flex gap-1">
                        {c.missing > 0 && <Badge tone="amber">{fmt(c.missing)} empty</Badge>}
                        {c.untrimmed > 0 && <Badge tone="amber">{fmt(c.untrimmed)} spaces</Badge>}
                        {c.type === 'text' && c.dateLike > 0 && <Badge tone="brand">{fmt(c.dateLike)} dates as text</Badge>}
                        {c.type === 'text' && c.numberLike > 0 && <Badge tone="brand">{fmt(c.numberLike)} numbers as text</Badge>}
                        {c.type === 'text' && c.variants > 0 && <Badge tone="brand">{fmt(c.variants)} variants</Badge>}
                        {c.missing === 0 && c.untrimmed === 0 && !(c.type === 'text' && (c.dateLike || c.numberLike || c.variants)) && <Badge tone="green">OK</Badge>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: string; sub: ReactNode; tone?: 'amber' | 'green' }) {
  return (
    <Card className="min-w-0 p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 [&_svg]:size-3.5">
        {icon} {label}
      </div>
      <div className={cn('mt-1.5 text-2xl font-semibold tracking-tight tabular', tone === 'amber' && 'text-amber-600')}>{value}</div>
      <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
    </Card>
  );
}

function QualityCard() {
  const { profile } = useStudio();
  const [showHow, setShowHow] = useState(false);
  if (!profile) return null;
  const { score, components } = profile.quality;
  const color = score >= 90 ? '#059669' : score >= 70 ? '#d97706' : '#e11d48';
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Data quality score</CardTitle>
          <CardDescription>A transparent summary of the checks run so far.</CardDescription>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowHow((s) => !s)} aria-expanded={showHow}>
          <Info /> How it's scored
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <svg viewBox="0 0 80 80" className="size-24 shrink-0 -rotate-90" role="img" aria-label={`Quality score ${score} out of 100`}>
            <circle cx="40" cy="40" r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
            <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} className="transition-[stroke-dashoffset] duration-500" />
            <text x="40" y="40" textAnchor="middle" dominantBaseline="central" className="rotate-90 fill-slate-900 text-[20px] font-semibold" style={{ transformOrigin: '40px 40px' }}>
              {score}
            </text>
          </svg>
          <div className="w-full min-w-0 flex-1 space-y-2.5">
            {components.map((k) => (
              <div key={k.key}>
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-slate-700">{k.label}</span>
                  <span className="text-slate-500 tabular">{(k.value * 100).toFixed(1)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500 transition-[width] duration-500" style={{ width: `${k.value * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        {showHow && (
          <div className="mt-4 animate-in space-y-2 rounded-lg bg-slate-50 p-3 text-[13px] text-slate-600">
            <p>
              Score = {components.map((k) => `${Math.round(k.weight * 100)}% × ${k.label.toLowerCase()}`).join(' + ')}.
            </p>
            <ul className="space-y-1">
              {components.map((k) => (
                <li key={k.key}>
                  <span className="font-medium text-slate-700">{k.label}:</span> {k.detail}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">Dates/numbers stored as text and spelling variants are flagged as suggestions but don't affect the score yet.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
