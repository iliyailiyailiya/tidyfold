import { describe, expect, test } from 'vitest';
import type { OperationPreview } from '../src/engine/dataset/preview';
import { hasPreviewChanges } from '../src/features/shared/changes';

const preview = (patch: Partial<OperationPreview> = {}): OperationPreview => ({
  rowsBefore: 2,
  rowsAfter: 2,
  changedCells: 0,
  columns: [],
  samples: [],
  removedCount: 0,
  removedRows: [],
  removedColumns: [],
  renamed: [],
  addedColumns: [],
  converted: null,
  resultRows: null,
  reshaped: false,
  reordered: false,
  notes: [],
  blocked: null,
  elapsedMs: 1,
  ...patch,
});

describe('hasPreviewChanges', () => {
  test('is false for a no-op, missing or blocked preview', () => {
    expect(hasPreviewChanges(null)).toBe(false);
    expect(hasPreviewChanges(preview())).toBe(false);
    expect(hasPreviewChanges(preview({ blocked: 'nope', changedCells: 5 }))).toBe(false);
  });

  test('counts every kind of change, including type-only conversions', () => {
    expect(hasPreviewChanges(preview({ changedCells: 1 }))).toBe(true);
    expect(hasPreviewChanges(preview({ removedCount: 1 }))).toBe(true);
    expect(hasPreviewChanges(preview({ removedColumns: ['a'] }))).toBe(true);
    expect(hasPreviewChanges(preview({ renamed: [{ from: 'a', to: 'b' }] }))).toBe(true);
    expect(hasPreviewChanges(preview({ addedColumns: [{ name: 'a', samples: [] }] }))).toBe(true);
    expect(hasPreviewChanges(preview({ reordered: true }))).toBe(true);
    expect(hasPreviewChanges(preview({ resultRows: [] }))).toBe(true);
    // Whole number → text: displayed values look the same, but the step is real.
    expect(hasPreviewChanges(preview({ converted: { column: 'a', from: 'integer', to: 'text' } }))).toBe(true);
  });
});
