/**
 * Phase 6 — “Clean Everything”: a pure batch of suggested steps.
 *
 * Only safe, always-correct operations are built:
 * - trim, exact-fingerprint spelling merges (review/reject), date & number
 *   normalisation — all reusable as `trim_whitespace`, `merge_values`,
 *   `standardize_dates`, `normalize_numbers`;
 * - `remove_duplicates` (exact repeats, like the one-click suggestion);
 * - no fuzzy/ambiguous suggestions (they need the review flow of the
 *   spelling panel; no type conversions — none are proven to fit every dataset).
 */
import { clusterValues } from '../cluster/cluster';
import { DEFAULT_NORMALIZE } from '../cluster/normalize';
import { dedupeNames } from './dedupeNames';
import type { OperationSpec } from '../history/operations';
import type { ColumnProfile, DatasetProfile } from '../dataset/profile';

export interface CleanPlanItem {
  /** The operation that will be applied when the step is confirmed. */
  spec: OperationSpec;
  /** Human-readable preview shown in the review list. */
  preview: string;
}

export interface CleanPlan {
  /** One entry per suggested step; empty when the data is already tidy. */
  items: CleanPlanItem[];
  /** Number of untrimmed text cells across the datasets (for the summary line). */
  untrimmedCells: number;
}

export function planCleanEverything(profile: DatasetProfile, opts?: { limitPerKind?: number }): CleanPlan {
  const items: CleanPlanItem[] = [];
  const untrimmedCells = profile.columns.reduce((s, c) => s + (c.untrimmed ?? 0), 0);
  const maxPerKind = opts?.limitPerKind ?? 20;

  // 1. Trim stray spaces (one step covering every column).
  const toTrim = profile.columns.filter((c) => (c.untrimmed ?? 0) > 0);
  if (toTrim.length > 0) {
    const cols = dedupeNames(toTrim.map((c) => c.name));
    items.push({
      spec: { kind: 'trim_whitespace', params: { columns: cols } },
      preview: `Remove leading/trailing spaces from ${cols.length} column${cols.length === 1 ? '' : 's'} (about ${untrimmedCells.toLocaleString()} cells)`,
    });
  }

  // 2. Exact-fingerprint spelling variants (review; “reject” in the review
  //    screen just removes the item — nothing is merged without approval).
  for (const c of profile.columns) {
    if (c.type !== 'text') continue;
    const missing = profile.rows - c.missing;
    if (c.variants > 0 && c.distinct <= Math.max(50, missing * 0.5)) {
      const r = variantMerges(c, maxPerKind);
      if (r.merges.length > 0) {
        const n = r.merges.reduce((s, m) => s + m.from.length - 1, 0);
        items.push({
          spec: { kind: 'merge_values', params: { column: c.name, merges: r.merges } },
          preview: `Merge ${n} spelling variation${n === 1 ? '' : 's'} in “${c.name}” (≈${r.rows.toLocaleString()} cells)`,
        });
      }
    }
  }

  // 3. Date / number normalisation — only when the text column is clearly
  //    mostly dates/numbers (same thresholds as the Overview suggestions).
  for (const c of profile.columns) {
    if (c.type !== 'text') continue;
    const filled = profile.rows - c.missing;
    if (c.dateLike >= 3 && c.dateLike >= filled * 0.5) {
      items.push({
        spec: { kind: 'standardize_dates', params: { column: c.name, order: 'DMY' } },
        preview: `Rewrite ${c.dateLike.toLocaleString()} dates in “${c.name}” as YYYY-MM-DD`,
      });
    }
    if (c.numberLike >= 3 && c.numberLike >= filled * 0.5) {
      items.push({
        spec: { kind: 'normalize_numbers', params: { column: c.name, decimal: '.' } },
        preview: `Normalise ${c.numberLike.toLocaleString()} numbers in “${c.name}” (currency, separators → plain numbers)`,
      });
    }
  }

  // 4. Exact duplicate rows (first occurrence kept — the same semantics as
  //    the Overview one-click suggestion).
  if (profile.duplicateRows > 0) {
    items.push({
      spec: { kind: 'remove_duplicates', params: { columns: [] } },
      preview: `Remove ${profile.duplicateRows.toLocaleString()} duplicate row${profile.duplicateRows === 1 ? '' : 's'} (first occurrence kept)`,
    });
  }

  return { items, untrimmedCells };
}

/**
 * Groups a column's distinct values by fingerprint (exact groups only) and
 * builds `merge_values` params: { from: [alternate spellings…], to: target }.
 * A single-member group is never included — nothing to merge.
 */
function variantMerges(
  col: ColumnProfile,
  maxMerges: number,
): { merges: { from: string[]; to: string }[]; rows: number } {
  const values = col.top; // top values first — most-frequent groups become targets
  if (values.length === 0) return { merges: [], rows: 0 };
  const { clusters } = clusterValues(values, { normalize: DEFAULT_NORMALIZE, threshold: 1 });
  const merges: { from: string[]; to: string }[] = [];
  let rows = 0;
  for (const cl of clusters) {
    const nonTargets = cl.members.filter((m) => m.value !== cl.suggested);
    if (nonTargets.length === 0) continue;
    const from = dedupeNames([...nonTargets.map((m) => m.value), ...merges.flatMap((m) => m.from)]);
    if (from.length === 0) continue;
    merges.push({ from, to: cl.suggested });
    rows += nonTargets.reduce((s, m) => s + m.count, 0);
    if (merges.length >= maxMerges) break;
  }
  return { merges, rows };
}
