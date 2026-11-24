/**
 * Phase 6 — column-name uniqueness helper (no case-collisions, dedupes within a list).
 */
export type PlanNameFn = (base: string, n: number) => string;

/**
 * Returns `names` made unique per the engine's case-insensitive rules
 * (column names compare lowercase); never returns an empty or repeated name.
 */
export function dedupeNames(names: string[], used: string[] = [], nameFn: PlanNameFn = defaultName): string[] {
  const taken = new Set(used.map((n) => n.toLowerCase()));
  const out: string[] = [];
  for (const raw of names) {
    let n = nameFn(raw.trim(), 0);
    let i = 0;
    while (n === '' || taken.has(n.toLowerCase())) n = nameFn(raw.trim(), ++i);
    out.push(n);
    taken.add(n.toLowerCase());
  }
  return out;
}

/** Default planner: `city`, `city_2`, `city_3`… */
export const defaultName: PlanNameFn = (base, n) => (n === 0 ? base : base === '' ? `col_${n + 1}` : `${base}_${n + 1}`);
