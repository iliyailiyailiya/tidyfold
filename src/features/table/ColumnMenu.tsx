import { useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CaseLower,
  CaseUpper,
  ChevronDown,
  EyeOff,
  Filter,
  FilterX,
  Pencil,
  Scissors,
  Search,
  Trash2,
  CopyMinus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@/components/ui/menu';
import type { ColumnFilter } from '@/engine/dataset/session';
import type { ColumnSchema } from '@/engine/history/operations';
import { useStudio } from '@/state/studio';

export function ColumnMenu({
  column,
  sorted,
  onSort,
  onFilter,
  onHide,
  children,
}: {
  column: ColumnSchema;
  sorted: false | 'asc' | 'desc';
  onSort: (desc: boolean | null) => void;
  onFilter: (f: ColumnFilter) => void;
  onHide: () => void;
  children: ReactNode;
}) {
  const { apply } = useStudio();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState<null | 'rename' | 'contains'>(null);
  const [text, setText] = useState('');
  const isText = column.type === 'text';
  const close = () => setOpen(false);
  const pick = (fn: () => void) => () => {
    close();
    fn();
  };

  const submitPrompt = async () => {
    if (prompt === 'rename') {
      if (await apply({ kind: 'rename_column', params: { column: column.name, to: text } })) setPrompt(null);
    } else if (prompt === 'contains' && text) {
      onFilter({ column: column.name, op: 'contains', value: text });
      setPrompt(null);
    }
  };

  return (
    <>
      <button
        ref={btn}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-1.5 px-2.5 text-left hover:bg-slate-100 focus-visible:-outline-offset-2"
      >
        {children}
        <ChevronDown className="size-3.5 shrink-0 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      <Menu anchor={btn.current} open={open} onClose={close} width={240}>
        <MenuLabel>Sort</MenuLabel>
        <MenuItem icon={<ArrowUp />} onSelect={pick(() => onSort(false))} hint={sorted === 'asc' ? '✓' : undefined}>
          Ascending
        </MenuItem>
        <MenuItem icon={<ArrowDown />} onSelect={pick(() => onSort(true))} hint={sorted === 'desc' ? '✓' : undefined}>
          Descending
        </MenuItem>
        {sorted && (
          <MenuItem icon={<ArrowUpDown />} onSelect={pick(() => onSort(null))}>
            Original order
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuLabel>Filter view</MenuLabel>
        <MenuItem icon={<Search />} onSelect={pick(() => (setText(''), setPrompt('contains')))}>
          Contains…
        </MenuItem>
        <MenuItem icon={<FilterX />} onSelect={pick(() => onFilter({ column: column.name, op: 'blank' }))}>
          Show only empty
        </MenuItem>
        <MenuItem icon={<Filter />} onSelect={pick(() => onFilter({ column: column.name, op: 'notBlank' }))}>
          Hide empty
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Change data · recorded in history</MenuLabel>
        {isText && (
          <>
            <MenuItem icon={<Scissors />} onSelect={pick(() => void apply({ kind: 'trim_whitespace', params: { columns: [column.name] } }))}>
              Trim whitespace
            </MenuItem>
            <MenuItem icon={<CaseLower />} onSelect={pick(() => void apply({ kind: 'change_case', params: { column: column.name, mode: 'lower' } }))}>
              lowercase
            </MenuItem>
            <MenuItem icon={<CaseUpper />} onSelect={pick(() => void apply({ kind: 'change_case', params: { column: column.name, mode: 'upper' } }))}>
              UPPERCASE
            </MenuItem>
          </>
        )}
        <MenuItem icon={<CopyMinus />} onSelect={pick(() => void apply({ kind: 'remove_duplicates', params: { columns: [column.name] } }))}>
          Keep first row per value
        </MenuItem>
        <MenuItem icon={<Pencil />} onSelect={pick(() => (setText(column.name), setPrompt('rename')))}>
          Rename…
        </MenuItem>
        <MenuItem icon={<Trash2 />} danger onSelect={pick(() => void apply({ kind: 'remove_column', params: { column: column.name } }))}>
          Remove column
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<EyeOff />} onSelect={pick(onHide)}>
          Hide from view
        </MenuItem>
      </Menu>
      <Dialog
        open={prompt !== null}
        onClose={() => setPrompt(null)}
        title={prompt === 'rename' ? `Rename “${column.name}”` : `Filter “${column.name}”`}
        description={prompt === 'rename' ? 'Recorded as a step you can undo.' : 'Only changes what you see; the data is not modified.'}
        className="w-[min(420px,calc(100vw-32px))]"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPrompt(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitPrompt} disabled={!text.trim()}>
              {prompt === 'rename' ? 'Rename' : 'Apply filter'}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitPrompt();
          }}
        >
          <Input data-autofocus onFocus={(e) => e.currentTarget.select()} value={text} onChange={(e) => setText(e.target.value)} placeholder={prompt === 'rename' ? 'New column name' : 'Text to look for'} aria-label={prompt === 'rename' ? 'New column name' : 'Text to look for'} />
        </form>
      </Dialog>
    </>
  );
}
