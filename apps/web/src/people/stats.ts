import { sql, type Database } from '@openminutes/db';

export interface MeetingStats {
  meetings: number;
  lastSeen: Date | null;
}

/** Meetings each person was in or was invited to (counted once) and the newest of them. */
export const seenStats = (only?: readonly string[]) => sql`
  select s.person_id, count(*)::int as meetings, max(coalesce(m.started_at, m.created_at)) as last_seen
  from (
    select person_id, meeting_id from participants where person_id is not null
    union
    select person_id, meeting_id from meeting_invitees
  ) s
  join meetings m on m.id = s.meeting_id
  where m.deleted_at is null
    ${
      only
        ? sql`and s.person_id in (${sql.join(
            only.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
        : sql``
    }
  group by s.person_id`;

export async function loadMeetingStats(
  db: Database,
  only?: readonly string[],
): Promise<Map<string, MeetingStats>> {
  if (only?.length === 0) return new Map();
  const { rows } = await db.execute<{ person_id: string; meetings: number; last_seen: Date }>(
    seenStats(only),
  );
  return new Map(
    rows.map((row) => [
      row.person_id,
      { meetings: row.meetings, lastSeen: new Date(row.last_seen) },
    ]),
  );
}
