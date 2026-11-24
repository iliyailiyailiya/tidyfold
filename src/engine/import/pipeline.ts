/**
 * Environment-agnostic import pipeline (runs in the worker, and in Node tests).
 * Takes bytes, returns either a preview analysis or the final Arrow payload.
 */
import jschardet from 'jschardet';
import { Int64, Table, Utf8, makeVector, tableToIPC, vectorFromArray, type Vector } from 'apache-arrow';
import {
  detectDelimiter,
  detectHeader,
  detectKind,
  encodingFromBom,
  isValidUtf8,
  normalizeEncodingLabel,
} from './detect';
import { inferColumns } from './infer';
import { ImportError, parseDelimited, parseJson, parseXlsx, xlsxGrid } from './parse';
import type { ColumnInference, ImportAnalysis, ImportOptions, ImportResult, RawTable } from './types';

export const PREVIEW_ROWS = 100;
const SAMPLE_BYTES = 64 * 1024;

export function detectEncoding(bytes: Uint8Array): { encoding: string; confidence: number } {
  const bom = encodingFromBom(bytes);
  if (bom) return { encoding: bom, confidence: 1 };
  const sample = bytes.subarray(0, SAMPLE_BYTES);
  if (isValidUtf8(sample)) return { encoding: 'utf-8', confidence: 1 };
  // jschardet wants a binary string
  let bin = '';
  for (let i = 0; i < sample.length; i++) bin += String.fromCharCode(sample[i]!);
  const guess = jschardet.detect(bin);
  return { encoding: normalizeEncodingLabel(guess.encoding), confidence: guess.confidence ?? 0 };
}

export function decode(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    throw new ImportError(`Your browser can't decode the "${encoding}" encoding.`);
  }
}

function parseWith(bytes: Uint8Array, opts: ImportOptions, previewRows?: number) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  switch (opts.kind) {
    case 'csv':
    case 'tsv':
      return { ...parseDelimited(decode(bytes, opts.encoding), { delimiter: opts.delimiter, hasHeader: opts.hasHeader, ...(previewRows ? { previewRows } : {}) }), sheets: [] as string[] };
    case 'json':
      return { ...parseJson(decode(bytes, opts.encoding), previewRows), sheets: [] as string[] };
    case 'xlsx': {
      const r = parseXlsx(buffer, { sheet: opts.sheet, hasHeader: opts.hasHeader, ...(previewRows ? { previewRows } : {}) });
      return { table: r.table, warnings: r.warnings, sheets: r.sheets, sheet: r.sheet };
    }
  }
}

/**
 * First look at a file. `overrides` lets the user change detected options;
 * when absent everything is auto-detected.
 */
export function analyze(fileName: string, bytes: Uint8Array, overrides?: Partial<ImportOptions>): ImportAnalysis {
  const kind = overrides?.kind ?? detectKind(fileName);
  if (!kind) throw new ImportError('Unsupported file type. Use CSV, TSV, TXT, XLSX or JSON.');
  if (bytes.byteLength === 0) throw new ImportError('This file is empty.');

  const enc = kind === 'xlsx' ? { encoding: 'utf-8', confidence: 1 } : detectEncoding(bytes);
  let delimiter: string | null = null;
  let detectedHeader = true;
  let sheets: string[] = [];
  let sheet: string | null = overrides?.sheet ?? null;

  if (kind === 'csv' || kind === 'tsv') {
    const sampleText = decode(bytes.subarray(0, SAMPLE_BYTES), overrides?.encoding ?? enc.encoding);
    delimiter = kind === 'tsv' ? '\t' : detectDelimiter(sampleText);
    const grid = parseDelimited(sampleText, {
      delimiter: overrides?.delimiter ?? delimiter,
      hasHeader: false,
      previewRows: 51,
    }).table.rows;
    detectedHeader = detectHeader(grid);
  } else if (kind === 'xlsx') {
    const g = xlsxGrid(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, sheet, 51);
    sheets = g.sheets;
    sheet = g.sheet;
    detectedHeader = detectHeader(g.grid);
  }

  const options: ImportOptions = {
    kind,
    encoding: enc.encoding,
    delimiter: delimiter ?? ',',
    hasHeader: detectedHeader,
    sheet,
    inferTypes: true,
    ...overrides,
  };
  // sheet override must survive the spread when it was resolved above
  if (kind === 'xlsx') options.sheet = sheet;

  const parsed = parseWith(bytes, options, PREVIEW_ROWS);
  const types = options.inferTypes
    ? inferColumns(parsed.table.columns.length, parsed.table.rows).map((c) => c.type)
    : parsed.table.columns.map(() => 'text' as const);

  const warnings = [...parsed.warnings];
  if (enc.confidence < 0.6 && kind !== 'xlsx') {
    warnings.push(`Encoding guessed as ${enc.encoding} with low confidence — check the preview for garbled characters.`);
  }
  if (parsed.table.columns.length === 0) warnings.push('No data found in this file.');

  return {
    fileName,
    fileSize: bytes.byteLength,
    kind,
    options,
    detected: { encoding: enc.encoding, encodingConfidence: enc.confidence, delimiter, hasHeader: detectedHeader },
    sheets,
    preview: parsed.table,
    previewTypes: types,
    warnings,
  };
}

export function toArrowIpc(table: RawTable): Uint8Array {
  const n = table.rows.length;
  const cols: Record<string, Vector> = {};
  const rowIds = new BigInt64Array(n);
  for (let i = 0; i < n; i++) rowIds[i] = BigInt(i + 1);
  cols['__row'] = makeVector({ type: new Int64(), data: rowIds });
  table.columns.forEach((name, c) => {
    const values = new Array<string | null>(n);
    for (let i = 0; i < n; i++) values[i] = table.rows[i]![c] ?? null;
    cols[name] = vectorFromArray(values, new Utf8());
  });
  return tableToIPC(new Table(cols), 'stream');
}

export function runImport(fileName: string, bytes: Uint8Array, options: ImportOptions): ImportResult {
  const t0 = performance.now();
  const parsed = parseWith(bytes, options);
  const { table } = parsed;
  if (table.columns.length === 0) throw new ImportError('No columns found with these settings.');
  const inferred = options.inferTypes
    ? inferColumns(table.columns.length, table.rows)
    : table.columns.map((_, c) => ({ type: 'text' as const, blank: table.rows.reduce((s, r) => s + (r[c] == null || r[c]!.trim() === '' ? 1 : 0), 0) }));
  const columns: ColumnInference[] = table.columns.map((name, i) => ({ name, ...inferred[i]! }));
  const arrowIpc = toArrowIpc(table);
  return {
    fileName,
    columns,
    rowCount: table.rows.length,
    arrowIpc,
    warnings: parsed.warnings,
    parseMs: performance.now() - t0,
  };
}
