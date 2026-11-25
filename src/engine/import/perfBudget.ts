/**
 * Phase 7 — perf budgets for the large-data path (200k rows, 8 cols).
 * Generous bounds: CI machines vary; the goal is regression detection, not a wall.
 */
export const PERF_BUDGETS = {
  /** Total time for a 200k-row CSV stream import (parse + batch inserts). */
  import200kMs: 30_000,
  /** Peak JS-heap delta during a 200k-row import (MB). */
  peakHeap200kMb: 400,
  /** Approximate max import size streamed before the app shows a warning. */
  hardStopBytes: 8 * 1024 * 1024,
} as const;
