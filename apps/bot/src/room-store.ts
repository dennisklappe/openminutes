import { isBotName } from '@openminutes/core';
import { participantAliases, participants, speakerEvents, type Database } from '@openminutes/db';
import type { TrackedParticipant, TrackedSpeakerEvent } from './room-tracker.js';

export interface RoomRecord {
  participants: TrackedParticipant[];
  speakerEvents: TrackedSpeakerEvent[];
}

export async function saveRoom(
  db: Database,
  meetingId: string,
  recordingStartedAt: Date,
  room: RoomRecord,
  botName?: string | null,
): Promise<void> {
  if (room.participants.length === 0) return;
  const at = (ms: number | null) =>
    ms === null ? null : new Date(recordingStartedAt.getTime() + ms);

  await db.transaction(async (tx) => {
    const aliases = new Map(
      (await tx.select().from(participantAliases)).map((alias) => [
        alias.originalName.toLowerCase(),
        alias,
      ]),
    );
    const rows = await tx
      .insert(participants)
      .values(
        room.participants.map((p) => ({
          meetingId,
          displayName: aliases.get(p.name.toLowerCase())?.displayName ?? p.name,
          originalName: p.name,
          inviteeEmail: aliases.get(p.name.toLowerCase())?.inviteeEmail ?? null,
          isBot: isBotName(p.name, botName),
          joinedAt: at(p.joinedMs),
          leftAt: at(p.leftMs),
        })),
      )
      .returning({ id: participants.id, name: participants.originalName });
    const idByName = new Map(rows.map((row) => [row.name, row.id]));

    const events = room.speakerEvents.flatMap((event) => {
      const participantId = idByName.get(event.name);
      return participantId
        ? [{ meetingId, participantId, startMs: event.startMs, endMs: event.endMs }]
        : [];
    });
    if (events.length > 0) await tx.insert(speakerEvents).values(events);
  });
}
