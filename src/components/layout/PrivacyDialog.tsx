import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

const POINTS: [string, string][] = [
  ['Files are read on your device', 'Your file is opened by your browser and processed in a background worker in this tab. It is never uploaded.'],
  ['Processing is local', 'Analysis runs in DuckDB compiled to WebAssembly, inside your browser. There is no server-side database.'],
  ['No network access for data', 'The published app ships a Content-Security-Policy that only allows requests to its own origin, so the browser blocks sending data anywhere else. Database extensions are never downloaded.'],
  ['No tracking', 'No analytics, telemetry, cookies or accounts. Cell values are never logged.'],
  ['Nothing is stored unless you choose to', 'Closing the tab discards the data. Exports and recipes are saved only when you click download.'],
];

export function PrivacyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="How your data stays private" description="Tidyfold is a static web app. There is no backend to send data to." footer={<Button variant="primary" onClick={onClose}>Got it</Button>}>
      <ul className="space-y-3.5">
        {POINTS.map(([t, d]) => (
          <li key={t} className="flex gap-3">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Check className="size-3" />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-800">{t}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{d}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Want proof? Open your browser's developer tools, go to the Network tab, and import a file: no request contains your data.
      </p>
    </Dialog>
  );
}
