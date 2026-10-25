import { exactKey } from '@openminutes/core';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  meetingPlatforms,
  meetings,
  minuteFolders,
  or,
  participants,
  sql,
  summaries,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import { z } from 'zod';
import type { FolderDto, LibraryDto, LibraryMeetingDto } from '../dto.js';
import { listCompanies } from './companies.js';
import { summarySnippet } from './snippet.js';

const GENERIC_NAME = /^Speaker \d+$/;
const date = z.iso.date();

export const libraryFilter = z.object({
  q: z.string().trim().max(200).optional(),
  platform: z.enum(meetingPlatforms).optional(),
  from: date.optional(),
  to: date.optional(),
});

export type LibraryFilter = z.infer<typeof libraryFilter>;

const heldAt = sql<Date>`coalesce(${meetings.startedAt}, ${meetings.scheduledStart}, ${meetings.createdAt})`;

const hasTranscript = exists(
  sql`(select 1 from ${transcriptSegments} where ${transcriptSegments.meetingId} = ${meetings.id})`,
);

function conditions(db: Database, { q, platform, from, to }: LibraryFilter) {
  const like = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : undefined;
  const match = like
    ? or(
        ilike(meetings.title, like),
        ilike(meetings.company, like),
        exists(
          db
            .select({ one: sql`1` })
            .from(participants)
            .where(
              and(
                eq(participants.meetingId, meetings.id),
                ilike(participants.displayName, like),
                eq(participants.isBot, false),
              ),
            ),
        ),
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
        ),
      )
    : undefined;
  return [
    eq(meetings.status, 'transcribed'),
    isNull(meetings.archivedAt),
    isNull(meetings.deletedAt),
    hasTranscript,
    match,
    platform ? eq(meetings.platform, platform) : undefined,
    from ? gte(heldAt, sql`${from}::date`) : undefined,
    to ? lt(heldAt, sql`${to}::date + 1`) : undefined,
  ];
}

function peopleByMeeting(rows: { meetingId: string; displayName: string }[]) {
  const people = new Map<string, Map<string, string>>();
  for (const { meetingId, displayName } of rows) {
    const name = displayName.trim();
    if (name === '' || GENERIC_NAME.test(name)) continue;
    const names = people.get(meetingId) ?? new Map<string, string>();
    if (!names.has(exactKey(name))) names.set(exactKey(name), name);
    people.set(meetingId, names);
  }
  return people;
}

export async function loadFolders(db: Database): Promise<FolderDto[]> {
  const rows = await db.select().from(minuteFolders).orderBy(asc(minuteFolders.name));
  return rows.map(({ id, name, parentId }) => ({ id, name, parentId }));
}

export async function loadLibrary(db: Database, filter: LibraryFilter): Promise<LibraryDto> {
  const rows = await db
    .select({
      meeting: meetings,
      heldAt,
      durationMs: sql<
        number | null
      >`(select max(duration_ms) from audio_files where audio_files.meeting_id = meetings.id)`,
    })
    .from(meetings)
    .where(and(...conditions(db, filter)))
    .orderBy(desc(heldAt));
  const ids = rows.map((row) => row.meeting.id);
  const [people, latest, folders, companies] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select({ meetingId: participants.meetingId, displayName: participants.displayName })
          .from(participants)
          .where(and(inArray(participants.meetingId, ids), eq(participants.isBot, false)))
          .orderBy(asc(participants.displayName)),
    ids.length === 0
      ? []
      : db
          .selectDistinctOn([summaries.meetingId], {
            meetingId: summaries.meetingId,
            content: sql<string>`left(${summaries.content}, 2000)`,
          })
          .from(summaries)
          .where(and(inArray(summaries.meetingId, ids), eq(summaries.status, 'done')))
          .orderBy(summaries.meetingId, desc(summaries.createdAt)),
    loadFolders(db),
    listCompanies(db),
  ]);
  const names = peopleByMeeting(people);
  const snippets = new Map(latest.map((row) => [row.meetingId, summarySnippet(row.content)]));
  return {
    meetings: rows.map(({ meeting, heldAt: held, durationMs }): LibraryMeetingDto => ({
      id: meeting.id,
      title: meeting.title,
      platform: meeting.platform,
      heldAt: new Date(held).toISOString(),
      durationMs,
      people: [...(names.get(meeting.id)?.values() ?? [])],
      company: meeting.company,
      companySource: meeting.companySource,
      folderId: meeting.folderId,
      snippet: snippets.get(meeting.id) ?? '',
    })),
    folders,
    companies,
  };
}
