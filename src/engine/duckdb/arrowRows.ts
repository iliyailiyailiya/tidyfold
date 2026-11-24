import type { Table } from 'apache-arrow';
import type { Row } from './types';

export function arrowToRows<T extends Row>(table: Table): T[] {
  const out: T[] = new Array(table.numRows);
  let i = 0;
  for (const r of table) out[i++] = (r as unknown as { toJSON(): T }).toJSON();
  return out;
}
