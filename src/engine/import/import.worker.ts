/// <reference lib="webworker" />
/**
 * Parsing & inference worker. The File object is read here, so file bytes
 * never touch the main thread and never leave the device.
 */
import { analyze, runImport } from './pipeline';
import type { ImportAnalysis, ImportOptions, ImportResult } from './types';

export type WorkerRequest =
  | { id: number; type: 'analyze'; file: File; overrides?: Partial<ImportOptions> }
  | { id: number; type: 'import'; file: File; options: ImportOptions };

export type WorkerResponse =
  | { id: number; ok: true; type: 'analyze'; analysis: ImportAnalysis }
  | { id: number; ok: true; type: 'import'; result: ImportResult }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    const bytes = new Uint8Array(await msg.file.arrayBuffer());
    if (msg.type === 'analyze') {
      const analysis = analyze(msg.file.name, bytes, msg.overrides);
      ctx.postMessage({ id: msg.id, ok: true, type: 'analyze', analysis } satisfies WorkerResponse);
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
