import { useState } from 'react';
import { BarChart3, ChevronDown, Download, FileJson, FileSpreadsheet, FileText, FilePlus2, History, LayoutDashboard, Loader2, Lock, Redo2, Shapes, Sparkles, Table2, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Menu, MenuItem, MenuLabel } from '@/components/ui/menu';
import { CleanWorkspace } from '@/features/clean/CleanWorkspace';
import { HistoryPanel } from '@/features/history/HistoryPanel';
import { OverviewWorkspace } from '@/features/overview/OverviewWorkspace';
import { TableWorkspace } from '@/features/table/TableWorkspace';
import { TransformWorkspace } from '@/features/transform/TransformWorkspace';
import { PlannedWorkspace } from '@/features/workspaces/PlannedWorkspace';
import { useStudio, type Workspace } from '@/state/studio';
import { cn, fmt, modKey } from '@/lib/utils';
import { PrivacyDialog } from './PrivacyDialog';

const NAV: { id: Workspace; label: string; icon: typeof Table2; ready: boolean }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, ready: true },
  { id: 'table', label: 'Table', icon: Table2, ready: true },
  { id: 'clean', label: 'Clean', icon: Sparkles, ready: true },
  { id: 'transform', label: 'Transform', icon: Shapes, ready: true },
  { id: 'explore', label: 'Explore', icon: BarChart3, ready: false },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-6" />
      <span className="text-[15px] font-semibold tracking-tight">Tidyfold</span>
    </div>
  );
}

export function Credit({ className }: { className?: string }) {
  return (
    <a
      href="https://www.instagram.com/iliyabarcari/"
      target="_blank"
      rel="noopener noreferrer"
      className={cn('text-xs text-slate-400 transition-colors hover:text-brand-600', className)}
    >
      created by <span className="font-medium">@iliyabarcari</span>
    </a>
  );
}

export function AppShell({ onNewFile }: { onNewFile: () => void }) {
  const { session, workspace, setWorkspace, undo, redo, exportData, busy, profile } = useStudio();
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [privacy, setPrivacy] = useState(false);
  // docked on wide screens, a drawer (closed by default) on smaller ones
  const [historyOpen, setHistoryOpen] = useState(() => window.matchMedia('(min-width: 1280px)').matches);
  if (!session) return null;
  const { cursor, ops } = session.history;

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* sidebar / top nav */}
      <nav aria-label="Workspaces" className="flex shrink-0 flex-col border-slate-200 bg-white lg:w-56 lg:border-r">
        <div className="flex items-center justify-between px-4 py-3 lg:py-4">
          <Logo />
          <Button size="sm" variant="ghost" className="lg:hidden" onClick={onNewFile}>
            <FilePlus2 /> New
          </Button>
        </div>
        <ul className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:pb-0">
          {NAV.map((n) => (
            <li key={n.id}>
              <button
                onClick={() => setWorkspace(n.id)}
                aria-current={workspace === n.id ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors',
                  workspace === n.id ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <n.icon className="size-4" />
                {n.label}
                {!n.ready && (
                  <Badge tone="outline" className="ml-auto text-[10px]">
                    soon
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
        <Credit className="px-4 pb-2 lg:hidden" />
        <div className="mt-auto hidden p-3 lg:block">
          <button onClick={() => setPrivacy(true)} className="w-full rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left transition-colors hover:bg-emerald-50">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
              <Lock className="size-3.5" /> 100% local
            </p>
            <p className="mt-1 text-[11.5px] leading-snug text-emerald-700/90">Your data never leaves this browser tab. How?</p>
          </button>
          <Credit className="mt-3 block text-center" />
        </div>
      </nav>

      {/* main */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-900" title={session.fileName}>
              {session.name}
            </h1>
            <p className="text-xs text-slate-500 tabular">
              {profile ? `${fmt(profile.rows)} rows · ${profile.columns.length} columns` : '…'}
              {cursor > 0 && ` · ${cursor} change${cursor === 1 ? '' : 's'}`}
            </p>
          </div>
          {busy && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500" role="status">
              <Loader2 className="size-3.5 animate-spin" /> {busy}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="icon" variant="ghost" onClick={undo} disabled={cursor === 0 || !!busy} title={`Undo (${modKey}Z)`} aria-label="Undo">
              <Undo2 />
            </Button>
            <Button size="icon" variant="ghost" onClick={redo} disabled={cursor >= ops.length || !!busy} title={`Redo (⇧${modKey}Z)`} aria-label="Redo">
              <Redo2 />
            </Button>
            <Button size="sm" variant={historyOpen ? 'subtle' : 'ghost'} onClick={() => setHistoryOpen((o) => !o)} aria-pressed={historyOpen}>
              <History /> <span className="hidden sm:inline">History</span>
            </Button>
            <Button size="sm" variant="ghost" className="hidden lg:inline-flex" onClick={onNewFile}>
              <FilePlus2 /> Open file
            </Button>
            <Button size="sm" variant="primary" onClick={(e) => setExportAnchor(exportAnchor ? null : e.currentTarget)} disabled={!!busy} aria-haspopup="menu">
              <Download /> Export <ChevronDown className="-mr-1" />
            </Button>
            <Menu anchor={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)} align="end" width={250}>
              <MenuLabel>Download current version</MenuLabel>
              <MenuItem icon={<FileText />} hint=".csv" onSelect={() => (setExportAnchor(null), void exportData('csv'))}>
                CSV
              </MenuItem>
              <MenuItem icon={<FileSpreadsheet />} hint=".xlsx" onSelect={() => (setExportAnchor(null), void exportData('xlsx'))}>
                Excel workbook
              </MenuItem>
              <MenuItem icon={<FileJson />} hint=".json" onSelect={() => (setExportAnchor(null), void exportData('json'))}>
                JSON
              </MenuItem>
              <p className="px-2.5 pt-1.5 pb-1 text-[11px] leading-snug text-slate-400">Built on this device. Nothing is uploaded.</p>
            </Menu>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="min-h-0 min-w-0 flex-1 overflow-auto">
            {workspace === 'overview' && <OverviewWorkspace />}
            {workspace === 'table' && <TableWorkspace />}
            {workspace === 'clean' && <CleanWorkspace />}
            {workspace === 'transform' && <TransformWorkspace />}
            {workspace === 'explore' && <PlannedWorkspace which="explore" />}
          </main>
          {historyOpen && (
            <>
              <div className="fixed inset-0 z-30 bg-slate-900/20 xl:hidden" onClick={() => setHistoryOpen(false)} aria-hidden />
              <div className="fixed inset-y-0 right-0 z-40 w-[min(320px,90vw)] border-l border-slate-200 shadow-pop xl:static xl:z-auto xl:w-72 xl:shadow-none">
                <HistoryPanel onClose={() => setHistoryOpen(false)} />
              </div>
            </>
          )}
        </div>
      </div>
      <PrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
    </div>
  );
}
