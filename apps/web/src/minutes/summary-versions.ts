import type { summaries } from '@openminutes/db';
import type { SummaryDto } from '../dto.js';

type Row = typeof summaries.$inferSelect;
type Version = Pick<SummaryDto, 'version' | 'author' | 'restoredFromVersion' | 'active'>;

function author(row: Row, restoredFrom: number | null): string {
  switch (row.origin) {
    case 'ai':
      return `AI (${row.model || row.provider})`;
    case 'ai-edit':
      return `AI edit (${row.model || row.provider})`;
    case 'edit':
      return 'edited by you';
    case 'link':
      return 'edited via an edit link';
    case 'rename':
      return 'renamed participants';
    case 'restore':
      return restoredFrom === null ? 'restored' : `restored from version ${String(restoredFrom)}`;
  }
}

export function describeVersions(rows: Row[]): (Row & Version)[] {
  const oldestFirst = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const numbers = new Map(oldestFirst.map((row, index) => [row.id, index + 1]));
  const active = oldestFirst.findLast((row) => row.status === 'done')?.id;
  return rows.map((row) => {
    const restoredFrom = row.restoredFrom ? (numbers.get(row.restoredFrom) ?? null) : null;
    return {
      ...row,
      version: numbers.get(row.id) ?? 0,
      author: author(row, restoredFrom),
      restoredFromVersion: restoredFrom,
      active: row.id === active,
    };
  });
}
