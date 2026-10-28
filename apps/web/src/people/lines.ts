import { dropLineSamples, penalizeAutoMargin, rebuildProfile } from '@openminutes/core';
import {
  and,
  eq,
  inArray,
  participants,
  people,
  reviewDecisions,
  transcriptSegments,
  voiceSamples,
  type Database,
  type SegmentSnapshot,
} from '@openminutes/db';
import { splitRow } from '../meetings/speaker-edit.js';
import { markSpeakersChanged } from '../meetings/speakers-notice.js';
import { PeopleError } from './edit.js';
import { isFiller, MIN_LINE_MS } from './useful.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Person = typeof people.$inferSelect;
type Segment = typeof transcriptSegments.$inferSelect;

const snapshotOf = (segment: Segment): SegmentSnapshot => ({
  participantId: segment.participantId,
  speakerSource: segment.speakerSource,
  suggestedParticipantId: segment.suggestedParticipantId,
  voiceDoubt: segment.voiceDoubt,
  byElimination: segment.byElimination,
  previousParticipantId: segment.previousParticipantId,
  rejectedSuggestions: segment.rejectedSuggestions,
  mixed: segment.mixed,
});

/** Remembers the line as it was before a decision, replacing a skip or an earlier decision. */
async function remember(
  tx: Tx,
  segment: Segment,
  personId: string,
  kind: 'approve' | 'reject' | 'mixed' | 'split',
  before: SegmentSnapshot = snapshotOf(segment),
): Promise<void> {
  const values = { personId, kind, before, createdAt: new Date() };
  await tx
    .insert(reviewDecisions)
    .values({ segmentId: segment.id, ...values })
    .onConflictDoUpdate({ target: reviewDecisions.segmentId, set: values });
}

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

/** Gives a line to a person as a verified one, inside a transaction. Returns their participant. */
export async function verifyInTx(tx: Tx, person: Person, segment: Segment): Promise<string> {
  const participantId = await participantFor(tx, segment.meetingId, person);
  await remember(tx, segment, person.id, 'approve');
  await tx
    .update(transcriptSegments)
    .set({
      participantId,
      speakerSource: 'user',
      suggestedParticipantId: null,
      voiceDoubt: false,
      byElimination: false,
      // A person who says it is this person has settled a doubt that it holds two speakers.
      ...(segment.mixed === 'probable' && { mixed: null }),
      previousParticipantId:
        segment.participantId !== participantId && segment.speakerSource !== 'user'
          ? segment.participantId
          : segment.previousParticipantId,
    })
    .where(eq(transcriptSegments.id, segment.id));
  await tx
    .delete(voiceSamples)
    .where(
      and(
        eq(voiceSamples.personId, person.id),
        eq(voiceSamples.segmentId, segment.id),
        eq(voiceSamples.rejected, true),
      ),
    );
  // A sample the voice added by itself is now confirmed by a person.
  await tx
    .update(voiceSamples)
    .set({ source: 'verified' })
    .where(
      and(
        eq(voiceSamples.personId, person.id),
        eq(voiceSamples.segmentId, segment.id),
        eq(voiceSamples.source, 'auto'),
      ),
    );
  await dropLineSamples(tx, [segment.id], person.id);
  await markSpeakersChanged(tx, segment.meetingId);
  return participantId;
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
    const participantId = await verifyInTx(tx, person, segment);
    return { meetingId: segment.meetingId, participantId, segmentIds: [segmentId] };
  });
}

