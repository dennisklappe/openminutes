import { cleanEmails } from '@openminutes/core';
import { and, eq, meetings, participants, type Database } from '@openminutes/db';
import type { RoomNameEmails } from '../dto.js';
import { resolveLinks } from '../participants/invitee-links.js';
import { renameParticipant } from '../participants/rename.js';
import { assertSharedLinksFree } from '../participants/shared-rules.js';
import { PeopleError } from '../people/edit.js';

/** The addresses given while naming, with the invitees in their stored spelling. */
export interface VoiceEmails {
  inviteeEmails: string[];
  email: string | null | undefined;
  move: boolean;
}

/** Reads the addresses of a naming request. Throws 400 for an invitee this meeting did not have. */
export async function readVoiceEmails(
  db: Database,
  meetingId: string,
  input: RoomNameEmails,
): Promise<VoiceEmails> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) throw new PeopleError('Meeting not found', 404);
  const links = resolveLinks(meeting, input.inviteeEmails ?? []);
  if (links === false) throw new PeopleError('That person was not invited', 400);
  return { inviteeEmails: links, email: input.email, move: input.move === true };
}

/**
 * Looks whether a person of the same tile has the addresses already, before anything is changed.
 * Does nothing when the request moves them.
 */
export async function checkVoiceEmails(
  db: Database,
  meetingId: string,
  personId: string,
  wanted: VoiceEmails,
): Promise<void> {
  if (wanted.move || (wanted.inviteeEmails.length === 0 && !wanted.email)) return;
  const [seat] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.meetingId, meetingId), eq(participants.personId, personId)));
  if (seat) await assertSharedLinksFree(db, seat, wanted);
}

/**
 * Gives the addresses to the seat of the person in this meeting, and to the person's own
 * addresses unless another person has them. Never to the tile.
 */
export async function attachVoiceEmails(
  db: Database,
  meetingId: string,
  personId: string,
  wanted: VoiceEmails,
): Promise<void> {
  if (wanted.inviteeEmails.length === 0 && !wanted.email) return;
  const [seat] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.meetingId, meetingId), eq(participants.personId, personId)));
  if (!seat) return;
  await assertSharedLinksFree(db, seat, wanted, wanted.move);
  await renameParticipant(db, seat, seat.displayName, false, {
    inviteeEmails: cleanEmails([...seat.inviteeEmails, ...wanted.inviteeEmails]),
    ...(wanted.email && { email: wanted.email }),
  });
}
