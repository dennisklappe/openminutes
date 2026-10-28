import {
  and,
  asc,
  audioFiles,
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
  voiceReviews,
  type Database,
} from '@openminutes/db';
import type { ReviewVoiceDto } from '../dto.js';
import { PeopleError } from './edit.js';
import { verifyInTx, type LearnRequest } from './lines.js';
import { languageName } from './profiles.js';

export interface VoiceCardScope {
  personId?: string | undefined;
  meetingId?: string | undefined;
}

/**
 * The environment cards of a scope: open ones, or the skipped ones. A card whose person is no
 * longer tracked, whose meeting is gone or whose lines are gone is left out.
 */
export async function loadVoiceCards(
  db: Database,
  { personId, meetingId }: VoiceCardScope,
  skipped = false,
): Promise<{ cards: ReviewVoiceDto[]; skippedCount: number }> {
  const scope = and(
    personId ? eq(voiceReviews.personId, personId) : undefined,
    meetingId ? eq(voiceReviews.meetingId, meetingId) : undefined,
    eq(people.tracking, 'on'),
    isNull(meetings.deletedAt),
  );
  const rows = await db
    .select({
      id: voiceReviews.id,
      status: voiceReviews.status,
      meetingId: voiceReviews.meetingId,
      meetingTitle: meetings.title,
      meetingDate: meetings.createdAt,
      personId: people.id,
      personName: people.name,
      voiceName: participants.displayName,
      language: voiceReviews.language,
      mismatch: voiceReviews.mismatch,
      sampleSegmentIds: voiceReviews.sampleSegmentIds,
      hasAudio: sql<boolean>`exists (select 1 from ${audioFiles} where ${audioFiles.meetingId} = ${meetings.id})`,
    })
    .from(voiceReviews)
    .innerJoin(people, eq(people.id, voiceReviews.personId))
    .innerJoin(meetings, eq(meetings.id, voiceReviews.meetingId))
    .innerJoin(participants, eq(participants.id, voiceReviews.participantId))
    .where(and(scope, or(eq(voiceReviews.status, 'open'), eq(voiceReviews.status, 'skipped'))))
    .orderBy(sql`${voiceReviews.mismatch} desc`, asc(voiceReviews.createdAt), asc(voiceReviews.id));
  const wanted = rows.filter((row) => (row.status === 'skipped') === skipped);
  const ids = [...new Set(wanted.flatMap((row) => row.sampleSegmentIds))];
  const lines =
    ids.length === 0
      ? []
      : await db.select().from(transcriptSegments).where(inArray(transcriptSegments.id, ids));
  const byId = new Map(lines.map((line) => [line.id, line]));
  const cards = wanted.flatMap((row): ReviewVoiceDto[] => {
    const own = row.sampleSegmentIds.flatMap((id) => {
      const line = byId.get(id);
      return line
        ? [
            {
              id: line.id,
              startMs: line.startMs,
              endMs: line.endMs,
              text: line.text,
              hasAudio: row.hasAudio,
            },
          ]
        : [];
    });
    if (own.length === 0) return [];
    return [
      {
        id: row.id,
        meetingId: row.meetingId,
        meetingTitle: row.meetingTitle,
        meetingDate: row.meetingDate.toISOString(),
        person: { id: row.personId, name: row.personName },
        voiceName: row.voiceName,
        language: row.language,
        languageName: languageName(row.language),
        mismatch: row.mismatch,
        lines: own,
        status: row.status === 'skipped' ? 'skipped' : 'open',
      },
    ];
  });
  return { cards, skippedCount: rows.filter((row) => row.status === 'skipped').length };
}

