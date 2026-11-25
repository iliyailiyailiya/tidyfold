import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { OperationPreview } from '@/engine/dataset/preview';
import { describeOperation } from '@/engine/history/operations';
import { Note, PreviewDiff, PreviewSummary } from '@/features/shared/preview';
import { useStudio } from '@/state/studio';
import { CleanRecommendations } from './CleanRecommendations';

/** The Clean workspace hosts the "Clean Everything" review flow and any
 *  single change sent here by an Overview "Review" button. */
export function CleanWorkspace() {
  const { session, cleanDraft, openInClean, preview, apply, notify, undo } = useStudio();
  const [pv, setPv] = useState<OperationPreview | null>(null);
  const [pvError, setPvError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!cleanDraft) {
      setPv(null);
      setPvError(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    preview(cleanDraft)
      .then((p) => live && (setPv(p), setPvError(null)))
      .catch((e: unknown) => live && (setPv(null), setPvError(e instanceof Error ? e.message : String(e))))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [cleanDraft, preview]);

  if (!session) return null;

  const canApply = !!cleanDraft && !!pv && !pv.blocked && !pvError && !loading && !applying;

  const doApply = async () => {
    if (!cleanDraft || !canApply) return;
    const label = describeOperation(cleanDraft);
    setApplying(true);
    const ok = await apply(cleanDraft);
    setApplying(false);
    if (ok) {
      openInClean(null);
      notify({ tone: 'success', message: label, action: { label: 'Undo', run: () => void undo() } });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      {cleanDraft && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Review this change</CardTitle>
              <CardDescription>Check what will change before it becomes a step in your history.</CardDescription>
            </div>
            <Button size="sm" variant="ghost" onClick={() => openInClean(null)}>Cancel</Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[13px] font-medium">{describeOperation(cleanDraft)}</p>
            <p className="text-[13px] text-slate-600"><PreviewSummary pv={pv} /></p>
            {pvError && <Note tone="error" text={pvError} />}
            {pv?.notes.map((n, i) => <Note key={i} tone={n.tone} text={n.text} examples={n.examples} />)}
            {pv && <PreviewDiff pv={pv} />}
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => void doApply()} disabled={!canApply}>
                {applying ? 'Applying…' : 'Apply this step'}
              </Button>
              <Button variant="ghost" onClick={() => openInClean(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}
      <CleanRecommendations />
    </div>
  );
}
