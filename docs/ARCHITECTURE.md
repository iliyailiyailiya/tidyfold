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
Phase 1–2 transforms), Recharts (Explore workspace), Radix primitives, IndexedDB/OPFS wrapper.

## Layers

```
┌───────────────────────── UI (React) ─────────────────────────┐
│ components/ui   shadcn-style primitives                       │
│ components/layout  AppShell, sidebar, privacy badge           │
│ features/*      import wizard, table, overview, history, …    │
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
such as unreadable dates or values that would block a conversion. It saves
nothing.

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
| 3 | Clustering (case/Unicode/whitespace fingerprint, Levenshtein, threshold, merge/reject) and inconsistent-category detection | planned |
| 4 | Transform: split/merge/extract/type change/calculated columns/filter/group-by, visual builder | planned |
| 5 | Explore: Recharts distributions, histograms, missing-value map, outliers, facets | planned |
| 6 | "Clean Everything" guided review, local project persistence (OPFS/IndexedDB), saved recipes library | planned |
| 7 | Large-data hardening: streaming CSV into DuckDB, memory benchmarks, perf budget | planned |
