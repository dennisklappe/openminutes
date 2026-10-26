import { dropLineSamples, rebuildProfile } from '@openminutes/core';
import {
  and,
  eq,
  participants,
  people,
  transcriptSegments,
  voiceSamples,
  type Database,
} from '@openminutes/db';
import { PeopleError } from './edit.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Person = typeof people.$inferSelect;
type Segment = typeof transcriptSegments.$inferSelect;

export interface LearnRequest {
  meetingId: string;
  participantId: string;
  segmentIds: string[];
}

async function personOf(tx: Tx, id: string): Promise<Person> {
  const [person] = await tx.select().from(people).where(eq(people.id, id));
  if (!person) throw new PeopleError('Person not found', 404);
  return person;
}

async function segmentOf(tx: Tx, id: string): Promise<Segment> {
  const [segment] = await tx.select().from(transcriptSegments).where(eq(transcriptSegments.id, id));
  if (!segment) throw new PeopleError('Line not found', 404);
  return segment;
}

/** The participant of a meeting that is this person, made when they have not spoken there yet. */
async function participantFor(tx: Tx, meetingId: string, person: Person): Promise<string> {
  const here = await tx.select().from(participants).where(eq(participants.meetingId, meetingId));
  const linked =
    here.find((p) => p.personId === person.id) ??
    here.find(
      (p) => p.personId === null && p.displayName.toLowerCase() === person.name.toLowerCase(),
    );
  if (linked) {
    if (linked.personId !== person.id) {
      await tx
        .update(participants)
        .set({ personId: person.id })
        .where(eq(participants.id, linked.id));
    }
    return linked.id;
  }
  const [created] = await tx
    .insert(participants)
    .values({ meetingId, displayName: person.name, nameConfirmed: true, personId: person.id })
    .returning({ id: participants.id });
  if (!created) throw new PeopleError('Could not add the person to the meeting', 400);
  return created.id;
}

/**
 * Says that a line is this person. The line takes their label as a verified one and leaves
 * every other profile. The caller queues the voice learning when the owner allows it.
 */
export async function verifyLine(
  db: Database,
  personId: string,
  segmentId: string,
): Promise<LearnRequest> {
  return db.transaction(async (tx) => {
    const person = await personOf(tx, personId);
    const segment = await segmentOf(tx, segmentId);
    const participantId = await participantFor(tx, segment.meetingId, person);
    await tx
      .update(transcriptSegments)
      .set({
        participantId,
        speakerSource: 'user',
        suggestedParticipantId: null,
        voiceDoubt: false,
        previousParticipantId:
          segment.participantId !== participantId && segment.speakerSource !== 'user'
            ? segment.participantId
            : segment.previousParticipantId,
      })
      .where(eq(transcriptSegments.id, segmentId));
    await tx
      .delete(voiceSamples)
      .where(
        and(
          eq(voiceSamples.personId, personId),
          eq(voiceSamples.segmentId, segmentId),
          eq(voiceSamples.rejected, true),
        ),
      );
    await dropLineSamples(tx, [segmentId], personId);
    return { meetingId: segment.meetingId, participantId, segmentIds: [segmentId] };
  });
}

/** Says that a line is not this person. It is not offered to them again. */
export async function rejectLine(db: Database, personId: string, segmentId: string) {
  await db.transaction(async (tx) => {
    await personOf(tx, personId);
    const segment = await segmentOf(tx, segmentId);
    const mine = new Set(
      (
        await tx
          .select({ id: participants.id })
          .from(participants)
          .where(eq(participants.personId, personId))
      ).map((p) => p.id),
    );
    await tx
      .delete(voiceSamples)
      .where(and(eq(voiceSamples.personId, personId), eq(voiceSamples.segmentId, segmentId)));
    await tx
      .insert(voiceSamples)
      .values({ personId, kind: 'line', segmentId, meetingId: segment.meetingId, rejected: true })
      .onConflictDoNothing();
    await rebuildProfile(tx, personId);
    if (segment.participantId && mine.has(segment.participantId)) {
      const elsewhere =
        [...(segment.speakerCandidates ?? [])]
          .sort((a, b) => b.score - a.score)
          .find((c) => !mine.has(c.participantId) && c.score > 0)?.participantId ??
        (segment.previousParticipantId && !mine.has(segment.previousParticipantId)
          ? segment.previousParticipantId
          : undefined);
      if (!elsewhere) {
        throw new PeopleError('Nobody else fits this line, move it to a person instead', 409);
      }
      await tx
        .update(transcriptSegments)
        .set({
          participantId: elsewhere,
          speakerSource: 'guess',
          previousParticipantId: segment.participantId,
          suggestedParticipantId: null,
          voiceDoubt: false,
        })
        .where(eq(transcriptSegments.id, segmentId));
    } else if (segment.suggestedParticipantId && mine.has(segment.suggestedParticipantId)) {
      await tx
        .update(transcriptSegments)
        .set({
          suggestedParticipantId: null,
          rejectedSuggestions: [...segment.rejectedSuggestions, segment.suggestedParticipantId],
        })
        .where(eq(transcriptSegments.id, segmentId));
    }
  });
}

/** Takes a line out of the voice profile without changing who it is labelled as. */
export async function removeFromProfile(db: Database, personId: string, segmentId: string) {
  await db.transaction(async (tx) => {
    await personOf(tx, personId);
    const removed = await tx
      .delete(voiceSamples)
      .where(
        and(
          eq(voiceSamples.personId, personId),
          eq(voiceSamples.segmentId, segmentId),
          eq(voiceSamples.rejected, false),
        ),
      )
      .returning({ id: voiceSamples.id });
    if (removed.length === 0) throw new PeopleError('That line is not in the profile', 404);
    await rebuildProfile(tx, personId);
  });
}
