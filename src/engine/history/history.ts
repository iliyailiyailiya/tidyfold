import type { Operation } from './operations';

/**
 * Immutable operation history. `ops[0..cursor)` are applied; `ops[cursor..]`
 * is the redo stack. All functions return a new state.
 */
export interface HistoryState {
  readonly ops: readonly Operation[];
  readonly cursor: number;
}

export const emptyHistory: HistoryState = { ops: [], cursor: 0 };

export function applied(h: HistoryState): readonly Operation[] {
  return h.ops.slice(0, h.cursor);
}

export const canUndo = (h: HistoryState) => h.cursor > 0;
export const canRedo = (h: HistoryState) => h.cursor < h.ops.length;

/** Appends an operation, discarding any redo branch. */
export function push(h: HistoryState, op: Operation): HistoryState {
  return { ops: [...h.ops.slice(0, h.cursor), op], cursor: h.cursor + 1 };
}

export function undo(h: HistoryState): HistoryState {
  return canUndo(h) ? { ...h, cursor: h.cursor - 1 } : h;
}

export function redo(h: HistoryState): HistoryState {
  return canRedo(h) ? { ...h, cursor: h.cursor + 1 } : h;
}

/** Moves to "after step n" (0 = original data). */
export function jumpTo(h: HistoryState, n: number): HistoryState {
  const cursor = Math.max(0, Math.min(h.ops.length, n));
  return cursor === h.cursor ? h : { ...h, cursor };
}

/**
 * Removes one operation. Later operations are kept and must be replayed from
 * the removal index — the caller learns which index via `firstDirtyStep`.
 */
export function remove(h: HistoryState, id: string): { state: HistoryState; firstDirtyStep: number } {
  const idx = h.ops.findIndex((o) => o.id === id);
  if (idx < 0) return { state: h, firstDirtyStep: h.ops.length };
  const ops = h.ops.filter((o) => o.id !== id);
  const cursor = idx < h.cursor ? h.cursor - 1 : h.cursor;
  return { state: { ops, cursor }, firstDirtyStep: idx };
}

/** Replaces the whole stack (e.g. loading a recipe); everything is applied. */
export function replaceAll(ops: readonly Operation[]): HistoryState {
  return { ops: [...ops], cursor: ops.length };
}
