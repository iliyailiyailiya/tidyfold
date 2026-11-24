import type { ColumnType } from '@/engine/import/types';

const EDGE_WS = /^[\s  -​　﻿]+|[\s  -​　﻿]+$/;

export function hasEdgeWhitespace(v: string): boolean {
  return EDGE_WS.test(v);
}

/**
 * Makes surprising whitespace visible: leading/trailing spaces and runs of 2+
 * as ·, tabs as →, newlines as ⏎, non-breaking / zero-width spaces as ⍽.
 * Ordinary single spaces between words are left alone.
 */
export function visibleWhitespace(v: string): string {
  return v
    .replace(/\t/g, '→')
    .replace(/\r?\n/g, '⏎')
    .replace(/[\u00A0\u2000-\u200B\u3000\uFEFF]/g, '⍽')
    .replace(/^ +| +$| {2,}/g, (m) => '·'.repeat(m.length));
}

/** A cell with problem highlighting: empty values and stray edge whitespace. */
export function CellValue({ value, type }: { value: string | null; type: ColumnType }) {
  if (value === null) return <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-400 italic">empty</span>;
  if (type === 'text') {
    if (value.trim() === '') {
      return (
        <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-400 italic" title={value === '' ? 'Empty text' : 'Only whitespace'}>
          {value === '' ? 'empty' : 'blank'}
        </span>
      );
    }
    if (hasEdgeWhitespace(value)) {
      const lead = /^[\s  -​　﻿]+/.exec(value)?.[0] ?? '';
      const trail = /[\s  -​　﻿]+$/.exec(value)?.[0] ?? '';
      const core = value.slice(lead.length, value.length - trail.length);
      return (
        <span title="Starts or ends with whitespace">
          {lead && <span className="rounded-sm bg-amber-100 text-amber-600">{visibleWhitespace(lead)}</span>}
          {core}
          {trail && <span className="rounded-sm bg-amber-100 text-amber-600">{visibleWhitespace(trail)}</span>}
        </span>
      );
    }
  }
  return <>{value}</>;
}
