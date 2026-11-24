import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DatasetSession } from '@/engine/dataset/session';
import { profileTable, type DatasetProfile } from '@/engine/dataset/profile';
import { getDb } from '@/engine/duckdb/browserDb';
import { describeOperation, type OperationSpec } from '@/engine/history/operations';
import { parseRecipe, recipeToOperations, toRecipe } from '@/engine/history/recipe';
import type { ImportResult } from '@/engine/import/types';
import { downloadBytes } from '@/lib/utils';

export type Workspace = 'overview' | 'table' | 'clean' | 'transform' | 'explore';

export interface Toast {
  id: number;
  tone: 'info' | 'success' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

interface StudioValue {
  session: DatasetSession | null;
  /** Changes whenever the visible data changes. */
  version: number;
  workspace: Workspace;
  setWorkspace: (w: Workspace) => void;
  busy: string | null;
  profile: DatasetProfile | null;
  profileError: string | null;
  toasts: Toast[];
  notify: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  openDataset: (r: ImportResult) => Promise<void>;
  closeDataset: () => Promise<void>;
  apply: (spec: OperationSpec) => Promise<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  jumpTo: (step: number) => Promise<void>;
  removeOp: (id: string) => Promise<void>;
  exportCsv: () => Promise<void>;
  exportRecipe: () => void;
  loadRecipe: (file: File) => Promise<void>;
}

const Ctx = createContext<StudioValue | null>(null);

export function useStudio(): StudioValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStudio outside provider');
  return v;
}

export function StudioProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DatasetSession | null>(null);
  const [version, setVersion] = useState(0);
  const [workspace, setWorkspace] = useState<Workspace>('overview');
  const [busy, setBusy] = useState<string | null>(null);
  const [profile, setProfile] = useState<DatasetProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  // Serialises engine calls: one mutation at a time.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const notify = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastSeq.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), t.tone === 'error' ? 8000 : 4500);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  const run = useCallback(
    <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
      const p = queue.current.then(async () => {
        setBusy(label);
        try {
          return await fn();
        } finally {
          setBusy(null);
        }
      });
      queue.current = p.catch(() => undefined);
      return p;
    },
    [],
  );

  const bump = useCallback((s: DatasetSession) => setVersion(s.version), []);

  // Re-profile after every change (debounced through the queue).
  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    setProfileError(null);
    queue.current = queue.current.then(async () => {
      if (cancelled) return;
      try {
        const p = await profileTable(session.database, session.currentTable, session.schema);
        if (!cancelled) setProfile(p);
      } catch (e) {
        if (!cancelled) setProfileError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session, version]);

  const openDataset = useCallback(
    (r: ImportResult) =>
      run('Loading into the local engine…', async () => {
        const db = await getDb();
        const old = session;
        const s = await DatasetSession.create(db, r);
        setProfile(null);
        setSession(s);
        bump(s);
        setWorkspace('overview');
        if (old) await old.dispose();
      }),
    [run, session, bump],
  );

  const closeDataset = useCallback(
    () =>
      run('Closing…', async () => {
        if (session) await session.dispose();
        setSession(null);
        setProfile(null);
      }),
    [run, session],
  );

  const apply = useCallback(
    async (spec: OperationSpec) => {
      if (!session) return false;
      try {
        const op = await run('Applying…', () => session.apply(spec));
        bump(session);
        notify({ tone: 'success', message: describeOperation(op), action: { label: 'Undo', run: () => void undoRef.current() } });
        return true;
      } catch (e) {
        notify({ tone: 'error', message: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [session, run, bump, notify],
  );

  const undo = useCallback(async () => {
    if (!session || session.cursor === 0) return;
    await run('Undoing…', () => session.undo());
    bump(session);
  }, [session, run, bump]);
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const redo = useCallback(async () => {
    if (!session || session.cursor >= session.history.ops.length) return;
    await run('Redoing…', () => session.redo());
    bump(session);
  }, [session, run, bump]);

  const jumpTo = useCallback(
    async (step: number) => {
      if (!session) return;
      await run('Rebuilding…', () => session.jumpTo(step));
      bump(session);
    },
    [session, run, bump],
  );

  const removeOp = useCallback(
    async (id: string) => {
      if (!session) return;
      const res = await run('Replaying history…', () => session.remove(id));
      bump(session);
      if (res.blockedBy) {
        notify({
          tone: 'error',
          message: `Can't remove this step: “${describeOperation(res.blockedBy.op)}” depends on it (${res.blockedBy.error})`,
        });
      }
    },
    [session, run, bump, notify],
  );

  const exportCsv = useCallback(async () => {
    if (!session) return;
    try {
      const bytes = await run('Exporting…', () => session.exportCsv());
      downloadBytes(bytes as BlobPart, `${session.name}-clean.csv`, 'text/csv;charset=utf-8');
    } catch (e) {
      notify({ tone: 'error', message: `Export failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [session, run, notify]);

  const exportRecipe = useCallback(() => {
    if (!session) return;
    const ops = session.history.ops.slice(0, session.cursor);
    const recipe = toRecipe(ops, `${session.name} recipe`);
    downloadBytes(JSON.stringify(recipe, null, 2), `${session.name}.recipe.json`, 'application/json');
  }, [session]);

  const loadRecipe = useCallback(
    async (file: File) => {
      if (!session) return;
      try {
        const recipe = parseRecipe(await file.text());
        const res = await run('Replaying recipe…', () => session.replay(recipeToOperations(recipe)));
        bump(session);
        if (res.failed) {
          notify({
            tone: 'error',
            message: `Recipe doesn't fit this data. Step ${res.failed.index + 1} (“${describeOperation(res.failed.op)}”): ${res.failed.error} Nothing was changed.`,
          });
        } else {
          notify({ tone: 'success', message: `Applied recipe “${recipe.name}” (${recipe.operations.length} steps).` });
        }
      } catch (e) {
        notify({ tone: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [session, run, bump, notify],
  );

  // Global shortcuts: ⌘/Ctrl+Z, ⇧⌘Z / Ctrl+Y.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const value = useMemo<StudioValue>(
    () => ({
      session,
      version,
      workspace,
      setWorkspace,
      busy,
      profile,
      profileError,
      toasts,
      notify,
      dismiss,
      openDataset,
      closeDataset,
      apply,
      undo,
      redo,
      jumpTo,
      removeOp,
      exportCsv,
      exportRecipe,
      loadRecipe,
    }),
    [session, version, workspace, busy, profile, profileError, toasts, notify, dismiss, openDataset, closeDataset, apply, undo, redo, jumpTo, removeOp, exportCsv, exportRecipe, loadRecipe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
