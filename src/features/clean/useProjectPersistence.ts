import { useCallback, useEffect, useState } from 'react';
import { projectStore } from './projectStore';
import { toRecipe } from '@/engine/history/recipe';

/** Phase 6 — debounced auto-save of the session to IndexedDB (opt-in). */
export function useProjectPersistence(enabled: boolean, session: import('@/engine/dataset/session').DatasetSession | null, version: number) {
  const [saved, setSaved] = useState<{ name: string; savedAt: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveNow = useCallback(() => {
    if (!session) return;
    const ops = session.history.ops;
    const recipe = toRecipe(ops, `${session.name} recipe`, new Date());
    projectStore.put({
      id: 1,
      name: session.name,
      fileName: session.fileName,
      savedAt: new Date().toISOString(),
      operationsJson: JSON.stringify(recipe),
    }).then(() => setSaved({ name: session.name, savedAt: new Date().toISOString() })).catch((e: Error) => setError(e.message));
  }, [session]);

  const deleteProject = useCallback(() => {
    setDeleting(true);
    setError(null);
    projectStore.delete().then(() => setSaved(null)).catch((e: Error) => setError(e.message)).finally(() => setDeleting(false));
  }, []);

  // Debounce: save 1s after any change while enabled.
  useEffect(() => {
    if (!enabled || !session) return;
    const t = setTimeout(saveNow, 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, session, version]);

  // Load the last saved project on mount / when session closes.
  useEffect(() => {
    if (!session) {
      setSaved(null);
      return;
    }
    projectStore.get().then((p) => (p ? setSaved({ name: p.name, savedAt: p.savedAt }) : setSaved(null))).catch(() => undefined);
  }, [session]);

  return { saved, error, deleting, saveNow, deleteProject };
}
