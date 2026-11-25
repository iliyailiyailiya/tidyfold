import type { ColumnType } from '../import/types';

export interface NumericStats {
  mean: number;
  median: number;
  p25: number;
  p75: number;
  stddev: number | null;
  /** min/max are ColumnStats.min/max; span = max − min, iqr = Q3 − Q1 (may be 0). */
  span: number;
  iqr: number;
}

export interface TextStats {
  minLength: number;
  maxLength: number;
  avgLength: number;
}

export interface BooleanStats {
  trueCount: number;
  falseCount: number;
}

export interface ColumnStats {
  column: string;
  type: ColumnType;
  rows: number;
  filled: number;
  /** null or whitespace-only for text. */
  missing: number;
  distinct: number;
  min: string | null;
  max: string | null;
  numeric: NumericStats | null;
  text: TextStats | null;
  booleans: BooleanStats | null;
  elapsedMs: number;
}

export interface HistogramBin {
  /** Inclusive lower bound, serialised for a filter. */
  from: string;
  /** Exclusive upper bound. */
  to: string;
  label: string;
  count: number;
}

export interface NumericHistogram {
  kind: 'numeric';
  bins: HistogramBin[];
  min: number | null;
  max: number | null;
  width: number | null;
}

export type DateGranularity = 'day' | 'week' | 'month' | 'year';

export interface DateHistogram {
  kind: 'date';
  bins: HistogramBin[];
  granularity: DateGranularity;
}

export type Histogram = NumericHistogram | DateHistogram;

export interface TopValues {
  values: { value: string; count: number }[];
  /** Values outside the shown top list, if any. */
  other: { values: number; count: number } | null;
  distinct: number;
  /** Non-missing rows considered. */
  total: number;
}

export interface MissingBand {
  /** Original row ids covered by this band. */
  fromRow: number;
  toRow: number;
  rows: number;
  /** Missing count for each column, in schema order. */
  missing: number[];
}

export interface MissingMap {
  columns: string[];
  bands: MissingBand[];
  rows: number;
}

export interface OutlierRow {
  rowId: number;
  value: string;
}

export interface OutlierReport {
  column: string;
  q1: number | null;
  median: number | null;
  q3: number | null;
  lower: number | null;
  upper: number | null;
  count: number;
  rows: OutlierRow[];
  /** Formatted quartile/fence labels; present for date/timestamp columns. */
  labels?: { q1: string; median: string; q3: string; lower: string; upper: string };
}
