import { isUncertain } from '@openminutes/core';
import { asc, eq, participants, transcriptSegments, type Database } from '@openminutes/db';
import type { SegmentDto, SpeakerChoiceDto } from '../dto.js';

export async function loadSegments(db: Database, meetingId: string): Promise<SegmentDto[]> {
  const [rows, people] = await Promise.all([
    db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId))
      .orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.id)),
    db.select().from(participants).where(eq(participants.meetingId, meetingId)),
  ]);
  const names = new Map(people.map((person) => [person.id, person.displayName]));
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return rows.map((row) => ({
    id: row.id,
    startMs: row.startMs,
    endMs: row.endMs,
    text: row.text,
    speaker: nameOf(row.participantId),
    speakerId: row.participantId,
    speakerConfidence: row.speakerConfidence,
    speakerSource: row.speakerSource,
    uncertain: isUncertain(row),
    previousSpeaker: nameOf(row.previousParticipantId),
  }));
}

/** Everyone a line can be assigned to: speakers in order of first appearance, then the silent ones. */
export async function loadSpeakerChoices(
  db: Database,
  meetingId: string,
): Promise<SpeakerChoiceDto[]> {
  const [people, rows] = await Promise.all([
    db.select().from(participants).where(eq(participants.meetingId, meetingId)),
    db
      .select({ participantId: transcriptSegments.participantId })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId))
      .orderBy(asc(transcriptSegments.startMs), asc(transcriptSegments.id)),
  ]);
  const appearance = new Map<string, number>();
  for (const { participantId } of rows) {
    if (participantId && !appearance.has(participantId))
      appearance.set(participantId, appearance.size);
  }
  const rank = (id: string) => appearance.get(id) ?? Number.MAX_SAFE_INTEGER;
  return people
    .toSorted((a, b) => rank(a.id) - rank(b.id) || a.displayName.localeCompare(b.displayName))
    .map(({ id, displayName }) => ({ id, name: displayName }));
}
