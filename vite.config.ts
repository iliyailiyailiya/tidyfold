/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Replaces the ~40 MB DuckDB .wasm files with .wasm.gz (≈9 MB). Cloudflare Pages
 * rejects files over 25 MiB; the app decompresses them in the browser.
 */
function gzipWasm(): Plugin {
  let outDir = 'dist';
  return {
    name: 'gzip-wasm',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const dir = join(outDir, 'assets');
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.wasm')) continue;
        const p = join(dir, f);
        writeFileSync(`${p}.gz`, gzipSync(readFileSync(p), { level: 9 }));
        unlinkSync(p);
      }
    },
  };
}

/**
 * Production builds ship a strict Content-Security-Policy (meta tag + HTTP
 * header via `public/_headers` / `vite preview`).
 * `connect-src 'self'` means the page physically cannot send data to any
 * other origin — the browser blocks it. Dev mode skips this because Vite's
 * HMR preamble needs inline scripts.
 */
export const CSP = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'", // DuckDB-WASM's Emscripten glue and Arrow use eval; egress is still blocked by connect-src
    "worker-src 'self' blob:",
    "connect-src 'self' blob: data:",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
].join('; ');

function privacyCsp(): Plugin {
  return {
    name: 'privacy-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  // GitHub Pages serves under /<repo>/; Cloudflare Pages at the root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), privacyCsp(), gzipWasm()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  // Workers ignore <meta> CSP, so the real guarantee is the HTTP header.
  preview: { headers: { 'Content-Security-Policy': CSP, 'Referrer-Policy': 'no-referrer' } },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
});
