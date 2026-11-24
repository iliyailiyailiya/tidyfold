import { ident } from '../duckdb/sql';
import { exploreColumn, exploreWhere, type ExploreSource } from './source';
import type { DateGranularity, Histogram, HistogramBin } from './types';

const TARGET_BINS = 20;
const MAX_BINS = 60;
const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const num = (v: unknown): number => Number(v ?? 0);
const round = (n: number, digits = 10): number => Math.round(n * 10 ** digits) / 10 ** digits;

function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${round(n / 1_000_000, 1)}M`;
  if (abs >= 10_000) return `${round(n / 1000, 1)}k`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** A “nice” step: 1, 2, 2.5, 5 or 10 times a power of ten. */
function niceStep(raw: number, integer: boolean): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const base = 10 ** Math.floor(Math.log10(raw));
  const f = raw / base;
  if (integer) {
    const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return Math.max(1, round(m * base));
  }
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return round(m * base);
}

async function numericHistogram(source: ExploreSource, name: string, columnType: 'integer' | 'decimal'): Promise<Histogram> {
  const c = ident(name);
  const [row] = await source.db.query<{ lo: number | null; hi: number | null; n: number }>(
    `SELECT CAST(min(${c}) AS DOUBLE) AS lo, CAST(max(${c}) AS DOUBLE) AS hi, count(${c}) AS n FROM ${ident(source.table)} ${exploreWhere(source)}`,
  );
  const n = num(row?.n);
  if (n === 0 || row?.lo === null || row?.lo === undefined || row?.hi === null || row?.hi === undefined) {
    return { kind: 'numeric', bins: [], min: null, max: null, width: null };
  }
  const lo = Number(row.lo);
  const hi = Number(row.hi);
  const integer = columnType === 'integer';

  if (lo === hi) {
    const width = integer ? 1 : niceStep(Math.abs(lo) * 0.1 || 0.01, false);
    return {
      kind: 'numeric',
      bins: [{ from: String(lo), to: String(round(lo + width)), label: formatNumber(lo), count: n }],
      min: lo,
      max: hi,
      width,
    };
  }

  let width = niceStep((hi - lo) / TARGET_BINS, integer);
  let start = round(Math.floor(lo / width) * width);
  let bins = Math.floor(round(hi - start) / width) + 1;
  while (bins > MAX_BINS) {
    width = niceStep(width * 1.5, integer);
    start = round(Math.floor(lo / width) * width);
    bins = Math.floor(round(hi - start) / width) + 1;
  }

  const counts = await source.db.query<{ i: number; n: number }>(
    `SELECT CAST(LEAST(GREATEST(FLOOR((CAST(${c} AS DOUBLE) - ${start}) / ${width}), 0), ${bins - 1}) AS INTEGER) AS i, count(*) AS n
     FROM ${ident(source.table)} ${exploreWhere(source, `${c} IS NOT NULL`)}
     GROUP BY 1 ORDER BY 1`,
  );
  const byBin = new Map(counts.map((r) => [Number(r.i), num(r.n)]));
  const out: HistogramBin[] = [];
  for (let i = 0; i < bins; i++) {
    const from = round(start + i * width);
    const to = round(start + (i + 1) * width);
    out.push({ from: String(from), to: String(to), label: `${formatNumber(from)}–${formatNumber(to)}`, count: byBin.get(i) ?? 0 });
  }
  return { kind: 'numeric', bins: out, min: lo, max: hi, width };
}

function parseDate(value: string): Date {
  const iso = value.trim().replace(' ', 'T');
  const withTime = /T\d/.test(iso) ? iso : `${iso}T00:00:00`;
  return new Date(withTime.endsWith('Z') ? withTime : `${withTime}Z`);
}

function truncate(date: Date, granularity: DateGranularity): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  if (granularity === 'year') return new Date(Date.UTC(y, 0, 1));
  if (granularity === 'month') return new Date(Date.UTC(y, m, 1));
  if (granularity === 'day') return new Date(Date.UTC(y, m, d));
  // Monday-based weeks, matching DuckDB's date_trunc('week', …).
  return new Date(Date.UTC(y, m, d) - ((date.getUTCDay() + 6) % 7) * DAY);
}

function step(date: Date, granularity: DateGranularity): Date {
  if (granularity === 'day') return new Date(date.getTime() + DAY);
  if (granularity === 'week') return new Date(date.getTime() + 7 * DAY);
  if (granularity === 'month') return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return new Date(Date.UTC(date.getUTCFullYear() + 1, 0, 1));
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

function binBoundary(d: Date, type: 'date' | 'timestamp'): string {
  return type === 'timestamp' ? `${isoDay(d)} 00:00:00` : isoDay(d);
}

function labelFor(d: Date, granularity: DateGranularity): string {
  const day = d.getUTCDate();
  const month = MONTHS[d.getUTCMonth()]!;
  const year = d.getUTCFullYear();
  if (granularity === 'day') return `${day} ${month} ${year}`;
  if (granularity === 'week') return `Week of ${day} ${month} ${year}`;
  if (granularity === 'month') return `${month} ${year}`;
  return String(year);
}

async function dateHistogram(source: ExploreSource, name: string, type: 'date' | 'timestamp'): Promise<Histogram> {
  const c = ident(name);
  const [row] = await source.db.query<{ lo: string | null; hi: string | null; n: number }>(
    `SELECT CAST(min(${c}) AS VARCHAR) AS lo, CAST(max(${c}) AS VARCHAR) AS hi, count(${c}) AS n FROM ${ident(source.table)} ${exploreWhere(source)}`,
  );
  const n = num(row?.n);
  if (n === 0 || !row?.lo || !row?.hi) return { kind: 'date', bins: [], granularity: 'day' };

  const lo = parseDate(row.lo);
  const hi = parseDate(row.hi);
  const span = (hi.getTime() - lo.getTime()) / DAY;
  const granularity: DateGranularity = span <= 31 ? 'day' : span <= 180 ? 'week' : span <= 1825 ? 'month' : 'year';

  const unit = granularity === 'week' ? 'week' : granularity;
  const counts = await source.db.query<{ b: string; n: number }>(
    `SELECT strftime(date_trunc('${unit}', ${c}), '%Y-%m-%d') AS b, count(*) AS n
     FROM ${ident(source.table)} ${exploreWhere(source, `${c} IS NOT NULL`)}
     GROUP BY 1 ORDER BY 1`,
  );
  const byKey = new Map(counts.map((r) => [r.b, num(r.n)]));

  const bins: HistogramBin[] = [];
  const last = truncate(hi, granularity);
  for (let cursor = truncate(lo, granularity), guard = 0; cursor <= last && guard < 500; cursor = step(cursor, granularity), guard++) {
    const next = step(cursor, granularity);
    bins.push({
      from: binBoundary(cursor, type),
      to: binBoundary(next, type),
      label: labelFor(cursor, granularity),
      count: byKey.get(isoDay(cursor)) ?? 0,
    });
  }
  return { kind: 'date', bins, granularity };
}

/** Numeric bins or a date timeline, chosen from the column type. */
export async function histogram(source: ExploreSource, name: string): Promise<Histogram> {
  const column = exploreColumn(source, name);
  if (column.type === 'integer' || column.type === 'decimal') return numericHistogram(source, name, column.type);
  if (column.type === 'date' || column.type === 'timestamp') return dateHistogram(source, name, column.type);
  throw new Error(`“${name}” is text, so it uses a frequency chart instead.`);
}
