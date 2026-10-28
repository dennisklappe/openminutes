import {
  LOW_SPEAKER_CONFIDENCE,
  loadVoiceTuning,
  normalizeLanguage,
  VOICE_TUNING_DEFAULTS,
  type SettingsStore,
  type VoiceTuning,
} from '@openminutes/core';
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
  sharedAccounts,
  sharedAccountVoices,
  sql,
  transcriptSegments,
  voiceSamples,
  type Database,
} from '@openminutes/db';
import type {
  LanguageCoverageDto,
  PersonChoiceDto,
  PersonDetailDto,
  PersonDto,
  PersonLineDto,
} from '../dto.js';
import { findDuplicates } from './duplicates.js';
import {
  languageName,
  languagesOf,
  loadProfileRows,
  loadStandings,
  readinessDto,
  standingOf,
  type ProfileRow,
  type Standing,
} from './profiles.js';
import { loadMeetingStats, type MeetingStats } from './stats.js';
import { checkEnabled, rememberEnabled } from '../voices/load.js';

export interface PeopleDeps {
  db: Database;
  settings: SettingsStore;
}

/** The longest list a person page shows, newest meetings first. */
const LINE_LIMIT = 200;

type Person = typeof people.$inferSelect;

/**
 * Every line that could be asked about per person, before the useful-line rules (length, overlap,
 * filler, profile target, skips). Only a prefilter for the review queue: what is shown to people
 * comes from loadReviewCounts, which counts the queue itself.
 */
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
        and s.mixed is distinct from 'marked'
        and (coalesce(s.speaker_source, '') <> 'user' or ${via === 'participant_id' ? sql`s.mixed = 'probable'` : sql`false`})
        and ${via === 'participant_id' ? sql`(s.speaker_confidence < ${LOW_SPEAKER_CONFIDENCE} or s.voice_doubt or s.by_elimination or s.mixed = 'probable')` : sql`true`}
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
  const accountOf = await sharedAccountOf(db);
  return new Map(
    [...findDuplicates(rows)].map(([id, others]) => [
      id,
      others.flatMap((other) => {
        const name = names.get(other);
        // Two people of one shared account are different people, whatever they share.
        const together =
          accountOf.get(id) !== undefined && accountOf.get(id) === accountOf.get(other);
        return name === undefined || together ? [] : [{ id: other, name }];
      }),
    ]),
  );
}

/** The shared account each person was made for, by person, as its account id. */
async function sharedAccountOf(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({ personId: sharedAccountVoices.personId, accountId: sharedAccountVoices.accountId })
    .from(sharedAccountVoices);
  return new Map(rows.map((row) => [row.personId, row.accountId]));
}

/** The label of the shared account each person was heard in, such as "Ann and Sam". */
export async function loadSharedLabels(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({ personId: sharedAccountVoices.personId, label: sharedAccounts.label })
    .from(sharedAccountVoices)
    .innerJoin(sharedAccounts, eq(sharedAccounts.id, sharedAccountVoices.accountId));
  return new Map(rows.map((row) => [row.personId, row.label]));
}

export async function loadPeople(db: Database, only?: string): Promise<PersonDto[]> {
  const where = only ? eq(people.id, only) : undefined;
  const tuning = await loadVoiceTuning(db);
  const [rows, samples, seen, review, dupes, shared, standings] = await Promise.all([
    db
      .select()
      .from(people)
      .where(where)
      .orderBy(sql`lower(${people.name})`),
    loadProfileRows(db, only ? [only] : undefined),
    loadMeetingStats(db, only ? [only] : undefined),
    reviewCounts(db),
    loadDuplicates(db),
    loadSharedLabels(db),
    loadStandings(db, tuning, only ? [only] : undefined),
  ]);
  return rows.map((person) =>
    toDto(
      person,
      samples.filter((s) => s.personId === person.id),
      seen,
      review,
      dupes,
      shared,
      { standings, tuning },
    ),
  );
}

