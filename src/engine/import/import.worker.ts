/// <reference lib="webworker" />
/**
 * Data worker: parsing & inference on import, XLSX/JSON building on export,
 * spelling-variant clustering. The File object is read here, so file bytes
 * never touch the main thread and never leave the device.
 */
import { analyze, parseImport, runImport } from './pipeline';
import type { ImportAnalysis, ImportOptions, ImportResult, ImportStreamResult } from './types';
import { buildJson, buildXlsx, type ExportCell } from '../export/formats';
import type { ColumnSchema } from '../history/operations';
import { clusterValues, type ClusterOptions, type ClusterResult, type ValueCount } from '../cluster/cluster';

export type WorkerRequest =
  | { id: number; type: 'analyze'; file: File; overrides?: Partial<ImportOptions> }
  | { id: number; type: 'import'; file: File; options: ImportOptions }
  | { id: number; type: 'importStream'; file: File; options: ImportOptions }
  | { id: number; type: 'export'; format: 'xlsx' | 'json'; schema: ColumnSchema[]; rows: ExportCell[][]; sheetName: string }
  | { id: number; type: 'cluster'; values: ValueCount[]; options: ClusterOptions };

export type WorkerResponse =
  | { id: number; ok: true; type: 'analyze'; analysis: ImportAnalysis }
  | { id: number; ok: true; type: 'import'; result: ImportResult }
  | { id: number; ok: true; type: 'importStream'; result: ImportStreamResult }
  | { id: number; ok: true; type: 'export'; bytes: Uint8Array }
  | { id: number; ok: true; type: 'cluster'; result: ClusterResult }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'cluster') {
      ctx.postMessage({ id: msg.id, ok: true, type: 'cluster', result: clusterValues(msg.values, msg.options) } satisfies WorkerResponse);
      return;
    }
    if (msg.type === 'export') {
      const bytes = msg.format === 'xlsx' ? buildXlsx(msg.schema, msg.rows, msg.sheetName) : buildJson(msg.schema, msg.rows);
      ctx.postMessage({ id: msg.id, ok: true, type: 'export', bytes } satisfies WorkerResponse, [bytes.buffer]);
      return;
    }
    const bytes = new Uint8Array(await msg.file.arrayBuffer());
    if (msg.type === 'analyze') {
      const analysis = analyze(msg.file.name, bytes, msg.overrides);
      ctx.postMessage({ id: msg.id, ok: true, type: 'analyze', analysis } satisfies WorkerResponse);
    } else if (msg.type === 'importStream') {
      // Streaming path: parse on the worker, rows travel as plain arrays (no
      // Arrow IPC) so the DuckDB source table can be filled batch-by-batch.
      const t0 = performance.now();
      const parsed = parseImport(bytes, msg.options);
      const result: ImportStreamResult = {
        fileName: msg.file.name,
        columns: parsed.columns,
        rowCount: parsed.table.rows.length,
        warnings: parsed.warnings,
        rows: parsed.table.rows,
        parseMs: performance.now() - t0,
      };
      ctx.postMessage({ id: msg.id, ok: true, type: 'importStream', result } satisfies WorkerResponse);
    } else {
      const result = runImport(msg.file.name, bytes, msg.options);
      // transfer, don't copy, the Arrow buffer
      ctx.postMessage({ id: msg.id, ok: true, type: 'import', result } satisfies WorkerResponse, [result.arrowIpc.buffer]);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    ctx.postMessage({ id: msg.id, ok: false, error } satisfies WorkerResponse);
  }
};
