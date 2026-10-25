import { and, asc, eq, summaries, type Database } from '@openminutes/db';
import { EARLIER_INSTRUCTIONS } from './summary-edit.js';

export interface EditLineage {
  instructions: string[];
  manualEdits: boolean;
}

type Row = Pick<typeof summaries.$inferSelect, 'id' | 'origin' | 'note' | 'restoredFrom'>;

export function editLineage(doneOldestFirst: Row[]): EditLineage {
  const indexOf = new Map(doneOldestFirst.map((row, index) => [row.id, index]));
  const instructions: string[] = [];
  let manualEdits = false;
  for (let index = doneOldestFirst.length - 1; index >= 0;) {
    const row = doneOldestFirst[index];
    if (!row || row.origin === 'ai') break;
    if (row.origin === 'restore') {
      const target = row.restoredFrom ? indexOf.get(row.restoredFrom) : undefined;
      if (target === undefined) break;
      index = target;
      continue;
    }
    if (row.origin === 'ai-edit') {
      if (row.note) instructions.unshift(row.note);
    } else if (row.origin !== 'rename') {
      manualEdits = true;
    }
    index--;
  }
  return { instructions, manualEdits };
}

export async function loadEditLineage(db: Database, meetingId: string): Promise<EditLineage> {
  const rows = await db
    .select()
    .from(summaries)
    .where(and(eq(summaries.meetingId, meetingId), eq(summaries.status, 'done')))
    .orderBy(asc(summaries.createdAt), asc(summaries.id));
  return editLineage(rows);
}

export const recentInstructions = (lineage: EditLineage) =>
  lineage.instructions.slice(-EARLIER_INSTRUCTIONS);

export function parseReplay(stored: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(stored ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