/** Says that a line is not this person. It is not offered to them again. */
export async function rejectLine(db: Database, personId: string, segmentId: string) {
  await db.transaction(async (tx) => {
    await personOf(tx, personId);
    const segment = await segmentOf(tx, segmentId);
    await remember(tx, segment, personId, 'reject');
    const mine = new Set(
      (
        await tx
          .select({ id: participants.id })
          .from(participants)
          .where(eq(participants.personId, personId))
      ).map((p) => p.id),
    );
    const removed = await tx
      .delete(voiceSamples)
      .where(and(eq(voiceSamples.personId, personId), eq(voiceSamples.segmentId, segmentId)))
      .returning({ source: voiceSamples.source });
    // Turning down a line the voice learned by itself says its test was too loose for this person.
    if (removed.some((sample) => sample.source === 'auto')) await penalizeAutoMargin(tx, personId);
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
      await markSpeakersChanged(tx, segment.meetingId);
      await tx
        .update(transcriptSegments)
        .set({
          participantId: elsewhere,
          speakerSource: 'guess',
          previousParticipantId: segment.participantId,
          suggestedParticipantId: null,
          voiceDoubt: false,
          byElimination: false,
        })
        .where(eq(transcriptSegments.id, segmentId));
    } else if (segment.suggestedParticipantId && mine.has(segment.suggestedParticipantId)) {
      // The suggestion made the line doubtful in the summary, turning it down settles that.
      await markSpeakersChanged(tx, segment.meetingId);
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

export interface SplitResult {
  /** Who each part was given to, with the parts long enough to teach a voice. */
  learn: { personId: string; request: LearnRequest }[];
}

/**
 * Cuts a line that holds two or three speakers and gives every part to its person as a verified
 * line. A part long enough to teach a voice is handed back to learn from, a short one is only
 * labelled. The voice samples of the whole line are dropped, they cover speech of more than one
 * person. `cuts` are word indexes, `personIds` has one person per part.
 */
export async function splitLine(
  db: Database,
  proposedId: string,
  segmentId: string,
  cuts: readonly number[],
  personIds: readonly string[],
): Promise<SplitResult> {
  if (personIds.length !== cuts.length + 1) throw new PeopleError('Pick a person per part', 400);
  return db.transaction(async (tx) => {
    await personOf(tx, proposedId);
    const segment = await segmentOf(tx, segmentId);
    const owners: string[] = [];
    for (const id of personIds)
      owners.push(await participantFor(tx, segment.meetingId, await personOf(tx, id)));
    let split;
    try {
      split = await splitRow(tx, segment, cuts, owners, { settled: true });
    } catch (error) {
      throw new PeopleError(error instanceof Error ? error.message : 'Could not split', 400);
    }
    await remember(tx, segment, proposedId, 'split', {
      ...snapshotOf(segment),
      text: segment.text,
      endMs: segment.endMs,
      parts: split.ids.slice(1),
    });
    await dropLineSamples(tx, [segmentId]);
    await markSpeakersChanged(tx, segment.meetingId);
    const saved = await tx
      .select()
      .from(transcriptSegments)
      .where(inArray(transcriptSegments.id, split.ids));
    const learn: SplitResult['learn'] = [];
    for (const [i, id] of split.ids.entries()) {
      const part = saved.find((row) => row.id === id);
      const personId = personIds[i];
      const participantId = owners[i];
      if (!part || !personId || !participantId) continue;
      if (part.endMs - part.startMs < MIN_LINE_MS || isFiller(part.text)) continue;
      const known = learn.find((l) => l.request.participantId === participantId);
      if (known) known.request.segmentIds.push(id);
      else
        learn.push({
          personId,
          request: { meetingId: segment.meetingId, participantId, segmentIds: [id] },
        });
    }
    return { learn };
  });
}

/**
 * Says that a line holds two speakers and should not teach a voice. The line keeps its label, its
 * samples are dropped for good and it leaves every review queue. Undo or clearing the flag brings
 * it back.
 */
export async function markMixed(db: Database, personId: string, segmentId: string) {
  await db.transaction(async (tx) => {
    await personOf(tx, personId);
    const segment = await segmentOf(tx, segmentId);
    await remember(tx, segment, personId, 'mixed');
    await tx
      .update(transcriptSegments)
      .set({ mixed: 'marked' })
      .where(eq(transcriptSegments.id, segmentId));
    const removed = await tx
      .delete(voiceSamples)
      .where(and(eq(voiceSamples.segmentId, segmentId), eq(voiceSamples.rejected, false)))
      .returning({ personId: voiceSamples.personId });
    for (const owner of new Set(removed.map((sample) => sample.personId))) {
      await rebuildProfile(tx, owner);
    }
  });
}

/**
 * Hides a line from the review queue. It stays hidden, in every session, until the skipped lines
 * are asked for or the line is proposed for someone else.
 */
export async function skipLine(db: Database, personId: string, segmentId: string) {
  await db.transaction(async (tx) => {
    await personOf(tx, personId);
    await segmentOf(tx, segmentId);
    const values = { personId, kind: 'skip' as const, before: null, createdAt: new Date() };
    await tx
      .insert(reviewDecisions)
      .values({ segmentId, ...values })
      .onConflictDoUpdate({ target: reviewDecisions.segmentId, set: values });
  });
}

/**
 * Takes back the last review decision on a line: a skip is forgotten, a verified or rejected
 * line gets its earlier label back and loses the voice sample that decision made. Returns what
 * was undone, or undefined when nothing was stored.
 */
export async function undoDecision(db: Database, segmentId: string) {
  return db.transaction(async (tx) => {
    const [decision] = await tx
      .select()
      .from(reviewDecisions)
      .where(eq(reviewDecisions.segmentId, segmentId));
    if (!decision) return undefined;
    if (decision.before) {
      const [line] = await tx
        .select({ meetingId: transcriptSegments.meetingId })
        .from(transcriptSegments)
        .where(eq(transcriptSegments.id, segmentId));
      if (line) await markSpeakersChanged(tx, line.meetingId);
      const { parts = [], ...columns } = decision.before;
      await tx.update(transcriptSegments).set(columns).where(eq(transcriptSegments.id, segmentId));
      if (decision.kind === 'split') {
        // The parts are gone, and so is whatever the voice learned from them or the whole line.
        const lines = [segmentId, ...parts];
        const learned = await tx
          .delete(voiceSamples)
          .where(inArray(voiceSamples.segmentId, lines))
          .returning({ personId: voiceSamples.personId });
        if (parts.length > 0) {
          await tx.delete(transcriptSegments).where(inArray(transcriptSegments.id, parts));
        }
        for (const personId of new Set(learned.map((sample) => sample.personId))) {
          await rebuildProfile(tx, personId);
        }
      } else if (decision.kind !== 'mixed') {
        await tx
          .delete(voiceSamples)
          .where(
            and(
              eq(voiceSamples.personId, decision.personId),
              eq(voiceSamples.segmentId, segmentId),
              eq(voiceSamples.rejected, decision.kind === 'reject'),
            ),
          );
        await rebuildProfile(tx, decision.personId);
      }
    }
    await tx.delete(reviewDecisions).where(eq(reviewDecisions.segmentId, segmentId));
    return decision.kind;
  });
}
