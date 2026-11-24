import { useEffect, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { OperationSpec } from '@/engine/history/operations';
import { planCleanEverything, type CleanPlanItem } from '@/engine/clean/buildClean';
import { useStudio } from '@/state/studio';

/**
 * Phase 6 — "Clean Everything" review flow.
 *
 * Scans the current dataset via `profile`, builds a small set of
 * recommendations (fill-empty in the most-blanks column, dedupe), then shows
 * them as a checkbox list; each Apply creates its own undoable step.
 * Never invents data: "fill empty" is only suggested, never applied by default.
 */
export function CleanRecommendations() {
  const { session, profile, apply, notify, undo } = useStudio();
  const [items, setItems] = useState<CleanPlanItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (profile && session) setItems(planCleanEverything(profile).items);
    else setItems([]);
  }, [profile, session]);

  if (!session || !profile) return null;

  async function applyOne(spec: OperationSpec, label: string) {
    const ok = await apply(spec);
    if (ok) notify({ tone: 'success', message: label, action: { label: 'Undo', run: () => void undo() } });
  }

  return (
    <Card className="max-w-2xl border-brand-200 bg-brand-50/70">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Wand2 className="size-4 text-brand-600" /> Clean Everything
        </CardTitle>
        <CardDescription>Check the ones you want and click Apply — each is its own step in your history.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 && <p className="text-sm text-slate-600">No clean fixes suggested — the data is in good shape.</p>}
        {items.map((item, i) => {
          const key = `clean-${i}-${item.spec.kind}-${item.preview.slice(0, 20)}`;
          return (
            <div key={key} className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={checked.has(key)}
                onChange={() => setChecked((c) => new Set(c).add(key))}
                aria-label={item.preview}
              />
              <span className="flex-1 text-[13px]">{item.preview}</span>
              <Button size="sm" variant="ghost" onClick={() => void applyOne(item.spec, item.preview)} title={item.preview}>
                Apply
              </Button>
            </div>
          );
        })}
        {items.length > 0 && <p className="text-[12px] text-slate-500">Things the app found that look broken but aren’t dangerous.</p>}
      </CardContent>
    </Card>
  );
}
