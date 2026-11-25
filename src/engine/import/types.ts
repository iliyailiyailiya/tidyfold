export type FileKind = 'csv' | 'tsv' | 'xlsx' | 'json';

export type ColumnType = 'text' | 'integer' | 'decimal' | 'boolean' | 'date' | 'timestamp';

/** A cell straight from the parser. `null` = absent (JSON null / missing key / empty Excel cell). */
export type RawCell = string | null;

export interface RawTable {
  columns: string[];
  rows: RawCell[][];
}

export interface ImportOptions {
  kind: FileKind;
  /** Text encoding label understood by TextDecoder (csv/tsv/json). */
  encoding: string;
  /** Field delimiter (csv/tsv). */
  delimiter: string;
  /** First row holds column names (csv/tsv/xlsx). */
  hasHeader: boolean;
  /** Worksheet name (xlsx). */
  sheet: string | null;
  /** Infer column types; when false everything stays text. */
  inferTypes: boolean;
}

export interface ColumnInference {
  name: string;
  type: ColumnType;
  /** Cells that are null or whitespace-only. */
  blank: number;
}

/** Result of the quick analysis shown in the import preview. */
export interface ImportAnalysis {
  fileName: string;
  fileSize: number;
  kind: FileKind;
  options: ImportOptions;
  detected: {
    encoding: string;
    encodingConfidence: number;
    delimiter: string | null;
    hasHeader: boolean;
  };
  sheets: string[];
  preview: RawTable;
  previewTypes: ColumnType[];
  warnings: string[];
}

export interface ImportResult {
  fileName: string;
  columns: ColumnInference[];
  rowCount: number;
  /** Arrow IPC stream: all columns Utf8 + `__row` Int64. */
  arrowIpc: Uint8Array;
  warnings: string[];
  parseMs: number;
}

/**
 * Payload of the streaming import path: parse results, but rows travel as
 * plain arrays (no Arrow IPC) so the DuckDB source table can be filled
 * batch-by-batch via `streamCsvToDuckdb` semantics.
 */
export interface ImportStreamResult {
  fileName: string;
  columns: ColumnInference[];
  rowCount: number;
  warnings: string[];
  rows: RawTable['rows'];
  parseMs: number;
}
