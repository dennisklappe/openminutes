import { sanitizeSummaryMarkdown } from '@openminutes/core';
import { and, desc, eq, summaries, type Database, type SummaryOrigin } from '@openminutes/db';

export async function findDoneSummary(db: Database, meetingId: string, summaryId?: string) {
  const [row] = await db
    .select()
    .from(summaries)
    .where(
      and(
        eq(summaries.meetingId, meetingId),
        eq(summaries.status, 'done'),
        ...(summaryId ? [eq(summaries.id, summaryId)] : []),
      ),
    )
    .orderBy(desc(summaries.createdAt))
    .limit(1);
  return row;
}

export async function hasPendingSummary(db: Database, meetingId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: summaries.id })
    .from(summaries)
    .where(and(eq(summaries.meetingId, meetingId), eq(summaries.status, 'pending')))
    .limit(1);
  return row !== undefined;
}

export async function addSummaryVersion(
  db: Pick<Database, 'insert'>,
  meetingId: string,
  version: {
    origin: Exclude<SummaryOrigin, 'ai'>;
    content: string;
    restoredFrom?: string;
    aiEdit?: { provider: string; model: string; instruction: string };
  },
): Promise<string> {
  const [row] = await db
    .insert(summaries)
    .values({
      meetingId,
      provider: version.aiEdit?.provider ?? 'manual',
      model: version.aiEdit?.model ?? '',
      status: 'done',
      origin: version.origin,
      content: sanitizeSummaryMarkdown(version.content),
      restoredFrom: version.restoredFrom ?? null,
      note: version.aiEdit?.instruction ?? null,
    })
    .returning({ id: summaries.id });
  if (!row) throw new Error('Summary insert returned no row');
  return row.id;
}
