import { BOT_DEFAULTS, type SettingsStore } from '@openminutes/core';
import {
  and,
  asc,
  eq,
  meetings,
  participants,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import { unmatchedInvitees } from '@openminutes/minutes';
import type { ParticipantsDto } from '../dto.js';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface ParticipantDeps {
  db: Database;
  settings: SettingsStore;
}

export async function loadParticipants(
  { db, settings }: ParticipantDeps,
  meetingId: string,
): Promise<Omit<ParticipantsDto, 'summaryUpdated'>> {
  const [[meeting], people, segments, botName] = await Promise.all([
    db
      .select({ invitees: meetings.invitees, dismissed: meetings.dismissedInvitees })
      .from(meetings)
      .where(eq(meetings.id, meetingId)),
    db
      .select()
      .from(participants)
      .where(and(eq(participants.meetingId, meetingId), eq(participants.isBot, false)))
      .orderBy(asc(participants.joinedAt), asc(participants.displayName)),
    db
      .select({
        participantId: transcriptSegments.participantId,
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId)),
    settings.get('bot.name'),
  ]);
  const bot = botName?.trim() || BOT_DEFAULTS.name;
  const talk = new Map<string, number>();
  for (const { participantId, startMs, endMs } of segments) {
    if (participantId) talk.set(participantId, (talk.get(participantId) ?? 0) + endMs - startMs);
  }
  const humans = people.filter((person) => !same(person.displayName, bot));
  const invitees = meeting?.invitees ?? [];
  const dismissed = new Set((meeting?.dismissed ?? []).map((email) => email.toLowerCase()));
  return {
    invitees,
    absent: unmatchedInvitees(invitees, humans).filter(
      (invitee) => !dismissed.has(invitee.email.toLowerCase()),
    ),
    participants: humans.map((person) => ({
      id: person.id,
      name: person.displayName,
      originalName:
        person.originalName && !same(person.originalName, person.displayName)
          ? person.originalName
          : null,
      joinedAt: person.joinedAt?.toISOString() ?? null,
      leftAt: person.leftAt?.toISOString() ?? null,
      talkMs: talk.get(person.id) ?? 0,
      confirmed: person.nameConfirmed,
      inviteeEmail: person.inviteeEmail,
    })),
  };
}
