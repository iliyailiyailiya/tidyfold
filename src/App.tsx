import { useState } from 'react';
import { Lock } from 'lucide-react';
import { AppShell, Credit, Logo } from '@/components/layout/AppShell';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { PrivacyDialog } from '@/components/layout/PrivacyDialog';
import { Toasts } from '@/components/layout/Toasts';
import { ACCEPT, Landing, SampleWarning } from '@/features/import/Landing';
import { ImportWizard } from '@/features/import/ImportWizard';
import { StudioProvider, useStudio } from '@/state/studio';

function Studio() {
  const { session } = useStudio();
  const [pending, setPending] = useState<File | null>(null);
  const [privacy, setPrivacy] = useState(false);

  const pickFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.onchange = () => input.files?.[0] && setPending(input.files[0]);
    input.click();
  };

  return (
    <>
      {session ? (
        <AppShell onNewFile={pickFile} />
      ) : (
        <div className="flex h-full flex-col overflow-auto">
          <header className="flex items-center justify-between px-6 py-4">
            <Logo />
            <div className="flex items-center gap-2">
              <button onClick={() => setPrivacy(true)} className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800">
                <Lock className="size-3.5" /> Privacy
              </button>
              <ThemeToggle />
            </div>
          </header>
          <div className="flex-1">
            <Landing onFile={setPending} />
          </div>
          <footer className="px-6 pb-6 text-center">
            <Credit />
          </footer>
          <div className="space-y-3 px-6 pb-6">
            <SampleWarning />
          </div>
        </div>
      )}
      {pending && <ImportWizard key={`${pending.name}-${pending.lastModified}-${pending.size}`} file={pending} onClose={() => setPending(null)} />}
      <PrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
      <Toasts />
    </>
  );
}

export default function App() {
  return (
    <StudioProvider>
      <Studio />
    </StudioProvider>
  );
}
