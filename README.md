# Tidyfold

A privacy-first, browser-native data cleaning studio: an approachable alternative to OpenRefine.

Drop in a CSV, TSV, Excel or JSON file, see what's wrong with it, fix it step by step, and export the result.
**Everything runs in your browser.** Files are never uploaded; there is no backend.

Created by [@iliyabarcari](https://www.instagram.com/iliyabarcari/).

## What works today (Phase 1)

- Import CSV / TSV / TXT / XLSX / JSON / JSON Lines via drag-and-drop or file picker
  - delimiter, encoding, header and sheet detection with a live preview you can override
  - strict, lossless type inference (ZIP codes, IDs with leading zeros and ambiguous dates stay text)
- Local analytical engine: DuckDB-WASM, with parsing in a Web Worker
- Overview: rows/columns, types, empty cells, duplicate rows, stray whitespace, a transparent quality score, one-click suggested fixes
- Table: virtualised grid, sort, search, per-column filters, column resize/hide, problem highlighting, cell inspector
- Operation history: every change is a recorded step, with undo/redo (⌘Z / ⇧⌘Z), jumping to any step, removing a step (later steps are replayed), and saving/applying reusable JSON recipes
- Operations: trim whitespace, lowercase/UPPERCASE, remove duplicates, rename column, remove column
- CSV export

The Clean, Transform and Explore workspaces are **not built yet**. The app labels them as planned. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the roadmap.

## Privacy

- No server, accounts, analytics or telemetry.
- A Content-Security-Policy with `connect-src 'self'` makes the browser block requests to any other origin. It is delivered as an HTTP header via `public/_headers` (Cloudflare Pages). GitHub Pages can't set headers, so there only the `<meta>` CSP applies, which does not cover Web Workers.
- DuckDB extension auto-download is disabled.

## Development

```bash
npm install
npm run dev        # dev server
npm test           # 96 tests incl. real DuckDB-WASM integration + 200k-row run
npm run build      # production build in dist/
npm run deploy:cloudflare
```
