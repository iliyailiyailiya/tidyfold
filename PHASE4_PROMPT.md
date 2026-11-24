# Prompt: Tidyfold Phase 4 (Transform workspace)

You are continuing **Tidyfold**, a privacy-first, browser-only data cleaning studio (an approachable OpenRefine alternative). Phases 0–3 are done and deployed. Your job is **Phase 4: the Transform workspace**.

## First, get oriented (do this before writing code)

1. Run `npm install`, then `npm test` (expect 147 passing) and `npx tsc -b` (expect no errors).
2. Read `docs/ARCHITECTURE.md` and `README.md`.
3. Read these files to learn the patterns you must follow:
   - `src/engine/history/operations.ts`: every operation kind, `compileOperation` (spec + input schema → `SELECT` over the previous step), `describeOperation`, helpers `mapColumn`, `requireColumn`, `requireText`, `convertSql`
   - `src/engine/history/recipe.ts`: recipe validation for every kind (new kinds must be added here)
   - `src/engine/dataset/session.ts`: history steps as DuckDB tables, `transition()` (atomic, rolls back on failure), `preview()`
   - `src/engine/dataset/preview.ts`: before/after diff by `__row`, `diagnose()` for per-operation warnings
   - `src/features/clean/CleanWorkspace.tsx` + `tools.tsx`: the tool list, forms, live preview and Apply UI to reuse
   - `src/features/workspaces/PlannedWorkspace.tsx`: the current "Transform: soon" placeholder you'll replace
   - `tests/phase2.test.ts`, `tests/phase3.test.ts`: test style (real DuckDB-WASM via `tests/helpers/nodeDb.ts`)

## Non-negotiable rules

- **Privacy:** all processing stays in the browser. No network calls, no new external services, no analytics. Don't loosen the CSP in `vite.config.ts` / `public/_headers`.
- **Never silently lose data.** If an operation can't be done exactly (bad cast, ambiguous split), it must fail with a clear message naming example values, or leave those values unchanged and say so in the preview. Follow `change_type`'s strict approach.
- **Every change is a recorded operation:** plain JSON spec, `compileOperation` case, `describeOperation` text, recipe validation, tests. The original `source` table is never modified.
- Every new operation must work with the existing preview (`compiled.sources` maps each output column to its input column; new columns need a sensible mapping, see below).
- TypeScript strict mode; no `any`. Engine code (`src/engine/**`) must not import React.
- No new dependencies unless truly necessary (DuckDB SQL covers almost everything; Arquero is not needed).
- Never present unfinished features as working; keep "planned" labels honest.
- Work in small commits. Run `npx tsc -b && npm test` before each commit.

## Preview support for new/removed columns and row changes

`preview.ts` currently diffs columns that map to an input column via `compiled.sources`, and handles removed rows. Phase 4 adds operations that **create columns** and **change the row set entirely** (group-by). Extend it:
- Allow `sources[i]` to be `null` for a brand-new column. Preview should report `addedColumns` and show sample values for them (Before = "new column").
- For row-reshaping ops (group/aggregate), skip the cell diff and instead show "N rows → M rows" plus the first ~20 result rows.
- Update the Clean/Transform preview UI to display these.

## Phase 4 scope: new operations

Add these `OperationSpec` kinds (names are suggestions; keep the style):

