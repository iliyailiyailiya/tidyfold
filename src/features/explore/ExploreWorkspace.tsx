import { useEffect, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Filter, Loader2, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { useStudio } from '@/state/studio';
import { columnStats, exploreSource, histogram, missingMap, outliers, topValues, valueLabel, type ColumnStats, type Histogram, type MissingMap, type OutlierReport, type TopValues } from '@/engine/explore';
import { type ColumnFilter } from '@/engine/dataset/filters';
import type { ColumnSchema } from '@/engine/history/operations';
import type { ColumnType } from '@/engine/import/types';
import { fmt, pct } from '@/lib/utils';
import { TypeBadge } from '@/features/import/TypeBadge';

const CHART_COLORS = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)', 'var(--color-chart-5)', 'var(--color-chart-6)'];

function tile(label: string, value: string, hint?: string) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-soft">
      <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      <p className="mt-1 text-lg leading-none font-semibold text-slate-900 tabular">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function ChartFrame({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function HistogramChart({ bins, onBin }: { bins: Histogram; onBin: (from: string, to: string) => void }) {
  const data = bins.bins.map((b) => ({ label: b.label, count: b.count }));
  return (
    <div>
      <ChartFrame height={220}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-slate-200)" />
          <XAxis dataKey="label" interval="preserveStartEnd" angle={-12} textAnchor="end" height={44} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} width={40} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="count" radius={[2, 2, 0, 0]} onClick={(_data, index) => {
            const b = bins.bins[index ?? 0];
            if (b) onBin(b.from, b.to);
          }}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ChartFrame>
      <ul className="sr-only">
        {bins.bins.map((b) => (
          <li key={b.from}>
            {b.label}: {fmt(b.count)} rows
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopValuesChart({ top, onPick }: { top: TopValues; onPick: (value: string) => void }) {
  const data = top.values.map((v) => ({ value: valueLabel(v.value), count: v.count }));
  return (
    <div>
      <ChartFrame height={Math.max(180, data.length * 34)}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-slate-200)" horizontal={false} />
          <XAxis type="number" dataKey="count" allowDecimals={false} />
          <YAxis type="category" dataKey="value" width={130} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="count" fill="var(--color-chart-2)" barSize={14} onClick={(_d, index) => { const v = top.values[index ?? 0]; if (v) onPick(v.value); }} />
        </BarChart>
      </ChartFrame>
      <ul className="sr-only">
        {top.values.map((v) => (
          <li key={v.value}>
            {valueLabel(v.value)}: {fmt(v.count)} rows
          </li>
        ))}
        {top.other && <li>Other: {fmt(top.other.count)} rows</li>}
      </ul>
    </div>
  );
}

/** Whole-number fence bounds for integer columns (quartiles can be fractional). */
function fence(report: OutlierReport, type: ColumnType): { lo: string; hi: string } | null {
  if (report.lower === null || report.upper === null) return null;
  if (type === 'date' || type === 'timestamp') {
    if (!report.labels) return null;
    return { lo: report.labels.lower, hi: report.labels.upper };
  }
  const lo = type === 'integer' ? Math.ceil(report.lower) : report.lower;
  const hi = type === 'integer' ? Math.floor(report.upper) : report.upper;
  return { lo: String(lo), hi: String(hi) };
}

export function ExploreWorkspace() {
  const { session, version, read, filters, setFilters, setWorkspace, openInTransform } = useStudio();
  const schema = session?.schema ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const [stats, setStats] = useState<ColumnStats | null>(null);
  const [hist, setHist] = useState<Histogram | null>(null);
  const [top, setTop] = useState<TopValues | null>(null);
  const [outlier, setOutlier] = useState<OutlierReport | null>(null);
  const [missing, setMissing] = useState<MissingMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'chart' | 'missing'>('chart');
  const [loading, setLoading] = useState(false);

  const col: ColumnSchema | null = selected ? schema.find((c) => c.name === selected) ?? null : null;

  // Reset the inspector whenever the dataset or the current step changes.
  useEffect(() => {
    setSelected(null);
    setStats(null);
    setHist(null);
    setTop(null);
    setOutlier(null);
    setMissing(null);
    setError(null);
  }, [session, version]);

  // Load everything for the selected column through the queued read().
  useEffect(() => {
    if (!session || !col) {
      setStats(null);
      setHist(null);
      setTop(null);
      setOutlier(null);
      setError(null);
      return;
    }
    let live = true;
    setLoading(true);
    void read(async (s) => {
      const source = exploreSource(s, filters);
      const st = await columnStats(source, col.name);
      const numericish = st.type === 'integer' || st.type === 'decimal';
      const dateish = st.type === 'date' || st.type === 'timestamp';
      const [h, t, o] = await Promise.all([
        (numericish || dateish) ? histogram(source, col.name) : Promise.resolve<Histogram | null>(null),
        !numericish && !dateish ? topValues(source, col.name, 8) : Promise.resolve<TopValues | null>(null),
        numericish || dateish ? outliers(source, col.name) : Promise.resolve<OutlierReport | null>(null),
      ]);
      return { st, h, t, o };
    })
      .then((r) => {
        if (!live) return;
        setStats(r.st);
        setHist(r.h);
        setTop(r.t);
        setOutlier(r.o);
        setError(null);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [session, version, col, filters, read]);

  // The missing-values map is a whole-table tab.
  useEffect(() => {
    if (!session || tab !== 'missing') return;
    let live = true;
    setLoading(true);
    void read(async (s) => missingMap(exploreSource(s, filters)))
      .then((m) => {
        if (!live) return;
        setMissing(m);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [session, version, tab, filters, read]);

  const addFilter = (f: ColumnFilter) => setFilters((fs) => [...fs.filter((x) => x.column !== f.column), f]);

  const setRangeFilter = (column: string, from: string, to: string) => addFilter({ column, op: 'range', value: from, value2: to });

  const showInTable = (f: ColumnFilter) => {
    addFilter(f);
    setWorkspace('table');
  };

  const createFilterStep = (column: string, lo: string, hi: string) => {
    openInTransform({
      kind: 'filter_rows',
      params: { conditions: [{ column, op: 'between', value: lo, value2: hi }], match: 'all', keep: 'non-matching' },
    });
  };

  if (!session) return null;

  const isNumeric = !!col && (col.type === 'integer' || col.type === 'decimal');
  const measurable = !!col && (isNumeric || col.type === 'date' || col.type === 'timestamp');

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <BarChart3 className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Explore</h1>
          <p className="text-sm text-slate-500">Read-only statistics, distributions and outliers. Nothing here changes your data.</p>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="max-h-56 overflow-auto">
            <ul className="divide-y divide-slate-100">
              {schema.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.name)}
                    aria-pressed={selected === c.name}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${selected === c.name ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{c.name}</span>
                    <TypeBadge type={c.type} compact />
                  </button>
                </li>
              ))}
              {schema.length === 0 && <li className="px-2.5 py-3 text-[13px] text-slate-500">No columns to explore yet.</li>}
            </ul>
          </div>
        </CardContent>
      </Card>

      {col ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">{col.name}</h2>
            <TypeBadge type={col.type} />
            <span className="ml-auto text-xs text-slate-400">{loading ? 'Measuring…' : error ? 'Couldn’t load this column.' : `${fmt(stats?.rows ?? 0)} rows`}</span>
          </div>
          {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800">{error}</div>}

          {stats && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {tile('Rows', fmt(stats.rows), 'of the current view')}
              {tile('Filled', fmt(stats.filled), pct(stats.filled, stats.rows))}
              {tile('Missing', fmt(stats.missing), pct(stats.missing, stats.rows))}
              {tile('Distinct', fmt(stats.distinct), 'unique values')}
              <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-soft">
                <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Min</p>
                <p className="mt-1 text-lg leading-none font-semibold text-slate-900 tabular">{stats.min ?? '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-soft">
                <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">Max</p>
                <p className="mt-1 text-lg leading-none font-semibold text-slate-900 tabular">{stats.max ?? '—'}</p>
              </div>
              {stats.numeric && (
                <>
                  {tile('Mean', fmt(stats.numeric.mean), `median ${fmt(stats.numeric.median)}`)}
                  {tile('Median', fmt(stats.numeric.median))}
                  {tile('Spread (IQR)', `${fmt(stats.numeric.p25)} – ${fmt(stats.numeric.p75)}`, `σ ${stats.numeric.stddev === null ? '—' : fmt(stats.numeric.stddev)}`)}
                </>
              )}
              {stats.text && (
                <>
                  {tile('Shortest', `${fmt(stats.text.minLength)} chars`)}
                  {tile('Longest', `${fmt(stats.text.maxLength)} chars`)}
                  {tile('Avg length', fmt(stats.text.avgLength))}
                </>
              )}
              {stats.booleans && (
                <>
                  {tile('True', fmt(stats.booleans.trueCount))}
                  {tile('False', fmt(stats.booleans.falseCount))}
                </>
              )}
            </div>
          )}

          <Card className="mb-4">
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold">Distribution</h3>
                {hist && hist.kind === 'numeric' && <span className="text-xs text-slate-400">bin width {hist.width ?? '—'}</span>}
                {hist && hist.kind === 'date' && <span className="text-xs text-slate-400">granularity {hist.granularity}</span>}
              </div>
              {loading && (
                <div className="flex h-40 items-center justify-center text-sm text-slate-400">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Measuring…
                </div>
              )}
              {!loading && !isNumeric && !measurable && top && <TopValuesChart top={top} onPick={(v) => addFilter({ column: col.name, op: 'equals', value: v })} />}
              {!loading && hist && measurable && <HistogramChart bins={hist} onBin={(from, to) => setRangeFilter(col.name, from, to)} />}
              {!loading && !hist && !top && <p className="py-10 text-center text-sm text-slate-400">No measurable values in this view.</p>}
            </CardContent>
          </Card>

          {isNumeric && (
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[15px] font-semibold">Outliers</h3>
                  {outlier && <span className="text-xs text-slate-400">Tukey’s rule of thumb (Q1 − 1.5·IQR / Q3 + 1.5·IQR)</span>}
                </div>
                {outlier && (
                  <>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px]">
                        <p className="font-medium text-slate-700">Fences</p>
                        <p className="mt-1 tabular">lower {outlier.labels?.lower ?? outlier.lower ?? '—'} · upper {outlier.labels?.upper ?? outlier.upper ?? '—'}</p>
                        <p className="mt-1 text-slate-500">
                          Q1 {outlier.labels?.q1 ?? outlier.q1 ?? '—'} · median {outlier.labels?.median ?? outlier.median ?? '—'} · Q3 {outlier.labels?.q3 ?? outlier.q3 ?? '—'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px]">
                        <p className="font-medium text-slate-700">{fmt(outlier.count)} outlier row{outlier.count === 1 ? '' : 's'} in view</p>
                        <p className="mt-1 text-slate-500">Showing the first {Math.min(20, outlier.rows.length)}.</p>
                      </div>
                    </div>
                    {outlier.rows.length > 0 && (
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-[13px]">
                          <thead>
                            <tr className="text-left text-[11px] tracking-wide text-slate-400 uppercase">
                              <th className="py-1 pr-2 font-medium">Row</th>
                              <th className="py-1 font-medium">Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {outlier.rows.map((r) => (
                              <tr key={r.rowId} className="border-t border-slate-100">
                                <td className="py-1 pr-2 tabular text-slate-500">{fmt(r.rowId)}</td>
                                <td className="py-1 font-medium text-slate-800">{valueLabel(r.value)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {outlier && fence(outlier, col.type) && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => {
                            const f = fence(outlier, col.type)!;
                            showInTable({ column: outlier.column, op: 'outside', value: f.lo, value2: f.hi });
                          }}
                        >
                          <Table2 className="size-3.5" /> Show in Table
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            const f = fence(outlier, col.type)!;
                            createFilterStep(outlier.column, f.lo, f.hi);
                          }}
                        >
                          <Filter className="size-3.5" /> Create filter step
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {!outlier && !loading && <p className="mt-3 text-[13px] text-slate-400">Not enough data yet to flag outliers.</p>}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card className="mb-4">
          <CardContent className="p-8 text-center text-sm text-slate-500">Pick a column above to see its statistics, chart and outliers.</CardContent>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div>
            <h3 className="text-[15px] font-semibold">Missing values</h3>
            <p className="text-[13px] text-slate-500">Where empty cells sit across row bands.</p>
          </div>
          <Segmented
            label="Explore view"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'chart', label: 'Chart' },
              { value: 'missing', label: `Missing${missing ? ` (${missing.columns.length})` : ''}` },
            ]}
          />
        </div>
        <CardContent className="p-4">
          {tab === 'missing' ? (
            loading && !missing ? (
              <div className="flex h-40 items-center justify-center text-sm text-slate-400">
                <Loader2 className="mr-2 size-4 animate-spin" /> Scanning…
              </div>
            ) : !missing || missing.columns.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">No columns yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-max">
                  <div className="grid" style={{ gridTemplateColumns: `3rem repeat(${missing.columns.length}, minmax(30px, 1fr))` }}>
                    <div />
                    {missing.columns.map((c) => (
                      <div key={c} className="truncate text-center text-[10px] font-medium text-slate-400">
                        {c}
                      </div>
                    ))}
                    {missing.bands.map((b, i) => (
                      <BandRow key={i} band={b} columns={missing.columns} />
                    ))}
                  </div>
                </div>
              </div>
            )
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">Pick a column above to see its distribution.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BandRow({ band, columns }: { band: { fromRow: number; toRow: number; rows: number; missing: number[] }; columns: string[] }) {
  return (
    <>
      <div className="px-1 text-right text-[10px] text-slate-400 tabular">{band.fromRow + 1}</div>
      {columns.map((c, j) => {
        const missingCount = band.missing[j] ?? 0;
        const ratio = band.rows > 0 ? missingCount / band.rows : 0;
        return (
          <div
            key={c}
            title={`${c}: ${fmt(missingCount)} of ${fmt(band.rows)} rows`}
            className="h-5 rounded"
            style={{ background: ratio > 0 ? `color-mix(in srgb, var(--color-chart-5) ${Math.min(100, Math.round(ratio * 100))}%, white)` : 'var(--color-slate-100)' }}
          />
        );
      })}
    </>
  );
}
