import {
  ensureAccount,
  personForVoice,
  rebuildProfile,
  seatFor,
  cleanEmails,
} from '@openminutes/core';
import {
  and,
  eq,
  gte,
  inArray,
  meetingInvitees,
  ne,
  participants,
  people,
  reviewDecisions,
  roomVoices,
  sharedAccountVoices,
  transcriptSegments,
  voiceSamples,
  type Database,
} from '@openminutes/db';
import type { RoomChangeEmailDto, RoomChangeInput, RoomChangePreviewDto } from '../dto.js';
import { PeopleError } from '../people/edit.js';
import { type LearnRequest } from '../people/lines.js';
import { attachVoiceEmails, checkVoiceEmails, readVoiceEmails } from './room-emails.js';
import { nameRoomVoice } from './room-voices.js';
import { markSpeakersChanged } from './speakers-notice.js';

type Reader = Pick<Database, 'select'>;
type Seat = typeof participants.$inferSelect;
type Line = typeof transcriptSegments.$inferSelect;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The lines of a voice that a person set by hand before it was named: they stay where they are. */
interface Split {
  /** Lines the change moves. */
  moving: Line[];
  /** Lines the owner set, which are never taken over. */
  kept: Line[];
}

/**
 * Sorts the lines of the voice. A line verified by the naming of this voice (a review decision of
 * that person, made when the voice was named) counts as moving; a line the owner set by hand
 * (before the naming, or since) stays.
 */
async function splitLines(db: Reader, voice: typeof roomVoices.$inferSelect): Promise<Split> {
  const lines = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.roomVoiceId, voice.id));
  const verified =
    voice.personId && voice.namedAt && lines.length > 0
      ? new Set(
          (
            await db
              .select({ segmentId: reviewDecisions.segmentId })
              .from(reviewDecisions)
              .where(
                and(
                  inArray(
                    reviewDecisions.segmentId,
                    lines.map((line) => line.id),
                  ),
                  eq(reviewDecisions.personId, voice.personId),
                  eq(reviewDecisions.kind, 'approve'),
                  gte(reviewDecisions.createdAt, voice.namedAt),
                ),
              )
          ).map((row) => row.segmentId),
        )
      : new Set<string>();
  const moving: Line[] = [];
  const kept: Line[] = [];
  for (const line of lines) {
    if (line.speakerSource !== 'user' || verified.has(line.id)) moving.push(line);
    else kept.push(line);
  }
  return { moving, kept };
}

async function seatOf(db: Reader, meetingId: string, personId: string): Promise<Seat | undefined> {
  const [seat] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.meetingId, meetingId), eq(participants.personId, personId)));
  return seat;
}

async function loadNamedVoice(db: Reader, meetingId: string, voiceId: string) {
  const [voice] = await db
    .select()
    .from(roomVoices)
    .where(and(eq(roomVoices.id, voiceId), eq(roomVoices.meetingId, meetingId)));
  if (!voice) throw new PeopleError('Voice not found', 404);
  const [from] = voice.personId
    ? await db.select().from(people).where(eq(people.id, voice.personId))
    : [];
  if (!from || from.unnamed) throw new PeopleError('This voice has no name yet', 409);
  return { voice, from };
}

/** The addresses of the person that came with this meeting: those on their seat here. */
async function emailsOf(
  db: Reader,
  meetingId: string,
  voice: typeof roomVoices.$inferSelect,
  from: typeof people.$inferSelect,
  moving: readonly Line[],
): Promise<RoomChangeEmailDto[]> {
  const seat = await seatOf(db, meetingId, from.id);
  if (!seat) return [];
  const movingIds = new Set(moving.map((line) => line.id));
  const own = await db
    .select({ id: transcriptSegments.id })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.participantId, seat.id));
  const otherVoices = await db
    .select({ id: roomVoices.id })
    .from(roomVoices)
    .where(
      and(
        eq(roomVoices.meetingId, meetingId),
        eq(roomVoices.personId, from.id),
        ne(roomVoices.id, voice.id),
      ),
    );
  const onlyThisVoice = otherVoices.length === 0 && own.every((line) => movingIds.has(line.id));
  return cleanEmails([...(seat.email ? [seat.email] : []), ...seat.inviteeEmails]).map((email) => ({
    email,
    onPerson: from.emails.some((own) => same(own, email)),
    onSeat: true,
    suggested: onlyThisVoice,
  }));
}