1. **`split_column`** `{ column, by: 'delimiter' | 'position', delimiter?, positions?, maxParts, names?: string[], keepOriginal }`: split text into new columns. Values with fewer parts get empty cells; values with more parts than `maxParts` keep the rest in the last part (no data loss). Preview warns how many rows had more or fewer parts.
2. **`merge_columns`** `{ columns: string[], separator, into, skipEmpty, keepOriginals }`: join columns into one text column.
3. **`extract_text`** `{ column, mode: 'regex' | 'before' | 'after' | 'between', pattern?, start?, end?, into, matchCase }`: pull part of a value into a new column. Non-matches give empty cells and the preview counts them. Validate regexes before running (RE2 syntax) and show a friendly error.
4. **`calculated_column`** `{ into, expression: CalcNode }`: a new column from a **visual expression builder, not free SQL**. Define a small typed AST (column ref, number/text literal, + − × ÷, concat, round, upper/lower, if-empty-then, date part/year/month, days between dates) and compile it to SQL with `ident()`/`literal()` only. Never accept raw SQL from the user. Type-check the AST against the schema and reject mismatches with a clear message. Division by zero gives an empty cell (`NULLIF`), and the preview says how many.
5. **`filter_rows`** `{ conditions: { column, op, value? }[], match: 'all' | 'any', keep: 'matching' | 'non-matching' }`: a *recorded* row filter (different from the Table's view-only filter). Ops: equals, not equals, contains, starts with, is empty, is not empty, >, <, between (numbers/dates). Preview shows removed rows (already supported).
6. **`group_aggregate`** `{ by: string[], aggregations: { column?, fn: 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max' | 'first', as }[] }`: reshapes the table. The output needs a fresh `__row` (row_number over the group keys, ordered by first occurrence). Make the UI explicit that this replaces the table's rows, and that undo goes back.
7. Move **rename**, **remove column** and **convert type** into Transform as well (they can stay in Clean / the column menu too).
8. **Reorder columns** (`reorder_columns { order: string[] }`) via drag or up/down buttons.

For every new-column op: reject names that are empty, `__row`, or already exist (case-insensitive), like `rename_column` does.

## UI: Transform workspace

- New `src/features/transform/TransformWorkspace.tsx`, built like `CleanWorkspace` (tool list on the left; form + live debounced preview + Apply on the right). Reuse `Segmented`, `Select`, `Input`, `Switch`, `Menu`, `Dialog` and the preview components; extract shared pieces from `CleanWorkspace` into `src/features/shared/` rather than copying them.
- Wire it into `AppShell.tsx` (set Transform `ready: true`) and remove Transform from `PlannedWorkspace`.
- Calculated column: a beginner-friendly builder (pick column → pick operation → pick column/value; nested steps allowed) with a live formula sentence ("price × quantity, rounded to 2 decimals") and a sample of results.
- Group & aggregate: choose group-by columns as chips, then add summaries ("Sum of total as total_sum").
- Keyboard accessible, works at phone width (no sideways scroll), light theme, same visual language.

## Tests (required)

Add `tests/phase4.test.ts` against real DuckDB (copy the `load()` helper style), covering at least:
- each operation's happy path and its validation errors
- split with too many/too few parts (nothing lost), quoted delimiters, regex extract with invalid pattern
- calculated column: type errors, divide by zero → empty, nested expressions, no SQL injection via column names or literals (e.g. a column named `a"; DROP TABLE x; --`)
- filter_rows all/any/keep non-matching; group_aggregate correctness and a fresh `__row`
- preview: added columns, row reshaping
- recipe round-trip for every new kind plus invalid-recipe rejection
- undo/redo/remove across a group_aggregate step

## Verify in the browser

`npm run dev`, import the sample ("Try it with a messy sample dataset"), and exercise every Transform tool, plus undo and export after each. Check there are no console errors and no network requests other than the app's own files. Then `npm run build && npm run preview` (production + CSP header) and repeat a quick import + one transform.

## Ship

1. Update `README.md` (what works) and `docs/ARCHITECTURE.md` (roadmap row 4 ✅, notes on the expression AST and preview changes).
2. Commit with a clear message and `git push` (GitHub Pages redeploys via `.github/workflows/pages.yml`).
3. Deploy Cloudflare: `npx wrangler deploy` (config in `wrangler.jsonc`; don't let wrangler rewrite `vite.config.ts` or `package.json`; revert any such edits).
4. Open https://tidyfold.b7nsm548rh.workers.dev and https://iliyailiyailiya.github.io/tidyfold/ and confirm Transform works on both.

## Report at the end

What was implemented · files created/modified · tests run (counts) · known limitations · recommended next milestone (Phase 5: Explore workspace with Recharts distributions, histograms, missing-value map, outliers, facets).
