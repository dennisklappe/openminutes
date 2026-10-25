import { and, lte, meetings, sql, type Database } from '@openminutes/db';
import { z } from 'zod';

const UPCOMING_DEFAULT = { days: 7, limit: 10 } as const;
const UPCOMING_MAX = { days: 30, limit: 20 } as const;

export const upcomingQuery = z.object({
  days: z.coerce.number().int().min(1).max(UPCOMING_MAX.days).default(UPCOMING_DEFAULT.days),
  limit: z.coerce.number().int().min(1).max(UPCOMING_MAX.limit).default(UPCOMING_DEFAULT.limit),
});

export const scheduledAt = sql`coalesce(${meetings.scheduledStart}, ${meetings.createdAt})`;

export const upcomingCondition = () =>
  sql`(${meetings.status} = 'scheduled' or (${meetings.status} = 'skipped' and (${meetings.scheduledStart} is null or ${meetings.scheduledStart} > now())))`;

export async function countUpcoming(db: Database, days?: number): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(meetings)
    .where(
      and(
        upcomingCondition(),
        days === undefined ? undefined : lte(scheduledAt, sql`now() + ${`${days} days`}::interval`),
      ),
    );
  return row?.total ?? 0;
}
