import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useStudio } from '@/state/studio';

/** Phase 6: the Clean Workspace wraps the “Clean Everything” review flow. */
export function CleanWorkspace() {
  const { session } = useStudio();
  return (
    <div className="space-y-4 p-4 sm:p-6 lg:max-w-5xl">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Clean everything, one click</CardTitle>
            <CardDescription>
              Analyse your file, see the safe fixes suggested, tick the ones you want — applied as separate undoable steps. Ambiguous fixes need review.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border-dashed border-slate-200 p-4 text-[13px] text-slate-500">
            Clean Everything lives here: scan the imported file, see safe fixes (trim, duplicates, spelling variants), tick what to apply.
            Open it via the “Clean Everything” button in the Overview workspace.
          </div>
        </CardContent>
      </Card>
      {!session && <p className="text-sm text-slate-500">Import a file first.</p>}
    </div>
  );
}
