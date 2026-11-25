import { useCallback, useEffect, useRef, useState } from 'react';
import type { DatasetSession } from '@/engine/dataset/session';
import { buildStoredProject } from './projectSnapshot';
import type { ProjectSource } from './projectSource';
import { projectStore } from './projectStore';

/** Opt-in, debounced auto-save of the session to IndexedDB (local only). */
export function useProjectPersistence(enabled: boolean, session: DatasetSession | null, version: number, source: ProjectSource | null) {
  const [saved, setSaved] = useState<{ name: string; savedAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards against an older, slower write finishing after a newer one.
  const saveSeq = useRef(0);

  const saveNow = useCallback(async () => {
    if (!session || !source) return;
    const seq = ++saveSeq.current;
    setError(null);
    try {
      const record = await buildStoredProject(session, source);
      if (seq !== saveSeq.current) return;
      await projectStore.put(record);
      if (seq === saveSeq.current) setSaved({ name: record.name, savedAt: record.savedAt });
    } catch (e) {
      if (seq === saveSeq.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [session, source]);

  const deleteProject = useCallback(async () => {
    saveSeq.current++; // ignore any in-flight save
    setError(null);
    try {
      await projectStore.delete();
      setSaved(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  // Debounce: save 1s after any change while enabled.
  useEffect(() => {
    if (!enabled || !session) return;
    const t = setTimeout(() => void saveNow(), 1000);
    return () => clearTimeout(t);
  }, [enabled, session, version, source, saveNow]);

  // Reflect an existing saved project when a session opens or closes.
  useEffect(() => {
    if (!session) {
      setSaved(null);
      return;
    }
    projectStore.get().then((p) => setSaved(p ? { name: p.name, savedAt: p.savedAt } : null)).catch(() => undefined);
  }, [session]);

  return { saved, error, saveNow, deleteProject };
}
