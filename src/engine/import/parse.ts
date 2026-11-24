import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { genericColumnNames, stripBom, uniqueColumnNames } from './detect';
import type { RawCell, RawTable } from './types';

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Pads/truncates ragged rows to `width`; returns how many rows were ragged. */
function rectangularize(rows: RawCell[][], width: number): number {
  let ragged = 0;
  for (const r of rows) {
    if (r.length !== width) {
      ragged++;
      if (r.length < width) while (r.length < width) r.push(null);
    }
  }
  return ragged;
}

export interface ParsedText {
  table: RawTable;
  warnings: string[];
}

function finishGrid(grid: RawCell[][], hasHeader: boolean): ParsedText {
  const warnings: string[] = [];
  if (grid.length === 0) return { table: { columns: [], rows: [] }, warnings };
  let width = 0;
  for (const r of grid) if (r.length > width) width = r.length; // no spread: large files overflow the stack
  const headerRow = hasHeader ? grid[0]! : null;
  const rows = hasHeader ? grid.slice(1) : grid;
  const ragged = rectangularize(rows, width);
  if (ragged > 0) {
    warnings.push(
      `${ragged.toLocaleString()} row${ragged === 1 ? ' has' : 's have'} a different number of fields; missing cells were left empty.`,
    );
  }
  let columns: string[];
  if (headerRow) {
    const padded = [...headerRow];
    while (padded.length < width) padded.push(null);
    columns = uniqueColumnNames(padded);
    const renamed = columns.filter((c, i) => c !== (headerRow[i] ?? '').trim()).length;
    if (renamed > 0) warnings.push(`${renamed} column name${renamed === 1 ? ' was' : 's were'} empty or duplicated and got a unique name.`);
  } else {
    columns = genericColumnNames(width);
  }
  return { table: { columns, rows }, warnings };
}

export function parseDelimited(
  text: string,
  opts: { delimiter: string; hasHeader: boolean; previewRows?: number },
): ParsedText {
  const res = Papa.parse<string[]>(stripBom(text), {
    delimiter: opts.delimiter,
    skipEmptyLines: 'greedy',
    ...(opts.previewRows ? { preview: opts.previewRows + (opts.hasHeader ? 1 : 0) } : {}),
  });
  const parsed = finishGrid(res.data as RawCell[][], opts.hasHeader);
  const quoteErrors = res.errors.filter((e) => e.type === 'Quotes');
  if (quoteErrors.length > 0 && !opts.previewRows) {
    parsed.warnings.push(
      `${quoteErrors.length} quoting problem${quoteErrors.length === 1 ? '' : 's'} (e.g. row ${(quoteErrors[0]!.row ?? 0) + 1}): an unmatched quote may have merged lines.`,
    );
  }
  return parsed;
}

function cellToString(v: unknown): RawCell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return formatDate(v);
  return JSON.stringify(v);
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

/** Local-time ISO-ish rendering (Excel dates carry no timezone). */
export function formatDate(d: Date): string {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0) return date;
  return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * JSON: array of objects, array of arrays, NDJSON, or an object wrapping
 * one of those under a single array-valued key. Nested values are kept as
 * JSON text (never dropped).
 */
export function parseJson(text: string, previewRows?: number): ParsedText {
  const src = stripBom(text).trim();
  let data: unknown;
  const warnings: string[] = [];
  try {
    data = JSON.parse(src);
  } catch {
    // NDJSON?
    const lines = src.split(/\r?\n/).filter((l) => l.trim() !== '');
    try {
      data = lines.map((l, i) => {
        try {
          return JSON.parse(l);
        } catch {
          throw new ImportError(`Line ${i + 1} is not valid JSON.`);
        }
      });
    } catch (e) {
      if (e instanceof ImportError && lines.length > 1) throw new ImportError(`This file isn't valid JSON or JSON Lines. ${e.message}`);
      throw new ImportError("This file isn't valid JSON.");
    }
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const arrays = Object.entries(data as Record<string, unknown>).filter(([, v]) => Array.isArray(v));
    if (arrays.length === 1) {
      warnings.push(`Using the records found under "${arrays[0]![0]}".`);
      data = arrays[0]![1];
    } else {
      data = [data];
    }
  }
  if (!Array.isArray(data)) throw new ImportError('Expected a list of records.');
  const records = previewRows ? data.slice(0, previewRows) : data;
  if (records.length === 0) return { table: { columns: [], rows: [] }, warnings };

  if (records.every((r) => Array.isArray(r))) {
    const grid = (records as unknown[][]).map((r) => r.map(cellToString));
    return finishGrid(grid, false);
  }

  const keys: string[] = [];
  const seen = new Set<string>();
  let scalars = 0;
  for (const r of records) {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), keys.push(k));
    } else scalars++;
  }
  const useValueCol = scalars > 0;
  const columns = uniqueColumnNames(useValueCol ? [...keys, 'value'] : keys);
  const rows: RawCell[][] = records.map((r) => {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      const obj = r as Record<string, unknown>;
      const row = keys.map((k) => (k in obj ? cellToString(obj[k]) : null));
      if (useValueCol) row.push(null);
      return row;
    }
    const row: RawCell[] = keys.map(() => null);
    row.push(cellToString(r));
    return row;
  });
  if (useValueCol) warnings.push(`${scalars} item${scalars === 1 ? ' is' : 's are'} not an object; stored in the "value" column.`);
  return { table: { columns, rows }, warnings };
}

export function listSheets(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(buffer, { type: 'array', bookSheets: true });
  return wb.SheetNames;
}

export function parseXlsx(
  buffer: ArrayBuffer,
  opts: { sheet: string | null; hasHeader: boolean; previewRows?: number },
): ParsedText & { sheets: string[]; sheet: string } {
  const wb = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    dense: true,
    ...(opts.previewRows ? { sheetRows: opts.previewRows + 1 } : {}),
  });
  const sheet = opts.sheet && wb.SheetNames.includes(opts.sheet) ? opts.sheet : wb.SheetNames[0];
  if (!sheet) throw new ImportError('This workbook has no sheets.');
  const ws = wb.Sheets[sheet]!;
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  const parsed = finishGrid(
    grid.map((r) => r.map(cellToString)),
    opts.hasHeader,
  );
  return { ...parsed, sheets: wb.SheetNames, sheet };
}

/** Header guess for xlsx needs the raw grid: expose the first rows without header handling. */
export function xlsxGrid(buffer: ArrayBuffer, sheet: string | null, rows: number): { grid: RawCell[][]; sheets: string[]; sheet: string } {
  const r = parseXlsx(buffer, { sheet, hasHeader: false, previewRows: rows });
  return { grid: r.table.rows, sheets: r.sheets, sheet: r.sheet };
}
