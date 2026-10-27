import { LOW_SPEAKER_CONFIDENCE, type SettingsStore } from '@openminutes/core';
import {
  and,
  audioFiles,
  desc,
  eq,
  inArray,
  isNull,
  meetings,
  ne,
  or,
  participants,
  people,
  sql,
  transcriptSegments,
  voiceSamples,
  type Database,
} from '@openminutes/db';
import type { PersonChoiceDto, PersonDetailDto, PersonDto, PersonLineDto } from '../dto.js';
import { findDuplicates } from './duplicates.js';
import { loadMeetingStats, type MeetingStats } from './stats.js';
import { checkEnabled, rememberEnabled } from '../voices/load.js';

export interface PeopleDeps {
  db: Database;
  settings: SettingsStore;
}

/** The longest list a person page shows, newest meetings first. */
const LINE_LIMIT = 200;

type Person = typeof people.$inferSelect;

export async function reviewCounts(
  db: Database,
  only?: readonly string[],
): Promise<Map<string, number>> {
  if (only?.length === 0) return new Map();
  const scope = only
    ? sql`and p.person_id in (${sql.join(
        only.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``;
  const counts = new Map<string, number>();
  for (const via of ['participant_id', 'suggested_participant_id']) {
    const link = sql.raw(via);
    const { rows } = await db.execute<{ person_id: string; n: number }>(sql`
      select p.person_id, count(*)::int as n
      from transcript_segments s
      join participants p on p.id = s.${link}
      join meetings m on m.id = s.meeting_id
      join people pe on pe.id = p.person_id and pe.tracking = 'on'
      where m.deleted_at is null and p.person_id is not null ${scope}
        and coalesce(s.speaker_source, '') <> 'user'
        and ${via === 'participant_id' ? sql`(s.speaker_confidence < ${LOW_SPEAKER_CONFIDENCE} or s.voice_doubt)` : sql`true`}
        and not exists (
          select 1 from voice_samples v
          where v.person_id = p.person_id and v.segment_id = s.id and v.rejected
        )
      group by p.person_id`);
    for (const row of rows) counts.set(row.person_id, (counts.get(row.person_id) ?? 0) + row.n);
  }
  return counts;
}

/** For everyone who has a probable double, who that is. Only a hint, nobody is merged on it. */
export async function loadDuplicates(db: Database): Promise<Map<string, PersonChoiceDto[]>> {
  const rows = await db
    .select({ id: people.id, name: people.name, emails: people.emails })
    .from(people);
  const names = new Map(rows.map((row) => [row.id, row.name]));
  return new Map(
    [...findDuplicates(rows)].map(([id, others]) => [
      id,
      others.flatMap((other) => {
        const name = names.get(other);
        return name === undefined ? [] : [{ id: other, name }];
      }),
    ]),
  );
}

export async function loadPeople(db: Database, only?: string): Promise<PersonDto[]> {
  const where = only ? eq(people.id, only) : undefined;
  const [rows, samples, seen, review, dupes] = await Promise.all([
    db
      .select()
      .from(people)
      .where(where)
      .orderBy(sql`lower(${people.name})`),
    db
      .select({
        personId: voiceSamples.personId,
        samples: sql<number>`coalesce(sum(${voiceSamples.weight}), 0)::int`,
        ms: sql<number>`coalesce(sum(${voiceSamples.durationMs}), 0)::int`,
      })
      .from(voiceSamples)
      .where(and(eq(voiceSamples.rejected, false), sql`${voiceSamples.embedding} is not null`))
      .groupBy(voiceSamples.personId),
    loadMeetingStats(db, only ? [only] : undefined),
    reviewCounts(db),
    loadDuplicates(db),
  ]);
  const sampleOf = new Map(samples.map((s) => [s.personId, s]));
  return rows.map((person) => toDto(person, sampleOf.get(person.id), seen, review, dupes));
}

export function toDto(
  person: Person,
  sample: { samples: number; ms: number } | undefined,
  seen: ReadonlyMap<string, MeetingStats>,
  review: ReadonlyMap<string, number>,
  dupes: ReadonlyMap<string, PersonChoiceDto[]> = new Map(),
): PersonDto {
  return {
    id: person.id,
    name: person.name,
    notes: person.notes,
    emails: person.emails,
    samples: sample?.samples ?? 0,
    voiceSeconds: Math.round((sample?.ms ?? 0) / 1000),
    needsReview: review.get(person.id) ?? 0,
    meetings: seen.get(person.id)?.meetings ?? 0,
    lastSeenAt: seen.get(person.id)?.lastSeen?.toISOString() ?? null,
    source: person.source,
    tracking: person.tracking,
    duplicates: dupes.get(person.id) ?? [],
  };
}

export type Select = { limit: number; meetingId?: string };

export async function personLines(
  db: Database,
  personId: string,
  kind: 'verified' | 'review',
  { limit, meetingId }: Select,
): Promise<PersonLineDto[]> {
  const suggested = db
    .select({ id: participants.id })
    .from(participants)
    .where(eq(participants.personId, personId));
  const own = inArray(transcriptSegments.participantId, suggested);
  const proposed = inArray(transcriptSegments.suggestedParticipantId, suggested);
  const notUser = or(
    isNull(transcriptSegments.speakerSource),
    ne(transcriptSegments.speakerSource, 'user'),
  );
  const condition =
    kind === 'verified'
      ? and(own, eq(transcriptSegments.speakerSource, 'user'))
      : and(
          notUser,
          or(
            and(
              own,
              or(
                sql`${transcriptSegments.speakerConfidence} < ${LOW_SPEAKER_CONFIDENCE}`,
                eq(transcriptSegments.voiceDoubt, true),
              ),
            ),
            proposed,
          ),
        );
  const rows = await db
    .select({
      id: transcriptSegments.id,
      meetingId: transcriptSegments.meetingId,
      meetingTitle: meetings.title,
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      text: transcriptSegments.text,
      speakerConfidence: transcriptSegments.speakerConfidence,
      suggestedId: transcriptSegments.suggestedParticipantId,
      doubt: transcriptSegments.voiceDoubt,
      scores: transcriptSegments.voiceScores,
      participantId: transcriptSegments.participantId,
      sampleId: voiceSamples.id,
      sampleEmbedded: sql<boolean>`${voiceSamples.embedding} is not null`,
      rejected: voiceSamples.rejected,
      hasAudio: sql<boolean>`exists (select 1 from ${audioFiles} where ${audioFiles.meetingId} = ${meetings.id})`,
    })
    .from(transcriptSegments)
    .innerJoin(meetings, eq(meetings.id, transcriptSegments.meetingId))
    .leftJoin(
      voiceSamples,
      and(eq(voiceSamples.segmentId, transcriptSegments.id), eq(voiceSamples.personId, personId)),
    )
    .where(
      and(
        isNull(meetings.deletedAt),
        condition,
        meetingId ? eq(transcriptSegments.meetingId, meetingId) : undefined,
      ),
    )
    .orderBy(desc(meetings.createdAt), transcriptSegments.startMs)
    .limit(limit * 2);
  const mine = new Set(
    (
      await db
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.personId, personId))
    ).map((p) => p.id),
  );
  return rows
    .filter((row) => kind === 'verified' || !row.rejected)
    .slice(0, limit)
    .map((row) => {
      const proposedHere = row.suggestedId !== null && mine.has(row.suggestedId);
      const score = row.scores?.find((s) => mine.has(s.participantId))?.score ?? null;
      return {
        id: row.id,
        meetingId: row.meetingId,
        meetingTitle: row.meetingTitle,
        startMs: row.startMs,
        endMs: row.endMs,
        text: row.text,
        speakerConfidence: row.speakerConfidence,
        voiceScore: score,
        reason:
          kind === 'verified'
            ? null
            : row.doubt && !proposedHere
              ? 'voice'
              : proposedHere
                ? 'suggested'
                : 'uncertain',
        verified: kind === 'verified',
        inProfile: row.sampleId !== null && row.sampleEmbedded && !row.rejected,
        hasAudio: row.hasAudio,
      } satisfies PersonLineDto;
    });
}

export async function loadChoices(db: Database, exclude?: string): Promise<PersonChoiceDto[]> {
  const rows = await db
    .select({ id: people.id, name: people.name, tracking: people.tracking })
    .from(people)
    .orderBy(sql`lower(${people.name})`);
  return rows
    .filter((row) => row.id !== exclude)
    .map((row) => ({ id: row.id, name: row.name, tracked: row.tracking === 'on' }));
}

export async function loadPersonDetail(
  deps: PeopleDeps,
  personId: string,
): Promise<PersonDetailDto | undefined> {
  const [person] = await loadPeople(deps.db, personId);
  if (!person) return undefined;
  const [row] = await deps.db.select().from(people).where(eq(people.id, personId));
  const [verified, review, choices] = await Promise.all([
    personLines(deps.db, personId, 'verified', { limit: LINE_LIMIT }),
    row?.tracking === 'off'
      ? Promise.resolve([])
      : personLines(deps.db, personId, 'review', { limit: LINE_LIMIT }),
    loadChoices(deps.db, personId),
  ]);
  return {
    person,
    prototypes: row?.voicePrototypes.length ?? 0,
    verified,
    review,
    choices,
    learning: await rememberEnabled(deps.settings),
    checking: await checkEnabled(deps.settings),
  };
}
