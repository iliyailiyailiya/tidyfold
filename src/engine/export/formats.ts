/**
 * Pure export builders (run in the worker; tested in Node).
 * Rows arrive as display-safe primitives: integers/dates/timestamps as text,
 * decimals as numbers, booleans as booleans, text as text, missing as null.
 */
import * as XLSX from 'xlsx';
import type { ColumnSchema } from '../history/operations';

export type ExportFormat = 'csv' | 'xlsx' | 'json';
export type ExportCell = string | number | boolean | null;

export const EXCEL_MAX_ROWS = 1_048_575; // + header row

function integerValue(v: string): number | string {
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v; // keep >2^53 IDs exact as text
}

/** Converts one cell to the richest value the target format can hold losslessly. */
function typed(v: ExportCell, type: ColumnSchema['type'], forExcel: boolean): ExportCell | Date {
  if (v === null) return null;
  switch (type) {
    case 'integer':
      return typeof v === 'string' ? integerValue(v) : v;
    case 'date': {
      if (!forExcel || typeof v !== 'string') return v;
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!) : v;
    }
    case 'timestamp': {
      if (!forExcel || typeof v !== 'string') return v;
      const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/.exec(v);
      return m ? new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, m[7] ? Math.round(Number(m[7]) * 1000) : 0) : v;
    }
    default:
      return v;
  }
}

export function buildJson(schema: ColumnSchema[], rows: ExportCell[][]): Uint8Array {
  const objects = rows.map((r) => {
    const o: Record<string, unknown> = {};
    schema.forEach((c, i) => (o[c.name] = typed(r[i] ?? null, c.type, false)));
    return o;
  });
  return new TextEncoder().encode(JSON.stringify(objects, null, 2));
}

export function buildXlsx(schema: ColumnSchema[], rows: ExportCell[][], sheetName = 'Data'): Uint8Array {
  if (rows.length > EXCEL_MAX_ROWS) {
    throw new Error(`Excel sheets hold at most ${EXCEL_MAX_ROWS.toLocaleString()} rows; this data has ${rows.length.toLocaleString()}. Export as CSV instead.`);
  }
  const aoa: unknown[][] = [schema.map((c) => c.name)];
  for (const r of rows) aoa.push(schema.map((c, i) => typed(r[i] ?? null, c.type, true)));
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: 'yyyy-mm-dd' });
  // per-column number formats for timestamps
  schema.forEach((c, ci) => {
    if (c.type !== 'timestamp') return;
    for (let ri = 1; ri < aoa.length; ri++) {
      const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
      if (cell && cell.t === 'd') cell.z = 'yyyy-mm-dd hh:mm:ss';
    }
  });
  ws['!cols'] = schema.map((c) => ({ wch: Math.min(40, Math.max(8, c.name.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ') || 'Data');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer);
}