/** What to learn from after an answer: whose voice, and the lines to embed. */
export interface VoiceLearning {
  personId: string;
  request: LearnRequest;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function openReview(tx: Tx, id: string) {
  const [review] = await tx.select().from(voiceReviews).where(eq(voiceReviews.id, id));
  if (!review) throw new PeopleError('Question not found', 404);
  if (review.status === 'confirmed' || review.status === 'moved') {
    throw new PeopleError('That question was already answered', 409);
  }
  return review;
}

const decided = (status: 'confirmed' | 'moved', decidedPersonId: string) => ({
  status,
  decidedPersonId,
  decidedAt: new Date(),
});

/**
 * "Yes, it is them": the whole voice is theirs in this meeting. The lines on the card become
 * verified lines of the person, and the doubts on the rest of the voice's lines are settled.
 * The caller queues the voice learning, which adds them to the profile as a way of sounding.
 */
export async function confirmVoice(db: Database, id: string): Promise<VoiceLearning> {
  return db.transaction(async (tx) => {
    const review = await openReview(tx, id);
    const [person] = await tx.select().from(people).where(eq(people.id, review.personId));
    if (!person) throw new PeopleError('Person not found', 404);
    const sample = await tx
      .select()
      .from(transcriptSegments)
      .where(inArray(transcriptSegments.id, review.sampleSegmentIds));
    let participantId = review.participantId;
    for (const segment of sample) participantId = await verifyInTx(tx, person, segment);
    await tx
      .update(transcriptSegments)
      .set({ voiceDoubt: false, suggestedParticipantId: null, byElimination: false })
      .where(
        and(
          eq(transcriptSegments.participantId, review.participantId),
          or(
            isNull(transcriptSegments.speakerSource),
            ne(transcriptSegments.speakerSource, 'user'),
          ),
        ),
      );
    await tx
      .update(voiceReviews)
      .set(decided('confirmed', person.id))
      .where(eq(voiceReviews.id, id));
    return {
      personId: person.id,
      request: {
        meetingId: review.meetingId,
        participantId,
        segmentIds: sample.map((segment) => segment.id),
      },
    };
  });
}

/**
 * "No, someone else": the voice is another person on that account. Its lines go to the person
 * the owner picks as verified lines, and nothing enters the labelled person's profile. The
 * caller queues the voice learning for the lines on the card.
 */
export async function moveVoice(
  db: Database,
  id: string,
  personId: string,
): Promise<VoiceLearning> {
  return db.transaction(async (tx) => {
    const review = await openReview(tx, id);
    const [target] = await tx.select().from(people).where(eq(people.id, personId));
    if (!target) throw new PeopleError('Person not found', 404);
    if (target.id === review.personId) throw new PeopleError('Pick someone else', 400);
    const lines = await tx
      .select()
      .from(transcriptSegments)
      .where(
        and(
          eq(transcriptSegments.participantId, review.participantId),
          or(
            isNull(transcriptSegments.speakerSource),
            ne(transcriptSegments.speakerSource, 'user'),
          ),
          or(isNull(transcriptSegments.mixed), ne(transcriptSegments.mixed, 'marked')),
        ),
      );
    let participantId = review.participantId;
    for (const segment of lines) participantId = await verifyInTx(tx, target, segment);
    await tx.update(voiceReviews).set(decided('moved', target.id)).where(eq(voiceReviews.id, id));
    const moved = new Set(lines.map((segment) => segment.id));
    return {
      personId: target.id,
      request: {
        meetingId: review.meetingId,
        participantId,
        segmentIds: review.sampleSegmentIds.filter((segmentId) => moved.has(segmentId)),
      },
    };
  });
}

/** Hides the card in every session until the skipped cards are asked for. */
export async function skipVoice(db: Database, id: string) {
  await db.transaction(async (tx) => {
    await openReview(tx, id);
    await tx.update(voiceReviews).set({ status: 'skipped' }).where(eq(voiceReviews.id, id));
  });
}

/** Takes a skip back. */
export async function reopenVoice(db: Database, id: string) {
  await db.transaction(async (tx) => {
    await openReview(tx, id);
    await tx.update(voiceReviews).set({ status: 'open' }).where(eq(voiceReviews.id, id));
  });
}