export function toDto(
  person: Person,
  profiles: readonly ProfileRow[],
  seen: ReadonlyMap<string, MeetingStats>,
  review: ReadonlyMap<string, number>,
  dupes: ReadonlyMap<string, PersonChoiceDto[]> = new Map(),
  shared: ReadonlyMap<string, string> = new Map(),
  voice: { standings: ReadonlyMap<string, Standing>; tuning: VoiceTuning } = {
    standings: new Map(),
    tuning: VOICE_TUNING_DEFAULTS,
  },
): PersonDto {
  return {
    id: person.id,
    name: person.name,
    notes: person.notes,
    emails: person.emails,
    samples: profiles.reduce((sum, p) => sum + p.samples, 0),
    voiceSeconds: Math.round(profiles.reduce((sum, p) => sum + p.ms, 0) / 1000),
    languages: languagesOf(profiles, voice.standings, voice.tuning),
    needsReview: review.get(person.id) ?? 0,
    meetings: seen.get(person.id)?.meetings ?? 0,
    lastSeenAt: seen.get(person.id)?.lastSeen?.toISOString() ?? null,
    source: person.source,
    tracking: person.tracking,
    duplicates: dupes.get(person.id) ?? [],
    unnamed: person.unnamed,
    sharedAccount: shared.get(person.id) ?? null,
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
  // A line a person marked as mixed is out of every list. One the voice guard thinks is mixed is
  // asked about for the person it is labelled or proposed as, also when a person had verified it.
  const probable = and(eq(transcriptSegments.mixed, 'probable'), or(own, proposed));
  const condition =
    kind === 'verified'
      ? and(own, eq(transcriptSegments.speakerSource, 'user'))
      : or(
          and(
            notUser,
            or(
              and(
                own,
                or(
                  sql`${transcriptSegments.speakerConfidence} < ${LOW_SPEAKER_CONFIDENCE}`,
                  eq(transcriptSegments.voiceDoubt, true),
                  eq(transcriptSegments.byElimination, true),
                ),
              ),
              proposed,
            ),
          ),
          probable,
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
      mixed: transcriptSegments.mixed,
      elimination: transcriptSegments.byElimination,
      scores: transcriptSegments.voiceScores,
      participantId: transcriptSegments.participantId,
      sampleId: voiceSamples.id,
      sampleEmbedded: sql<boolean>`${voiceSamples.embedding} is not null`,
      rejected: voiceSamples.rejected,
      language: sql<string | null>`coalesce(${transcriptSegments.language}, ${meetings.language})`,
      hasAudio: sql<boolean>`exists (select 1 from ${audioFiles} where ${audioFiles.meetingId} = ${meetings.id})`,
      via: sql<
        string | null
      >`(select tile.display_name from room_voices rv join participants tile on tile.id = rv.participant_id where rv.id = ${transcriptSegments.roomVoiceId})`,
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
        or(isNull(transcriptSegments.mixed), ne(transcriptSegments.mixed, 'marked')),
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
            : row.mixed === 'probable'
              ? 'mixed'
              : row.doubt && !proposedHere
                ? 'voice'
                : proposedHere
                  ? row.elimination
                    ? 'elimination'
                    : 'suggested'
                  : row.elimination
                    ? 'elimination'
                    : 'uncertain',
        verified: kind === 'verified',
        inProfile: row.sampleId !== null && row.sampleEmbedded && !row.rejected,
        language: normalizeLanguage(row.language),
        hasAudio: row.hasAudio,
        sharedVia: row.via,
      } satisfies PersonLineDto;
    });
}

/**
 * Lines the labelling is sure about that this person has not verified yet, with audio and long
 * enough to teach a voice. Offered for review only while their profile is under the target.
 */
