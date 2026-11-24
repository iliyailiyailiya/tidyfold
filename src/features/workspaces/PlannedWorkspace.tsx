import { CheckCircle2, Clock, Construction } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useStudio, type Workspace } from '@/state/studio';

const PLANS: Record<'transform' | 'explore', { title: string; intro: string; now: string[]; planned: string[] }> = {
  transform: {
    title: 'Transform',
    intro: 'Reshape columns and rows with a visual builder.',
    now: ['Rename column', 'Remove column', 'Convert type (Clean workspace)', 'Find and replace (Clean → Replace values)'],
    planned: ['Split and merge columns', 'Extract text', 'Calculated columns', 'Filter rows (as a recorded step)', 'Group and aggregate', 'Regex find and replace'],
  },
  explore: {
    title: 'Explore',
    intro: 'Understand distributions and spot outliers.',
    now: ['Per-column profile in Overview', 'Cell & column inspector in Table'],
    planned: ['Histograms and value distributions', 'Category frequency charts', 'Missing-value map', 'Outlier detection', 'Facets that filter the table'],
  },
};

export function PlannedWorkspace({ which }: { which: Exclude<Workspace, 'overview' | 'table' | 'clean'> }) {
  const { setWorkspace } = useStudio();
  const p = PLANS[which];
  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
          <Construction className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{p.title} workspace isn't built yet</h1>
          <p className="text-sm text-slate-500">{p.intro}</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="size-4" /> Available today
          </h2>
          <ul className="space-y-2 text-[13px] text-slate-600">
            {p.now.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <button onClick={() => setWorkspace('table')} className="mt-4 text-[13px] font-medium text-brand-600 hover:underline">
            Open the Table and use a column's menu →
          </button>
        </Card>
        <Card className="border-dashed p-5 shadow-none">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Clock className="size-4" /> Planned
          </h2>
          <ul className="space-y-2 text-[13px] text-slate-500">
            {p.planned.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
