import { cleanEmails, rebuildProfile, resumeTracking, stopTracking } from '@openminutes/core';
import {
  and,
  eq,
  inArray,
  ne,
  participantAliases,
  participants,
  people,
  roomVoices,
  sharedAccountVoices,
  speakerEvents,
  sql,
  transcriptSegments,
  voiceSamples,
  type Database,
} from '@openminutes/db';
import type { PersonInput, PersonUpdateInput } from '../dto.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export class PeopleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = 'PeopleError';
  }
}

const sameName = (
  column:
    typeof people.name | typeof participants.displayName | typeof participantAliases.displayName,
  name: string,
) => sql`lower(${column}) = lower(${name})`;

async function assertFree(tx: Tx, id: string | null, name: string | undefined, emails: string[]) {
  if (name !== undefined) {
    const [twin] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(sameName(people.name, name), id ? ne(people.id, id) : undefined));
    if (twin) throw new PeopleError(`There is already a person called ${name}`, 409);
  }
  for (const email of emails) {
    const [owner] = await tx
      .select({ name: people.name })
      .from(people)
      .where(and(sql`${people.emails} ? ${email}`, id ? ne(people.id, id) : undefined));
    if (owner) throw new PeopleError(`${email} already belongs to ${owner.name}`, 409);
  }
}

export async function createPerson(db: Database, input: PersonInput) {
  const emails = cleanEmails(input.emails ?? []);
  return db.transaction(async (tx) => {
    await assertFree(tx, null, input.name, emails);
    const [created] = await tx
      .insert(people)
      .values({ name: input.name, emails, notes: input.notes ?? null })
      .returning();
    if (!created) throw new PeopleError('Could not create the person', 400);
    return created;
  });
}

/** A new name also goes on the labels of this person's lines and on the saved rename rules. */
export async function updatePerson(db: Database, id: string, input: PersonUpdateInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(people).where(eq(people.id, id));
    if (!current) throw new PeopleError('Person not found', 404);
    const emails = input.emails === undefined ? undefined : cleanEmails(input.emails);
    const renamed = input.name !== undefined && input.name !== current.name;
    await assertFree(tx, id, renamed ? input.name : undefined, emails ?? []);
    const [saved] = await tx
      .update(people)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        // Giving a voice of a shared account a name of its own makes it a person like any other.
        ...(renamed && current.unnamed && { unnamed: false }),
        ...(emails && { emails }),
        ...(input.notes !== undefined && { notes: input.notes }),
        updatedAt: new Date(),
      })
      .where(eq(people.id, id))
      .returning();
    if (renamed && input.name !== undefined)
      await renameEverywhere(tx, id, current.name, input.name);
    return saved ?? current;
  });
}

async function renameEverywhere(tx: Tx, personId: string, from: string, to: string) {
  await tx
    .update(participants)
    .set({ displayName: to })
    .where(and(eq(participants.personId, personId), sameName(participants.displayName, from)));
  await tx
    .update(participantAliases)
    .set({ displayName: to })
    .where(sameName(participantAliases.displayName, from));
}

/**
 * When both people have a seat in the same meeting the two seats become one: the lines, speaker
 * events and addresses of the source seat move to the target seat, so a meeting never lists one
 * person twice.
 */
async function foldSeats(tx: Tx, sourceId: string, targetId: string) {
  const mine = await tx.select().from(participants).where(eq(participants.personId, sourceId));
  for (const seat of mine) {
    const [twin] = await tx
      .select()
      .from(participants)
      .where(and(eq(participants.meetingId, seat.meetingId), eq(participants.personId, targetId)));
    if (!twin) continue;
    await tx
      .update(transcriptSegments)
      .set({ participantId: twin.id })
      .where(eq(transcriptSegments.participantId, seat.id));
    await tx
      .update(transcriptSegments)
      .set({ suggestedParticipantId: twin.id })
      .where(eq(transcriptSegments.suggestedParticipantId, seat.id));
    await tx
      .update(transcriptSegments)
      .set({ previousParticipantId: twin.id })
      .where(eq(transcriptSegments.previousParticipantId, seat.id));
    await tx
      .update(speakerEvents)
      .set({ participantId: twin.id })
      .where(eq(speakerEvents.participantId, seat.id));
    await tx
      .update(participants)
      .set({
        email: twin.email ?? seat.email,
        inviteeEmails: cleanEmails([...twin.inviteeEmails, ...seat.inviteeEmails]),
        joinedAt: twin.joinedAt ?? seat.joinedAt,
      })
      .where(eq(participants.id, twin.id));
    await tx.delete(participants).where(eq(participants.id, seat.id));
  }
}