/** What changing who a named voice is would do, for the confirm dialog. */
export async function previewVoiceChange(
  db: Database,
  meetingId: string,
  voiceId: string,
): Promise<RoomChangePreviewDto> {
  const { voice, from } = await loadNamedVoice(db, meetingId, voiceId);
  const { moving, kept } = await splitLines(db, voice);
  const samples =
    moving.length === 0
      ? []
      : await db
          .select({ id: voiceSamples.id })
          .from(voiceSamples)
          .where(
            and(
              eq(voiceSamples.personId, from.id),
              eq(voiceSamples.rejected, false),
              inArray(
                voiceSamples.segmentId,
                moving.map((line) => line.id),
              ),
            ),
          );
  return {
    voiceId: voice.id,
    personId: from.id,
    personName: from.name,
    lines: moving.length,
    keptLines: kept.length,
    samples: samples.length,
    emails: await emailsOf(db, meetingId, voice, from, moving),
  };
}

/** A person made only for a voice is removed when nothing else is theirs any more. */
async function dropIfEmpty(db: Database, personId: string): Promise<void> {
  const [person] = await db.select().from(people).where(eq(people.id, personId));
  if (!person || person.source !== 'joined' || person.emails.length > 0 || person.notes) return;
  const [seat] = await db
    .select({ id: participants.id })
    .from(participants)
    .where(eq(participants.personId, personId))
    .limit(1);
  const [voice] = await db
    .select({ id: roomVoices.id })
    .from(roomVoices)
    .where(eq(roomVoices.personId, personId))
    .limit(1);
  const [sample] = await db
    .select({ id: voiceSamples.id })
    .from(voiceSamples)
    .where(eq(voiceSamples.personId, personId))
    .limit(1);
  const [invited] = await db
    .select({ id: meetingInvitees.personId })
    .from(meetingInvitees)
    .where(eq(meetingInvitees.personId, personId))
    .limit(1);
  const [slot] = await db
    .select({ n: sharedAccountVoices.number })
    .from(sharedAccountVoices)
    .where(eq(sharedAccountVoices.personId, personId))
    .limit(1);
  if (!seat && !voice && !sample && !invited && !slot) {
    await db.delete(people).where(eq(people.id, personId));
  }
}

/**
 * Gives a named voice to someone else, or back to nobody. In one transaction: the voice samples
 * learned from this voice in this meeting leave the previous person (their profile is built
 * again), the lines move to the new person and are verified for them as when naming, lines a
 * person set by hand stay, and the addresses the owner ticked come off the previous person. A
 * person who only existed for this voice is removed.
 */
