import {
  activeMeetingStatuses,
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  meetings,
  ne,
  or,
  type Database,
} from '@openminutes/db';

export const RECENT_JOIN_MINUTES = 15;

type MeetingRow = typeof meetings.$inferSelect;

export async function findJoinConflict(
  db: Pick<Database, 'select'>,
  key: string,
  options: { excludeId?: string; now?: Date } = {},
): Promise<MeetingRow | undefined> {
  const since = new Date((options.now ?? new Date()).getTime() - RECENT_JOIN_MINUTES * 60_000);
  const [conflict] = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.joinKey, key),
        isNull(meetings.deletedAt),
        options.excludeId ? ne(meetings.id, options.excludeId) : undefined,
        or(inArray(meetings.status, activeMeetingStatuses), gte(meetings.startedAt, since)),
      ),
    )
    .orderBy(desc(meetings.createdAt))
    .limit(1);
  return conflict;
}
