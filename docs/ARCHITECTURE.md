# Tidyfold — Architecture & Roadmap

Working name: **Tidyfold**, a privacy-first, browser-native data cleaning studio.

## Phase 0 audit (2026-11-24)

- The starting directory was **empty**: no framework, dependencies, scripts or prior
  work to reuse or conflict with. Everything below is a fresh, deliberate setup.
- Toolchain: Node 26, npm 11.

### Dependency decisions

| Need | Choice | Notes |
|---|---|---|
| UI | React 19 + TypeScript (strict, `noUncheckedIndexedAccess`) | |
| Build | Vite 8 | `@vitejs/plugin-react` 6 requires Vite 8 |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`) | |
| Components | shadcn/ui *pattern* | Components are hand-copied into `src/components/ui` (that is how shadcn works); uses `class-variance-authority`, `clsx`, `tailwind-merge`. No Radix yet — added per component when needed. |
| Icons | lucide-react | |
| Grid | TanStack Table 8 + TanStack Virtual 3 | Server-side (DuckDB) sorting/filtering/paging |
| Engine | DuckDB-WASM (pinned `1.33.1-dev57.0`, npm `latest` tag) + apache-arrow 17 (its peer) | WASM + worker files are self-hosted by Vite, never loaded from a CDN |
| CSV | PapaParse 5 | Runs inside a Web Worker |
| Encoding | jschardet | Best-effort detection of the first 64 KB |
| Excel | SheetJS 0.20.3 from `cdn.sheetjs.com` tarball | The npm `xlsx` package is stuck at 0.18.5 with known CVEs |
| Tests | Vitest 5 | |

**Deferred until needed** (to avoid unused dependencies): Arquero (DuckDB SQL covers
Phase 1–2 transforms), Radix primitives, IndexedDB/OPFS wrapper. — Recharts was
added for Phase 5 (Explore charts) and is pinned exactly (`recharts@3.11.1`).

## Layers

```
┌───────────────────────── UI (React) ─────────────────────────┐
│ components/ui   shadcn-style primitives                       │
│ components/layout  AppShell, sidebar, privacy badge           │
│ features/*      import wizard, table, overview, clean, transform, …    │
└──────────────┬────────────────────────────────────────────────┘
               │  state/StudioContext (session state, actions)
┌──────────────▼──────────────── Engine (no React) ─────────────┐
│ engine/import    detect · parse · infer  ──► import.worker.ts │
│ engine/history   Operation model · History state · recipes    │
│ engine/dataset   DatasetSession: materialises steps in DuckDB │
│ engine/duckdb    AsyncDuckDB bootstrap (own worker)           │
└───────────────────────────────────────────────────────────────┘
```

Rules:
1. `engine/**` never imports React. Pure modules (`detect`, `infer`, `history`,
   `operations`, `sql`) have no browser dependencies and are unit-tested in Node.
2. Expensive work never runs on the main thread: parsing/inference in
   `import.worker.ts`, queries in DuckDB's own worker.
3. Data crosses the worker boundary once, as an **Arrow IPC buffer** (transferred,
   not copied) — no per-row `postMessage`.

## Data model

```
source            raw strings, exactly as imported (+ __row id). NEVER modified.
step_0            typed view of source (lossless casts only, see below)
step_1..step_n    result of operation k applied to step_{k-1}
current           = step_{cursor}
```

- `__row` (BIGINT) is the original 1-based row number. It gives a stable default
  order and lets later features (cell edits, before/after diffs) address rows.
- **Lossless typing**: a column is only typed as INTEGER/DOUBLE/BOOLEAN/DATE/TIMESTAMP
  if *every* non-blank value matches a strict pattern. Values with leading zeros
  (`007`, ZIP codes), thousands separators or ambiguous dates stay text; the Clean
  workspace will normalise them *as recorded operations* later.

## Operation history

- An `Operation` is plain JSON: `{ id, kind, params, createdAt }`.
- `History` is a pure, immutable state machine: `ops[]` + `cursor`.
  Undo/redo move the cursor; applying after an undo truncates the redo branch;
  removing an operation triggers a replay from that point.
- Each kind has `describe()` (human-readable) and `compile()` → a `SELECT` over the
  previous step. Compilation validates the columns it needs exist, so replaying a
  recipe on a different file fails loudly instead of silently.
- A **recipe** is `{ format: "tidyfold-recipe", version: 1, operations }`.

Memory: schemas are kept for every step, but only some steps keep a full
DuckDB table: the original, the current step, the 3 before it (instant undo)
and every 8th step as a checkpoint. Any other step is rebuilt from the nearest
table below it when needed.

Atomicity: every history change (apply, undo, redo, jump, remove, recipe
replay) goes through one `transition()`. If building the new current step fails
on the data (e.g. a strict type conversion meets a bad value), the previous
history and tables are restored and the error is reported.

Preview: `preview(spec)` runs the compiled operation against the current step
in a CTE and diffs it against the input by `__row` (cells changed per column,
sample before/after pairs, removed rows), plus operation-specific diagnostics
such as unreadable dates or values that would block a conversion. New columns
are shown with sample results; row-reshaping operations (group & summarise)
show “N rows → M rows” and the first result rows; reorder-only steps say that
no values change. It saves nothing.

## Bulk editing

`bulk_edit` applies one action to many columns: trim/collapse spaces, change
case, find & replace (literal text or an RE2 pattern with capture groups), add
text at the start/end, fill blank cells, or clear values. The operation stores
concrete column names, so a recipe always means the same thing; the UI helps
pick them with a name search and a type filter. Optional row conditions reuse
`filterConditionSql`, the same compiler as Filter rows, so both tools agree on
what “between”, empty cells and comparisons mean.

Text actions reject non-text columns at compile time. Clearing accepts any
column type and casts `NULL` to the original DuckDB type, so the schema never
drifts. The preview uses the normal `__row` diff, counts the matching rows, and
shows before/after samples per column. Cells stay in place and the whole edit is
one undoable step.

## Explore

`engine/explore/` holds the read-only analysis layer. `source.ts` builds the
`ExploreSource` (session + shared view filters); every query goes through the
same queued `read()` as mutations. `stats.ts` measures one column per query;
`histogram.ts` bins numerics (nice widths, ~20 bins) or timelines dates by
day/week/month/year; `topValues.ts` returns the most frequent values plus an
“Other” bucket; `missingMap.ts` splits rows into ~50 bands for the heatmap;
`outliers.ts` applies the Tukey fences (Q1 − 1.5·IQR / Q3 + 1.5·IQR).

View filters (`engine/dataset/filters.ts`) are shared by the Table and Explore
workspaces and only narrow what is displayed; they never touch the data. Bins
and outlier fences hand off into Transform’s `filter_rows` as a recorded step
(“Create filter step”); “Show in Table” adds a view filter (“outside”).

## Calculated columns

`engine/history/expression.ts` defines a small typed AST for calculated columns:
`column`, `number`, `text`, `binary` (+, −, ×, ÷, join), `round`, `upper`/`lower`,
`ifEmpty`, `datePart` and `daysBetween`. `compileCalc` type-checks operands (no
arithmetic on text, no date parts on numbers), limits nesting depth, and builds
SQL only from quoted identifiers and literals. Division uses `NULLIF` so a zero
divisor yields an empty cell instead of failing the whole step. The UI builder
wraps the current result, so steps can be nested; `describeCalc` renders the same
formula as a plain-English sentence.

## Clustering

`engine/cluster` is pure TypeScript run in the data worker:
1. Fingerprint each distinct value with the chosen normalisations (NFC, then
   accents via NFKD + a table for ß/æ/ø/ł…, case, punctuation, spacing,
   word order). Equal fingerprints form a group.
2. With typo matching on, fingerprints (most frequent first) join the closest
   existing centre within the similarity threshold, using a length filter and a
   banded Levenshtein that stops once the bound is exceeded. Members are only
   compared to the centre, so chains (a≈b≈c≈…) can't snowball. The 20,000 most
   frequent fingerprints are fuzzy-matched; rarer ones only match exactly.
3. The result is suggestions only. Merging is a `merge_values` operation with
   explicit `{from[], to}` groups, matched byte-for-byte.

## Privacy guarantees

- No backend exists. The app is static files.
- Production build ships a CSP with `connect-src 'self' blob: data:`, so the
  browser itself blocks any request to another origin. It is sent as an HTTP
  header (`public/_headers`, honoured by Cloudflare Pages) because a `<meta>` CSP
  does not apply inside Web Workers. `script-src` must include `'unsafe-eval'`:
  DuckDB-WASM's Emscripten glue and Arrow compile code at runtime. This does not
  affect data egress, which `connect-src` controls.
- Hosts that can't set headers (e.g. GitHub Pages) only get the `<meta>` CSP,
  which covers the page but not workers. Our workers make no requests of their own
  beyond loading their code, but the hard browser-enforced guarantee needs the header.
- DuckDB extension autoloading/autoinstall is disabled (it would otherwise fetch
  from `extensions.duckdb.org`).
- No analytics or telemetry of any kind.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit, architecture, roadmap | ✅ done |
| 1 | App shell, import (CSV/TSV/XLSX/JSON, detection, preview), DuckDB engine, data grid, overview profile, history core (undo/redo/remove/replay, recipe JSON), CSV export | ✅ done |
| 2 | Clean workspace: trim, case, replace, fill missing, standardise dates, normalise numbers, strict type conversion, dedupe with **before/after preview**; XLSX/JSON export; step-retention cap; atomic history transitions | ✅ done |
| 3 | Clustering (case/Unicode/whitespace/punctuation/word-order fingerprints, bounded Levenshtein with threshold, centre-based grouping, merge/reject/manual groups) and spelling-variant detection | ✅ done |
| 4 | Transform: split/merge/extract/type change/calculated columns/filter/group-by, visual builder | ✅ done |
| 5 | Explore: Recharts distributions, histograms, missing-value map, outliers, facets | ✅ done |
| 6 | "Clean Everything" guided review, local project persistence (IndexedDB), saved recipes library — shipped 2026-11-24/25 (see [[Status]]) | ✅ done |
| 7 | Large-data hardening: streaming CSV into DuckDB, memory benchmarks, perf budget (Blocks 1–2 shipped 2026-11-25) | planned |