/**
 * Folds `sourceId` into `targetId`: emails, notes, voice samples and meeting participants move
 * over, the source is removed and the voice profile is built again.
 */
export async function mergePeople(db: Database, targetId: string, sourceId: string) {
  if (targetId === sourceId) throw new PeopleError('Pick two different people', 400);
  return db.transaction(async (tx) => {
    const [[target], [source]] = await Promise.all([
      tx.select().from(people).where(eq(people.id, targetId)),
      tx.select().from(people).where(eq(people.id, sourceId)),
    ]);
    if (!target || !source) throw new PeopleError('Person not found', 404);
    const taken = await tx
      .select({
        segmentId: voiceSamples.segmentId,
        meetingId: voiceSamples.meetingId,
        kind: voiceSamples.kind,
      })
      .from(voiceSamples)
      .where(eq(voiceSamples.personId, targetId));
    const doubles = (
      await tx.select().from(voiceSamples).where(eq(voiceSamples.personId, sourceId))
    ).filter((sample) =>
      taken.some(
        (own) =>
          (sample.segmentId !== null && own.segmentId === sample.segmentId) ||
          (sample.kind === 'meeting' &&
            own.kind === 'meeting' &&
            own.meetingId === sample.meetingId),
      ),
    );
    if (doubles.length > 0) {
      await tx.delete(voiceSamples).where(
        inArray(
          voiceSamples.id,
          doubles.map((sample) => sample.id),
        ),
      );
    }
    await tx
      .update(voiceSamples)
      .set({ personId: targetId })
      .where(eq(voiceSamples.personId, sourceId));
    await tx
      .update(participants)
      .set({ displayName: target.name })
      .where(
        and(eq(participants.personId, sourceId), sameName(participants.displayName, source.name)),
      );
    await foldSeats(tx, sourceId, targetId);
    await tx
      .update(participants)
      .set({ personId: targetId })
      .where(eq(participants.personId, sourceId));
    await tx
      .update(participantAliases)
      .set({ displayName: target.name })
      .where(sameName(participantAliases.displayName, source.name));
    // The voices of a shared tile that were this person are the target now.
    await tx
      .update(roomVoices)
      .set({ personId: targetId })
      .where(eq(roomVoices.personId, sourceId));
    await tx
      .update(sharedAccountVoices)
      .set({ personId: targetId })
      .where(eq(sharedAccountVoices.personId, sourceId));
    await tx.execute(sql`
      insert into meeting_invitees (meeting_id, person_id)
      select meeting_id, ${targetId}::uuid from meeting_invitees where person_id = ${sourceId}::uuid
      on conflict do nothing`);
    const notes = [target.notes, source.notes].filter((note): note is string => !!note);
    await tx.delete(people).where(eq(people.id, sourceId));
    await tx
      .update(people)
      .set({
        emails: cleanEmails([...target.emails, ...source.emails]),
        notes: notes.length > 0 ? notes.join('\n\n') : null,
        source: target.source === 'invited' ? source.source : target.source,
        unnamed: target.unnamed && source.unnamed,
        updatedAt: new Date(),
      })
      .where(eq(people.id, targetId));
    // Not tracked wins: if either was marked do not track, the merged person keeps no voice.
    if (target.tracking === 'off' || source.tracking === 'off') await stopTracking(tx, targetId);
    else await rebuildProfile(tx, targetId);
  });
}

/** Marks a person do not track (their voice is deleted) or tracks them again. */
export async function setTracking(db: Database, id: string, tracking: 'on' | 'off') {
  await db.transaction(async (tx) => {
    const [found] = await tx.select({ id: people.id }).from(people).where(eq(people.id, id));
    if (!found) throw new PeopleError('Person not found', 404);
    if (tracking === 'off') await stopTracking(tx, id);
    else await resumeTracking(tx, id);
  });
}

export async function deletePerson(db: Database, id: string): Promise<void> {
  const removed = await db.delete(people).where(eq(people.id, id)).returning({ id: people.id });
  if (removed.length === 0) throw new PeopleError('Person not found', 404);
}
