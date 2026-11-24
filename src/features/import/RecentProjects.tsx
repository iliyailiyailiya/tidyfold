import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useStudio } from '@/state/studio';
import { projectStore, type StoredProject } from '../clean/projectStore';

/**
 * Phase 6: Landing "Recent projects".
 *
 * Lists the last saved project ("Continue" → load as a File via onFile;
 * "Delete" → `projectStore.delete()`).
 */
export function RecentProjects({ onFile }: { onFile: (f: File) => void }) {
  const { session } = useStudio();
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    projectStore
      .get()
      .then((p) => setProjects(p ? [p] : []))
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (projects.length === 0) return null;

  const doDelete = async (p: StoredProject) => {
    setDeleting(p.id);
    setError(null);
    try {
      await projectStore.delete();
      setProjects([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(null);
    }
  };

  const doContinue = async (p: StoredProject) => {
    const file = new File([], p.fileName, { type: 'text/csv' });
    (file as unknown as { __tidyfoldRestoreName?: boolean }).__tidyfoldRestoreName = true;
    onFile(file);
  };

  return (
    <Card className="max-w-2xl border-dashed border-brand-200 bg-brand-50/40">
      <CardHeader>
        <CardTitle className="text-[13px]">Continue this project later</CardTitle>
        <CardDescription className="text-[12px]">Recent projects saved in this browser (opt-in).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {projects.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-brand-800">“{p.name}”</p>
              <p className="text-[11px] text-slate-500">Saved {new Date(p.savedAt).toLocaleString()}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="secondary" onClick={() => void doContinue(p)} title={`Re-open “${p.name}” and replay its history`}>
                Continue
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void doDelete(p)} disabled={deleting !== null} title="Delete this saved project (data is discarded)">
                Delete
              </Button>
            </div>
          </div>
        ))}
        {error && <p className="text-[11px] text-rose-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
