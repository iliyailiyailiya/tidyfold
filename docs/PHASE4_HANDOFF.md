# Phase 4 handoff — Transform workspace

Last updated: 2026-11-24

This file is the resumable status log for Phase 4. Read it before continuing.
Commits and tests are the source of truth for finished work; this file records
the in-progress browser checks, decisions, and remaining steps.

## Goal

Implement Phase 4 exactly as specified in `PHASE4_PROMPT.md`, then update docs,
push, deploy to Cloudflare, and verify both live URLs.

## Current status

- Engine: **done** (commit `0be4d07`).
- Shared form/preview components: **done** (commit `a00a005`).
- Transform workspace UI: **done** (commit `1ce4567`).
- Tests: **172 passing** (147 baseline + 25 Phase 4) via `npm test`.
- TypeScript: `npx tsc -b` passes.
- Browser verification: **in progress** (see checklist below).
- Production build/preview: **not started**.
- README / ARCHITECTURE docs: **not updated yet**.
- Push / deploy / live verification: **not started**.

## Uncommitted work at the time of writing

- `src/features/transform/TransformWorkspace.tsx`
  - Preview is now keyed to the exact current spec, so switching tools can
    never show or apply a preview from the previous form.
- `src/features/transform/CalcBuilder.tsx`
  - “Start with” now shows the left-most/root column even when the formula is
    nested. Choosing another column replaces the whole formula.

Run `npx tsc -b && npm test` after these, then commit them.

## Files created

- `src/engine/history/errors.ts` — `OperationError`, split out to avoid a
  runtime cycle with `expression.ts`.
- `src/engine/history/expression.ts` — typed `CalcNode` AST, `isCalcNode`,
  `compileCalc`, `describeCalc`, `validateRegex`.
- `src/features/shared/form.tsx` — `Row`, `ColumnPicker`, `ColumnChecklist`,
  `Chip`.
- `src/features/shared/preview.tsx` — `PreviewSummary`, `Note`, `Value`,
  `PreviewDiff`; handles added columns and reshaped results.
- `src/features/transform/tools.ts` — Transform tool definitions.
- `src/features/transform/TransformForm.tsx` — forms for all Transform tools.
- `src/features/transform/CalcBuilder.tsx` — visual formula builder.
- `src/features/transform/TransformWorkspace.tsx` — workspace shell.
- `tests/phase4.test.ts` — 25 Phase 4 tests against real DuckDB.

## Files modified

- `src/engine/history/operations.ts` — new operation kinds, nullable sources,
  new-column name validation, `extractPattern`, reshaped/reordered flags.
- `src/engine/history/recipe.ts` — validation for all new kinds and the Calc AST.
- `src/engine/dataset/preview.ts` — `addedColumns`, `resultRows`, `reshaped`,
  `reordered`; row-reshaping previews; better email/regex diagnostics.
- `src/features/clean/CleanWorkspace.tsx` and `src/features/clean/tools.tsx`
  — use the shared components.
- `src/components/layout/AppShell.tsx` — Transform is `ready: true` and routed
  to `TransformWorkspace`; Explore remains planned.
- `src/features/workspaces/PlannedWorkspace.tsx` — only Explore remains.

## Browser verification checklist

Dev server: `npm run dev` → http://localhost:5173/

Sample dataset: “Try it with a messy sample dataset” → “Import data”.

Verified in the app:

- [x] Split `customer` on a space → added `customer_1` / `customer_2`, warning
  for extra parts, Apply, Undo.
- [x] Join `customer` + `city` → added `joined`, Apply, Undo.
- [x] Extract `^\\w+` from `customer` → added `extracted`, Apply, Undo.
- [x] Calculate `unit_price × quantity`, rounded to 2 decimals → formula
  sentence, result type, sample values, Apply, Undo.
- [x] Filter `city equals Berlin` → 219 removed rows shown, Apply, Undo.

Still to verify:

- [ ] Group & summarise: choose `city`, add `count` and `sum` summaries; check
  “N rows → M rows” and the first result rows; Apply, then Undo.
- [ ] Reorder columns with the up/down buttons; Apply, Undo.
- [ ] Rename column; Apply, Undo.
- [ ] Remove column; Apply, Undo.
- [ ] Convert type; Apply, Undo.
- [ ] Export after a transform (CSV at minimum).
- [ ] No console errors.
- [ ] No network requests beyond the app's own files.
- [ ] Phone width: no sideways page scroll; tool list scrolls horizontally.
- [ ] Keyboard: tab through tool list, form controls, Apply; visible focus.

Then:

- [ ] `npm run build && npm run preview`; import the sample, run one transform,
  quick check console/network/CSP.
- [ ] Update `README.md` (“what works”, Transform is shipped).
- [ ] Update `docs/ARCHITECTURE.md` (roadmap row 4 ✅; AST and preview notes).
- [ ] Commit docs + remaining UI fixes.
- [ ] `git push` (GitHub Pages workflow).
- [ ] `npx wrangler deploy`; if wrangler rewrites `vite.config.ts` or
  `package.json`, revert those edits.
- [ ] Open https://tidyfold.b7nsm548rh.workers.dev and
  https://iliyailiyailiya.github.io/tidyfold/ and confirm Transform works.

## Decisions / gotchas

- `CompiledOperation.sources` is `(string | null)[]`; `null` means a brand-new
  column. Preview shows those under “New columns · Before = new column”.
- `group_aggregate` sets `reshapesRows: true`; preview skips the `__row` diff
  and shows `rowsBefore → rowsAfter` plus first 20 result rows.
- `reorder_columns` sets `reordered: true`; preview says only order changed.
- `filter_rows` preview intentionally reports the count of rows removed from
  the current table; with `keep: 'matching'` that is `rows - matches`.
- Text equality in `filter_rows` must compare the column to a SQL literal, not
  `CAST(column AS VARCHAR)`. DuckDB otherwise compares the column to itself.
- `preview.ts` uses quoted CTE aliases `__tf_new` / `__tf_old`; a user column
  can legitimately be called `n` or `o`.
- `CalcBuilder` emits `lastEmitted` so external expression changes (undo/replay)
  reset the builder, but its own nested steps do not.
- `src/engine/**` must not import React; no `any`; strict TS with
  `noUncheckedIndexedAccess`.
- No new dependencies. No network calls or analytics. Do not loosen CSP.

## Known limitations (for the final report)

- No email/format validation in “Suggested fixes”; it only checks trim,
  duplicates, spelling variants, date-like text, and number-like text.
- No generic multi-column/conditional bulk editing yet. Existing bulk-ish
  tools: `trim_whitespace` accepts many columns; replace/case/type are per
  column; Transform has split/join/extract/calc/filter/group/reorder.
- Regex transform is extraction only; there is no regex find-and-replace.
- `group_aggregate` intentionally replaces the row set; undo restores it.
- The Table’s quick filters remain view-only; Transform’s `filter_rows` is the
  recorded version.

## Requested next feature (after Phase 4 ships)

User wants **bulk data editing** — not email-specific. Interpret as:

- select target columns by name pattern and/or type (all text, all numbers,
  “name contains …”);
- apply a recorded edit across the selected columns (trim, case, find/replace,
  possibly regex replace);
- optionally apply only to rows matching conditions;
- every action must be a JSON operation with compile/describe/recipe/preview
  support and tests, consistent with Phase 4.

Do this only after Phase 4 is pushed/deployed and verified.
