import type { OperationPreview } from '@/engine/dataset/preview';

/**
 * True when applying the preview would actually change something.
 * Includes changes that don't alter displayed text (type-only conversions),
 * row reshaping, reordering and new columns.
 */
export function hasPreviewChanges(pv: OperationPreview | null): boolean {
  if (!pv || pv.blocked) return false;
  return (
    pv.changedCells > 0 ||
    pv.removedCount > 0 ||
    pv.removedColumns.length > 0 ||
    pv.renamed.length > 0 ||
    pv.addedColumns.length > 0 ||
    pv.reordered ||
    pv.converted !== null ||
    pv.resultRows !== null
  );
}
