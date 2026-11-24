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
- Transform workspace UI: **done** (commit `1ce4567`), plus preview-keying and
  formula-root fixes (commit `5332f37`).
- “Convert type” whose displayed values stay identical (e.g. whole number →
  text) now previews and applies as a real change.
- Tests: **173 passing** (147 baseline + 26 Phase 4) via `npm test`.
- TypeScript: `npx tsc -b` passes.
- Browser verification: **done** (all Transform tools, undo, export,
  console/network, 390 px layout, keyboard focus).
- Production build/preview: **done** (CSP header present, no console errors,
  no external requests).
- README / ARCHITECTURE docs: **updated**.
- Push / deploy / live verification: **done**.
  - https://tidyfold.b7nsm548rh.workers.dev — sample import, Transform tools,
    live preview; no console errors; no external requests.
  - https://iliyailiyailiya.github.io/tidyfold/ — same checks; split preview
    reported 2 new columns.

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
- [x] Group & summarise: `city`, `count` summary; “252 rows → 11 rows” and the
  first result rows; Apply, then Undo.
- [x] Reorder columns with the up/down buttons; Apply, Undo.
- [x] Rename column; duplicate-name error shown and Apply disabled; Apply, Undo.
- [x] Remove column; header goes 11 → 10 columns; Apply, Undo.
- [x] Convert type: `paid` → text; preview now says it will be stored as text;
  Apply, Table shows the new type, Undo.
- [x] Export after a transform (CSV contains the new split columns).
- [x] No console errors.
- [x] No network requests beyond the app's own files.
- [x] Phone width (390 px iframe): document width 390, no sideways page
  scroll; the tool list scrolls horizontally (1438 px of content).
- [x] Keyboard: tab through nav, header actions and workspace controls; every
  stop has a visible focus ring.

Then:

- [x] `npm run build && npm run preview`; imported the sample, split a column,
  console/network clean, CSP header present.
- [x] Update `README.md` (“what works”, Transform is shipped).
- [x] Update `docs/ARCHITECTURE.md` (roadmap row 4 ✅; AST and preview notes).
- [x] Commit docs + remaining UI fixes.
- [x] `git push` (GitHub Pages workflow).
- [x] `npx wrangler deploy`; no edits to `vite.config.ts` or `package.json`.
- [x] Open https://tidyfold.b7nsm548rh.workers.dev and
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
