import { isSettled } from '@openminutes/core';
import {
  and,
  ilike,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lte,
  not,
  meetingPlatforms,
  meetings,
  meetingStatuses,
  or,
  sql,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { MeetingListItemDto, UpcomingMeetingsDto } from '../dto.js';
import { iso, toMeetingDto } from './meeting-dto.js';
import { countUpcoming, scheduledAt, upcomingCondition, upcomingQuery } from './upcoming.js';

const listFilter = z.object({
  q: z.string().trim().max(200).optional(),
  platform: z.enum(meetingPlatforms).optional(),
  /** One status or a comma separated set, for example `status=failed,transcribed`. */
  status: z
    .string()
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.enum(meetingStatuses)).min(1).max(meetingStatuses.length))
    .optional(),
  upcoming: z.literal('hide').optional(),
  scope: z.enum(['active', 'archived', 'bin']).default('active'),
});

const scopeCondition = {
  active: and(isNull(meetings.archivedAt), isNull(meetings.deletedAt)),
  archived: and(isNotNull(meetings.archivedAt), isNull(meetings.deletedAt)),
  bin: isNotNull(meetings.deletedAt),
} as const;

export function listRoutes(db: Database): Hono {
  const routes = new Hono();

  const meetingConditions = ({ q, platform, status, scope }: z.infer<typeof listFilter>) => {
    const pattern = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : undefined;
    const transcriptMatch = (like: string) =>
      exists(
        db
          .select({ one: sql`1` })
          .from(transcriptSegments)
          .where(
            and(
              eq(transcriptSegments.meetingId, meetings.id),
              ilike(transcriptSegments.text, like),
            ),
          ),
      );
    return [
      pattern ? or(ilike(meetings.title, pattern), transcriptMatch(pattern)) : undefined,
      platform ? eq(meetings.platform, platform) : undefined,
      status ? inArray(meetings.status, status) : undefined,
      scopeCondition[scope],
    ];
  };

  const listItems = async (
    where: ReturnType<typeof and>,
    order: ReturnType<typeof sql>,
    limit?: number,
  ): Promise<MeetingListItemDto[]> => {
    const query = db
      .select({
        meeting: meetings,
        durationMs: sql<
          number | null
        >`(select max(duration_ms) from audio_files where audio_files.meeting_id = meetings.id)`,
        participantCount: sql<number>`(select count(*)::int from participants where participants.meeting_id = meetings.id and not participants.is_bot)`,
        skippedSeriesId: sql<
          string | null
        >`(select id from skipped_series where skipped_series.series_key = meetings.series_key)`,
      })
      .from(meetings)
      .where(where)
      .orderBy(order);
    const rows = await (limit === undefined ? query : query.limit(limit));
    const now = new Date();
    return rows.map(({ meeting, durationMs, participantCount, skippedSeriesId }) => ({
      ...toMeetingDto(meeting),
      series: meeting.seriesKey ? { skippedId: skippedSeriesId } : null,
      scheduledStart: iso(meeting.scheduledStart),
      durationMs,
      participantCount,
      canDelete: isSettled(meeting, now),
    }));
  };

  routes.get('/upcoming', async (c) => {
    const query = upcomingQuery.safeParse(c.req.query());
    if (!query.success) return c.json({ error: 'Invalid upcoming window' }, 400);
    const { days, limit } = query.data;
    const [items, total, all] = await Promise.all([
      listItems(
        and(upcomingCondition(), lte(scheduledAt, sql`now() + ${`${days} days`}::interval`)),
        sql`${scheduledAt} asc`,
        limit,
      ),
      countUpcoming(db, days),
      countUpcoming(db),
    ]);
    return c.json<UpcomingMeetingsDto>({ items, total, all });
  });

  routes.get('/', async (c) => {
    const filter = listFilter.safeParse(c.req.query());
    if (!filter.success) return c.json({ error: 'Invalid filter' }, 400);
    return c.json<MeetingListItemDto[]>(
      await listItems(
        and(
          ...meetingConditions(filter.data),
          filter.data.upcoming === 'hide' ? not(upcomingCondition()) : undefined,
        ),
        filter.data.scope === 'bin'
          ? sql`${meetings.deletedAt} desc`
          : sql`coalesce(${meetings.startedAt}, ${meetings.scheduledStart}, ${meetings.createdAt}) desc`,
      ),
    );
  });

  return routes;
}
