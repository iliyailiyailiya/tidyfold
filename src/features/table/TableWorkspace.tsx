import { useEffect, useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Filter,
  Loader2,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Menu, MenuItem, MenuLabel } from '@/components/ui/menu';
import type { ColumnFilter } from '@/engine/dataset/filters';
import type { ColumnSchema } from '@/engine/history/operations';
import type { Page } from '@/engine/dataset/session';
import { useStudio } from '@/state/studio';
import { cn, fmt } from '@/lib/utils';
import { describeFilter } from '@/engine/dataset/filters';
import { TypeBadge } from '../import/TypeBadge';
import { ColumnMenu } from './ColumnMenu';
import { CellInspector, type SelectedCell } from './CellInspector';
import { CellValue } from './CellValue';

type GridRow = { id: number; values: (string | null)[] };

const PAGE_SIZES = [100, 250, 500, 1000];

export function TableWorkspace() {
  const { session, version, notify, filters, setFilters } = useStudio();
  const schema = session?.schema ?? [];
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(250);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [sizing, setSizing] = useState<ColumnSizingState>({});
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [colsMenu, setColsMenu] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Reset paging when the query shape changes.
  useEffect(() => setPageIndex(0), [debounced, filters, sorting, version]);

  // Drop filters/sort on columns that no longer exist (rename/remove/undo).
  useEffect(() => {
    const names = new Set(schema.map((c) => c.name));
    setFilters((f) => (f.every((x) => names.has(x.column)) ? f : f.filter((x) => names.has(x.column))));
    setSorting((s) => (s.every((x) => names.has(x.id)) ? s : []));
    setSelected(null);
  }, [schema]);

  useEffect(() => {
    if (!session) return;
    let live = true;
    setLoading(true);
    const sort = sorting[0] ? { column: sorting[0].id, desc: sorting[0].desc } : null;
    session
      .page({ offset: pageIndex * pageSize, limit: pageSize, sort, search: debounced, filters })
      .then((p) => live && setPage(p))
      .catch((e: Error) => live && notify({ tone: 'error', message: `Query failed: ${e.message}` }))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [session, version, pageIndex, pageSize, sorting, debounced, filters, notify]);

  const rows = useMemo<GridRow[]>(() => (page ? page.rows.map((values, i) => ({ id: page.rowIds[i]!, values })) : []), [page]);

  const columns = useMemo<ColumnDef<GridRow>[]>(
    () =>
      schema.map((c, i) => ({
        id: c.name,
        accessorFn: (r) => r.values[i],
        header: c.name,
        size: Math.min(320, Math.max(110, c.name.length * 8 + 70)),
        minSize: 60,
        maxSize: 900,
        meta: { schema: c },
      })),
    [schema],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility: visibility, columnSizing: sizing },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onColumnSizingChange: setSizing,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    getRowId: (r) => String(r.id),
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 12,
  });
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pageIndex, version, debounced, filters, sorting]);

  if (!session) return null;
  const total = page?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : pageIndex * pageSize + 1;
  const to = Math.min(total, (pageIndex + 1) * pageSize);
  const hidden = schema.filter((c) => visibility[c.name] === false).length;
  const totalWidth = table.getTotalSize() + 64;
  const vItems = virtualizer.getVirtualItems();
  const padTop = vItems[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (vItems.at(-1)?.end ?? 0);

  const addFilter = (f: ColumnFilter) => setFilters((fs) => [...fs.filter((x) => x.column !== f.column), f]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all columns…" className="h-8 pl-8 text-[13px]" aria-label="Search all columns" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Clear search">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {filters.map((f) => (
          <span key={f.column} className="inline-flex h-7 items-center gap-1 rounded-full bg-brand-50 pr-1 pl-2.5 text-xs text-brand-700">
            <Filter className="size-3" />
            <span className="font-medium">{f.column}</span>
            <span>{describeFilter(f)}</span>
            <button onClick={() => setFilters((fs) => fs.filter((x) => x !== f))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={`Remove filter on ${f.column}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {loading && <Loader2 className="size-4 animate-spin text-slate-400" />}
          <Button size="sm" onClick={(e) => setColsMenu(colsMenu ? null : e.currentTarget)}>
            <Columns3 /> Columns {hidden > 0 && <span className="text-brand-600">({schema.length - hidden}/{schema.length})</span>}
          </Button>
        </div>
        <Menu anchor={colsMenu} open={!!colsMenu} onClose={() => setColsMenu(null)} align="end" width={260}>
          <MenuLabel>Show columns</MenuLabel>
          <div className="max-h-80 overflow-auto">
            {schema.map((c) => (
              <label key={c.name} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-slate-50">
                <input type="checkbox" className="accent-brand-600" checked={visibility[c.name] !== false} onChange={(e) => setVisibility((v) => ({ ...v, [c.name]: e.target.checked }))} />
                <span className="flex-1 truncate">{c.name}</span>
                <TypeBadge type={c.type} compact />
              </label>
            ))}
          </div>
          {hidden > 0 && <MenuItem onSelect={() => setVisibility({})}>Show all</MenuItem>}
        </Menu>
      </div>

      {/* grid */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto bg-white" role="grid" aria-rowcount={total} aria-busy={loading}>
        <table className="border-separate border-spacing-0 text-[13px]" style={{ width: totalWidth }}>
          <thead className="sticky top-0 z-20">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                <th className="sticky left-0 z-30 w-16 border-r border-b border-slate-200 bg-slate-50 px-2 text-right text-[11px] font-normal text-slate-400">#</th>
                {hg.headers.map((h) => {
                  const col = (h.column.columnDef.meta as { schema: ColumnSchema }).schema;
                  const sorted = h.column.getIsSorted();
                  return (
                    <th key={h.id} style={{ width: h.getSize() }} className="group relative border-r border-b border-slate-200 bg-slate-50 p-0 text-left font-medium text-slate-700">
                      <ColumnMenu
                        column={col}
                        sorted={sorted}
                        onSort={(desc) => setSorting(desc === null ? [] : [{ id: col.name, desc }])}
                        onFilter={addFilter}
                        onHide={() => setVisibility((v) => ({ ...v, [col.name]: false }))}
                      >
                        <span className="truncate">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                        {sorted === 'asc' && <ArrowUp className="size-3.5 shrink-0 text-brand-600" />}
                        {sorted === 'desc' && <ArrowDown className="size-3.5 shrink-0 text-brand-600" />}
                        <TypeBadge type={col.type} compact className="ml-auto shrink-0" />
                      </ColumnMenu>
                      <div
                        onMouseDown={h.getResizeHandler()}
                        onTouchStart={h.getResizeHandler()}
                        onDoubleClick={() => h.column.resetSize()}
                        className={cn('absolute top-0 -right-[3px] z-10 h-full w-1.5 cursor-col-resize touch-none select-none', h.column.getIsResizing() ? 'bg-brand-500' : 'hover:bg-brand-300')}
                        role="separator"
                        aria-label={`Resize ${col.name}`}
                      />
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr>
                <td style={{ height: padTop }} />
              </tr>
            )}
            {vItems.map((vi) => {
              const row = tableRows[vi.index]!;
              return (
                <tr key={row.id} className="group/row">
                  <td className="sticky left-0 z-10 h-[33px] border-r border-b border-slate-100 bg-white px-2 text-right text-[11px] text-slate-400 tabular group-hover/row:bg-slate-50">
                    {row.original.id}
                  </td>
                  {row.getVisibleCells().map((cell) => {
                    const col = (cell.column.columnDef.meta as { schema: ColumnSchema }).schema;
                    const v = cell.getValue() as string | null;
                    const isSel = selected?.rowId === row.original.id && selected.column === col.name;
                    return (
                      <td
                        key={cell.id}
                        style={{ width: cell.column.getSize(), maxWidth: cell.column.getSize() }}
                        onClick={() => setSelected({ rowId: row.original.id, column: col.name, type: col.type, value: v })}
                        className={cn(
                          'h-[33px] cursor-default truncate border-r border-b border-slate-100 px-2.5 whitespace-nowrap group-hover/row:bg-slate-50/70',
                          col.type !== 'text' && 'text-right tabular',
                          isSel && 'bg-brand-50! outline-2 -outline-offset-2 outline-brand-500',
                        )}
                      >
                        <CellValue value={v} type={col.type} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {padBottom > 0 && (
              <tr>
                <td style={{ height: padBottom }} />
              </tr>
            )}
          </tbody>
        </table>
        {page && total === 0 && (
          <div className="absolute inset-x-0 top-24 text-center text-sm text-slate-500">
            No rows match.{' '}
            <button className="text-brand-600 underline-offset-2 hover:underline" onClick={() => (setSearch(''), setFilters([]))}>
              Clear search and filters
            </button>
          </div>
        )}
      </div>

      {selected && <CellInspector cell={selected} onClose={() => setSelected(null)} onFilter={addFilter} />}

      {/* footer / pagination */}
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-4 py-2 text-[13px] text-slate-600">
        <span className="tabular">
          {fmt(from)}–{fmt(to)} of {fmt(total)} rows
          {(debounced || filters.length > 0) && <span className="text-slate-400"> (filtered)</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Rows per page
            <Select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="h-7 text-xs">
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
          <Button size="icon" variant="ghost" disabled={pageIndex === 0} onClick={() => setPageIndex((p) => p - 1)} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          <span className="tabular text-xs">
            Page {pageIndex + 1} / {fmt(pages)}
          </span>
          <Button size="icon" variant="ghost" disabled={pageIndex + 1 >= pages} onClick={() => setPageIndex((p) => p + 1)} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