export async function trainingLines(
  db: Database,
  personId: string,
  {
    limit,
    meetingId,
    readyLanguages = [],
    threshold = VOICE_TUNING_DEFAULTS.agreeScore,
  }: Select & { readyLanguages?: readonly string[]; threshold?: number },
): Promise<PersonLineDto[]> {
  const mine = db
    .select({ id: participants.id })
    .from(participants)
    .where(eq(participants.personId, personId));
  const rows = await db
    .select({
      id: transcriptSegments.id,
      meetingId: transcriptSegments.meetingId,
      meetingTitle: meetings.title,
      startMs: transcriptSegments.startMs,
      endMs: transcriptSegments.endMs,
      text: transcriptSegments.text,
      speakerConfidence: transcriptSegments.speakerConfidence,
      language: sql<string | null>`coalesce(${transcriptSegments.language}, ${meetings.language})`,
      scores: transcriptSegments.voiceScores,
      hasSample: sql<boolean>`exists (select 1 from ${voiceSamples} where ${voiceSamples.segmentId} = ${transcriptSegments.id} and ${voiceSamples.personId} = ${personId})`,
    })
    .from(transcriptSegments)
    .innerJoin(meetings, eq(meetings.id, transcriptSegments.meetingId))
    .where(
      and(
        isNull(meetings.deletedAt),
        inArray(transcriptSegments.participantId, mine),
        or(isNull(transcriptSegments.speakerSource), ne(transcriptSegments.speakerSource, 'user')),
        eq(transcriptSegments.voiceDoubt, false),
        isNull(transcriptSegments.mixed),
        sql`${transcriptSegments.speakerConfidence} >= ${LOW_SPEAKER_CONFIDENCE}`,
        sql`${transcriptSegments.endMs} - ${transcriptSegments.startMs} >= 3000`,
        sql`exists (select 1 from ${audioFiles} where ${audioFiles.meetingId} = ${meetings.id})`,
        meetingId ? eq(transcriptSegments.meetingId, meetingId) : undefined,
      ),
    )
    .orderBy(desc(meetings.createdAt), transcriptSegments.startMs)
    .limit(limit * 2);
  const ownSeats = new Set(
    (
      await db
        .select({ id: participants.id })
        .from(participants)
        .where(eq(participants.personId, personId))
    ).map((p) => p.id),
  );
  const ready = new Set(readyLanguages);
  return rows
    .filter((row) => !row.hasSample)
    .flatMap((row) => {
      const language = normalizeLanguage(row.language);
      const score = row.scores?.find((s) => ownSeats.has(s.participantId))?.score ?? null;
      const disagrees = score !== null && score < threshold;
      // A ready profile asks nothing of a line its voice agrees with, but still of one it does not.
      if (ready.has(language) && !disagrees) return [];
      return [
        {
          id: row.id,
          meetingId: row.meetingId,
          meetingTitle: row.meetingTitle,
          startMs: row.startMs,
          endMs: row.endMs,
          text: row.text,
          speakerConfidence: row.speakerConfidence,
          voiceScore: score,
          reason: disagrees ? ('voice' as const) : ('training' as const),
          verified: false,
          inProfile: false,
          language,
          hasAudio: true,
        },
      ];
    })
    .slice(0, limit);
}

export async function loadChoices(db: Database, exclude?: string): Promise<PersonChoiceDto[]> {
  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      tracking: people.tracking,
      unnamed: people.unnamed,
    })
    .from(people)
    .orderBy(sql`lower(${people.name})`);
  // A voice nobody named yet is not somebody to pick.
  return rows
    .filter((row) => row.id !== exclude && !row.unnamed)
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
    profiles: profilesOf(person.languages, verified, await loadVoiceTuning(deps.db)),
    verified,
    review,
    choices,
    learning: await rememberEnabled(deps.settings),
    checking: await checkEnabled(deps.settings),
  };
}

/**
 * One card per language the person has a voice in or a verified line in. A language shows up as
 * soon as the first verified line in it exists, before any voice is learned from it.
 */
function profilesOf(
  known: readonly LanguageCoverageDto[],
  verified: readonly PersonLineDto[],
  tuning: VoiceTuning,
): LanguageCoverageDto[] {
  const extra = [...new Set(verified.map((line) => line.language))].filter(
    (language) => !known.some((profile) => profile.language === language),
  );
  return [
    ...known,
    ...extra.map((language) => ({
      language,
      languageName: languageName(language),
      samples: 0,
      seconds: 0,
      autoSamples: 0,
      autoSeconds: 0,
      effectiveSeconds: 0,
      targetSeconds: tuning.readySeconds,
      readiness: readinessDto(standingOf(undefined, tuning), tuning),
      autoMeetings: [],
    })),
  ];
}
