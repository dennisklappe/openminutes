import { desc, isNotNull, meetings, sql, type Database } from '@openminutes/db';

export async function listCompanies(db: Database): Promise<string[]> {
  const count = sql<number>`count(*)`;
  const rows = await db
    .select({ company: meetings.company })
    .from(meetings)
    .where(isNotNull(meetings.company))
    .groupBy(meetings.company)
    .orderBy(desc(count), meetings.company);
  return rows.flatMap((row) => (row.company ? [row.company] : []));
}
