# Tidyfold

A privacy-first, browser-native data cleaning studio: an approachable alternative to OpenRefine.

Drop in a CSV, TSV, Excel or JSON file, see what's wrong with it, fix it step by step, and export the result.
**Everything runs in your browser.** Files are never uploaded; there is no backend.

Created by [@iliyabarcari](https://www.instagram.com/iliyabarcari/).

## What works today

- Import CSV / TSV / TXT / XLSX / JSON / JSON Lines via drag-and-drop or file picker
  - delimiter, encoding, header and sheet detection with a live preview you can override
  - strict, lossless type inference (ZIP codes, IDs with leading zeros and ambiguous dates stay text)
- Local analytical engine: DuckDB-WASM, with parsing in a Web Worker; CSV/TSV rows stream into DuckDB in batches (files over 8 MB are refused before parsing)
- Overview: rows/columns, types, empty cells, duplicate rows, stray whitespace, a transparent quality score, one-click suggested fixes
- Table: virtualised grid, sort, search, per-column filters, column resize/hide, problem highlighting, cell inspector
- Operation history: every change is a recorded step, with undo/redo (⌘Z / ⇧⌘Z), jumping to any step, removing a step (later steps are replayed), and saving/applying reusable JSON recipes
- **Clean workspace** with a live before/after preview of every change (changed cells, removed rows, warnings) before you apply it:
  - trim whitespace (optionally squeeze inner spaces), lowercase / UPPERCASE / Title Case, replace values
  - fill empty cells (fixed value, from the row above or below)
  - standardise dates to YYYY-MM-DD (day/month/year order detected from the data; unreadable values are left untouched)
  - normalise numbers (thousands separators, currency signs, decimal comma or point detected)
  - convert type, strictly: if any value doesn't fit, nothing changes and you see which values to fix
  - remove duplicates (all columns or chosen ones)
- **Group spelling variants** (clustering): finds values that mean the same thing (“Chişinău”, “chisinau ”, “CHISINAU”)
  - choose which differences to ignore: capitals, accents (incl. ş/ș, ß, ø, ł…), spacing, punctuation, word order
  - five worker-local suggestion methods: fingerprint, n-gram fingerprint (`n` 1–5), simplified phonetic key, bounded Levenshtein (radius + optional prefix block), and experimental PPM-style similarity; fuzzy methods have a 60–100% similarity slider
  - groups that match exactly after ignoring differences start ticked; typo matches start unticked, so nothing ambiguous merges without approval
  - per group: untick individual values, edit the value to merge into, or reject it (“Not the same”)
  - group values by hand for names no algorithm can match (e.g. “Kishinev” and “Chisinau”)
  - all merges are one reviewable, undoable step; runs in a background worker
- **Transform workspace** with the same live preview and undoable history:
  - split a column by a separator or character positions, keeping extra text in the last part
  - join columns with a separator you choose
  - extract text by regex, or before/after/between markers
  - calculated columns through a visual formula builder (arithmetic, rounding, upper/lower case, date parts, days between, if-empty), with a plain-English formula sentence and result type
  - filter rows with multiple conditions (equals, contains, comparisons, between, empty)
  - group & summarise (count, distinct count, sum, average, smallest, largest, first) — one row per group
  - rename, remove and reorder columns, and strict type changes
  - bulk edit many columns at once: choose them by name or type, then trim spaces, change case, find & replace (plain text or a pattern), add text, fill blanks, or clear values; optional row conditions limit the edit to matching rows
  - previews show new columns with sample results, “N rows → M rows” for row-reshaping steps, and column-order changes before anything is applied
- Overview flags text columns that hold dates, numbers or spelling variants and links each suggestion to a reviewable preview
- Also: rename column, remove column
- Export to CSV, Excel (.xlsx, with real number/date cells) and JSON (typed values; very large IDs kept exact)
- History keeps full copies only of recent steps and periodic checkpoints; older steps are rebuilt on demand
- **Explore workspace** (read-only): per-column statistics (missing/filled/distinct/min/max/mean/median/IQR/stddev, text lengths, booleans), numeric histograms with clickable bins, date timelines, top-value frequency charts, a missing-values heatmap across row bands, and Tukey-fences outlier panels — numeric and date/timestamp columns — with “Show in Table” and “Create filter step” handoffs. All charts are local Recharts SVG charts with an accessible text summary.
- Optional local projects: the "Keep" switch in the header saves the original file bytes, import options and applied steps in this browser's IndexedDB; "Continue" on the landing page rebuilds the dataset and replays the recipe. Nothing is synced to a server.
- Light/dark theme with a saved preference (falls back to your OS setting).
- History is linear and there are no formal parent/child links between steps (undo/redo, jump, and removing a step with later replay cover most needs). Nothing links one step to another, which is itself a limitation noted in the vault.

## Privacy

- No server, accounts, analytics or telemetry.
- A Content-Security-Policy with `connect-src 'self'` makes the browser block requests to any other origin. It is delivered as an HTTP header via `public/_headers` (Cloudflare Pages). GitHub Pages can't set headers, so there only the `<meta>` CSP applies, which does not cover Web Workers.
- DuckDB extension auto-download is disabled.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # 237 tests incl. real DuckDB-WASM integration + 200k-row run
npm run build      # production build in dist/
npm run deploy:cloudflare
```