export async function changeRoomVoice(
  db: Database,
  meetingId: string,
  voiceId: string,
  input: RoomChangeInput,
): Promise<{ learn: LearnRequest | undefined; personId: string }> {
  const { voice, from } = await loadNamedVoice(db, meetingId, voiceId);
  if ('personId' in input && input.personId === from.id) {
    throw new PeopleError('Pick someone else', 400);
  }
  if ('newName' in input && same(input.newName, from.name)) {
    throw new PeopleError('Pick someone else', 400);
  }
  const emails = await readVoiceEmails(db, meetingId, input);
  const preview = await previewVoiceChange(db, meetingId, voiceId);
  const remove = cleanEmails(input.removeEmails ?? []);
  if (remove.some((email) => !preview.emails.some((entry) => same(entry.email, email)))) {
    throw new PeopleError('Those addresses did not come with this meeting', 400);
  }
  if ('personId' in input) {
    const [target] = await db.select().from(people).where(eq(people.id, input.personId));
    if (!target) throw new PeopleError('Person not found', 404);
  }
  // Drizzle runs a nested transaction as a savepoint, so the naming below is part of this one.
  return db.transaction(async (tx) => {
    const inner = tx as unknown as Database;
    const [tile] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, voice.participantId));
    if (!tile) throw new PeopleError('Voice not found', 404);
    const { moving } = await splitLines(tx, voice);
    const lineIds = moving.map((line) => line.id);
    // The samples learned from these lines leave the profile they were added to.
    if (lineIds.length > 0) {
      await tx
        .delete(voiceSamples)
        .where(
          and(
            eq(voiceSamples.personId, from.id),
            eq(voiceSamples.rejected, false),
            inArray(voiceSamples.segmentId, lineIds),
          ),
        );
      await tx
        .delete(reviewDecisions)
        .where(
          and(inArray(reviewDecisions.segmentId, lineIds), eq(reviewDecisions.personId, from.id)),
        );
    }
    await rebuildProfile(tx, from.id);
    // The voice is an unnamed person of its tile again, with a place in the meeting.
    const account = await ensureAccount(tx, tile);
    const [slot] = await tx
      .select({ centroid: sharedAccountVoices.centroid })
      .from(sharedAccountVoices)
      .where(
        and(
          eq(sharedAccountVoices.accountId, account.id),
          eq(sharedAccountVoices.number, voice.number),
        ),
      );
    await tx
      .delete(sharedAccountVoices)
      .where(
        and(
          eq(sharedAccountVoices.accountId, account.id),
          eq(sharedAccountVoices.number, voice.number),
        ),
      );
    const placeholder = await personForVoice(tx, account, voice.number);
    if (slot?.centroid) {
      await tx
        .update(sharedAccountVoices)
        .set({ centroid: slot.centroid })
        .where(
          and(
            eq(sharedAccountVoices.accountId, account.id),
            eq(sharedAccountVoices.number, voice.number),
          ),
        );
    }
    const seat = await seatFor(tx, meetingId, placeholder, tile);
    await tx
      .update(roomVoices)
      .set({ personId: placeholder.id, namedAt: null })
      .where(eq(roomVoices.id, voice.id));
    if (lineIds.length > 0) {
      await tx
        .update(transcriptSegments)
        .set({
          participantId: seat,
          speakerSource: 'diarization',
          previousParticipantId: tile.id,
          suggestedParticipantId: null,
          voiceDoubt: false,
          byElimination: false,
        })
        .where(inArray(transcriptSegments.id, lineIds));
    }
    // The addresses the owner ticked come off the previous person.
    const old = await seatOf(tx, meetingId, from.id);
    if (remove.length > 0) {
      const gone = (email: string) => remove.some((entry) => same(entry, email));
      await tx
        .update(people)
        .set({ emails: from.emails.filter((email) => !gone(email)), updatedAt: new Date() })
        .where(eq(people.id, from.id));
      if (old) {
        await tx
          .update(participants)
          .set({
            inviteeEmails: old.inviteeEmails.filter((email) => !gone(email)),
            email: old.email && gone(old.email) ? null : old.email,
          })
          .where(eq(participants.id, old.id));
      }
    }
    // Their seat here goes when nothing of theirs is left in it.
    const left = old ? await seatOf(tx, meetingId, from.id) : undefined;
    if (left) {
      const [still] = await tx
        .select({ id: transcriptSegments.id })
        .from(transcriptSegments)
        .where(eq(transcriptSegments.participantId, left.id))
        .limit(1);
      const [other] = await tx
        .select({ id: roomVoices.id })
        .from(roomVoices)
        .where(and(eq(roomVoices.meetingId, meetingId), eq(roomVoices.personId, from.id)))
        .limit(1);
      if (!still && !other && !left.email && left.inviteeEmails.length === 0) {
        await tx.delete(participants).where(eq(participants.id, left.id));
      }
    }
    await markSpeakersChanged(tx, meetingId);

    let personId = placeholder.id;
    let learn: LearnRequest | undefined;
    if (!('unnamed' in input)) {
      await checkVoiceEmails(inner, meetingId, placeholder.id, emails);
      const named = await nameRoomVoice(
        inner,
        meetingId,
        voice.id,
        'personId' in input ? { personId: input.personId } : { newName: input.newName },
      );
      personId = named.personId;
      learn = named.learn;
      await attachVoiceEmails(inner, meetingId, personId, emails);
    }
    await dropIfEmpty(inner, from.id);
    return { learn, personId };
  });
}
