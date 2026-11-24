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
- Tests: **193 passing** (173 after Phase 4, plus 18 bulk-edit and 2 shared
  change-helper tests) via `npm test`.
- TypeScript: `npx tsc -b` passes.
- Browser verification: **done** (all Transform tools, undo, export,
  console/network, 390 px layout, keyboard focus).
- Production build/preview: **done** (CSP header present, no console errors,
  no external requests).
- README / ARCHITECTURE docs: **updated**.
- Bulk editing: **done** — recorded `bulk_edit` operation, recipe validation,
  preview diagnostics, UI under Transform → Bulk edit, tests, docs, browser
  checks (trim, replace, conditional case, clear across types, undo, export,
  390 px layout).
- Push / deploy / live verification: **done** for Phase 4; repeated after bulk
  editing.
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
- `src/features/shared/changes.ts` — `hasPreviewChanges`, shared by Transform and
  Clean.
- `tests/bulk-edit.test.ts` — 18 bulk-edit tests (actions, conditions, recipe,
  undo/redo, preview).
- `tests/changes.test.ts` — 2 shared change-helper tests.

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

## A1–A2 review results

- **A1 shared change rule:** `src/features/shared/changes.ts` exports
  `hasPreviewChanges(pv)`. Transform and Clean both use it, so an identical-
  looking type conversion counts as a change in both. Covered by
  `tests/changes.test.ts` and a Clean browser check (`order_id` whole number →
  text: preview says it becomes text, Apply enabled, Table shows Text, Undo).
- **A2.1 calculated columns:** `compileCalc` only emits SQL through `ident()` /
  `literal()`; recipes validate every node with `isCalcNode`. Phase 4 tests
  cover malicious column names and text literals.
- **A2.2 group + history:** undo, redo, remove-step and recipe replay across a
  group step are covered; removing a step the group depends on is refused as a
  normal validation error during rebuild, not a crash.
- **A2.3 step-retention cap:** covered by the existing jump-back-past-a-group
  test; rebuilding from a checkpoint returns identical data.
- **A2.4 regex extract:** invalid patterns show friendly messages; RE2 cannot
  catastrophically backtrack.
- **A2.5 filter numbers/dates:** `filterConditionSql` now rejects reversed
  `between` bounds with “The lower bound … is after the upper bound …” and a
  missing upper bound. Shared with bulk-edit row conditions.
- **A2.6 mobile:** rechecked after the shared-helper change; 390 px viewport has
  no page-level sideways scroll.

## Bulk editing

- New operation `bulk_edit` with `{ columns, action, conditions, match }`.
- Actions: `trim` (optional inner-space collapse), `case`, `replace` (literal or
  RE2 pattern with `\1` capture replacements), `affix` (start/end),
  `fill_empty`, `clear`.
- Text actions reject non-text columns at compile time. `clear` accepts every
  type and emits `CAST(NULL AS <type>)` so column types never drift.
- Row conditions reuse `filterConditionSql` from `filter_rows`; the preview
  reports how many rows match.
- UI: Transform → Bulk edit, with column-name search, type filter, “Select
  shown”, chips, action form, optional row-condition editor extracted from
  Filter rows, and the normal live preview/Apply/Undo.
- Browser checked: trim 6 text columns → 83 cells; replace in one column → 55
  cells; lowercase only Berlin rows → 33 cells with “33 rows of 252 rows match”;
  clear city + quantity → 494 cells with a clear warning, applied to every type,
  Undo restored; export after edits contains the expected columns; console and
  network clean; 390 px iframe has no page sideways scroll.

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
- Regex find-and-replace exists in Bulk edit and Extract, but not in Clean’s
  Replace values tool.
- Bulk edit chooses concrete column names; it does not store a “name pattern”
  rule. The UI can select by name search/type, but later-added columns are not
  picked up automatically.
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

## Phase 5 — Explore workspace (added after Phase 4)

Started and shipped in this session:

- Engine: `src/engine/explore/` (source, stats, histogram, topValues, missingMap,
  outliers, types, barrel) plus the shared view-filter layer
  `src/engine/dataset/filters.ts` (`ColumnFilter` with `contains` / `equals` /
  `blank` / `notBlank` / `range` / `outside`, `filterSql`, `filterWhereSql`,
  `describeFilter`). `DatasetSession.page()` now consumes the shared layer, so
  view filters and range/between filters share one SQL builder.
- Tests: `tests/phase5.test.ts` (19 tests) against real DuckDB — stats, bins,
  dates, top values, missing map bands, outliers, empty views, view filters.
  Full suite: **212 tests passing** (was 193).
- Charts: Recharts pinned exactly (`recharts@3.11.1`, added to `package.json`);
  palette tokens `--color-chart-1..6` added in `src/index.css`. CSP already
  allows inline styles (`style-src 'self' 'unsafe-inline'`) and Recharts needs no
  eval/connect; production build verified.
- UI: `src/features/explore/ExploreWorkspace.tsx` — column picker, stat tiles,
  distribution chart (numeric bins / date timeline / top values), outliers panel
  with “Show in Table” (adds view filter) and “Create filter step” (opens
  Transform’s `filter_rows` prefilled, keep = non-matching), missing-values map
  tab (50-band heatmap).
- Shared state: view filters lifted into `studio.tsx` (`filters` / `setFilters`)
  so Table and Explore share them; Transform got `transformDraft` /
  `openInTransform` so Explore can hand off a recorded filter step.

## Phase 5 status

- ✅ `npx tsc -b && npm test` (212 tests), production build verified with Recharts.
- ✅ Browser-verified on dev server (`:5199`): sample imported, Explore opened,
  numeric column picked, stats/bins/outliers rendered, Recharts SVG drew bars,
  no console errors; “Create filter step” handed off to Transform with
  `is between` `-3`…`13` / keep non-matching prefilled.
- ⬜ Commit / push / `npx wrangler deploy` / live verification of Phase 5.
