import {
  assignToRoomVoice,
  buildMeetingVoices,
  findRoomVoices,
  type RoomVoiceFound,
} from '@openminutes/core';
import {
  and,
  eq,
  participants,
  roomVoices,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import { loadUntracked } from './speaker-review/transcript-review.js';
import type { EmbeddedLine } from './speaker-review/voice-check.js';

/**
 * Looks for participant tiles that hold several people and stores what it finds: one `room_voices`
 * row per voice and, per line, the voice it sounds like. Nothing about who said what changes, the
 * owner names the voices later. The old voices of the meeting are always replaced, because the
 * transcript they point into was just rebuilt. Tiles the owner called one person, bots and
 * people marked do not track are left alone. Best effort: a failure is logged.
 */
export async function saveRoomVoices(
  db: Database,
  meetingId: string,
  lines: readonly EmbeddedLine[],
): Promise<number> {
  try {
    await db.delete(roomVoices).where(eq(roomVoices.meetingId, meetingId));
    if (lines.length === 0) return 0;
    const [seats, untracked] = await Promise.all([
      db.select().from(participants).where(eq(participants.meetingId, meetingId)),
      loadUntracked(db, meetingId),
    ]);
    const skip = new Set(
      seats.filter((s) => s.isBot || s.roomDismissedAt !== null).map((s) => s.id),
    );
    for (const id of untracked) skip.add(id);
    const found = detect(lines, skip);
    let saved = 0;
    for (const { participantId, voices } of found) {
      saved += await store(db, meetingId, participantId, voices, lines);
    }
    return saved;
  } catch (error) {
    console.error(`shared voices of meeting ${meetingId} could not be saved`, error);
    return 0;
  }
}

/** The tiles that hold several voices, and those voices. Pure apart from the input. */
export function detect(
  lines: readonly EmbeddedLine[],
  skip: ReadonlySet<string>,
): { participantId: string; voices: RoomVoiceFound[] }[] {
  const anchors = lines.flatMap((line, key) =>
    line.anchor ? [{ key, participantId: line.participantId, vector: line.embedding }] : [],
  );
  const meetingVoices = buildMeetingVoices(anchors);
  const tiles = [...new Set(lines.filter((l) => l.anchor).map((l) => l.participantId))];
  return tiles.flatMap((participantId) => {
    if (skip.has(participantId)) return [];
    const clean = lines.flatMap((line, key) =>
      line.anchor && line.participantId === participantId
        ? [{ key, embedding: line.embedding, durationMs: line.endMs - line.startMs }]
        : [],
    );
    const others = meetingVoices.filter((v) => v.participantId !== participantId).map((v) => v.sum);
    const voices = findRoomVoices(clean, others);
    return voices.length >= 2 ? [{ participantId, voices }] : [];
  });
}

async function store(
  db: Database,
  meetingId: string,
  participantId: string,
  voices: readonly RoomVoiceFound[],
  lines: readonly EmbeddedLine[],
): Promise<number> {
  const created = await db
    .insert(roomVoices)
    .values(
      voices.map((voice, i) => ({
        meetingId,
        participantId,
        number: i + 1,
        centroid: voice.centroid,
        lines: voice.keys.length,
        durationMs: voice.durationMs,
      })),
    )
    .returning({ id: roomVoices.id, number: roomVoices.number });
  const idOf = new Map(created.map((row) => [row.number, row.id]));
  const centroids = voices.map((voice) => voice.centroid);
  for (const line of lines) {
    if (line.participantId !== participantId || !line.undisturbed) continue;
    const index = assignToRoomVoice(line.embedding, line.endMs - line.startMs, centroids);
    const roomVoiceId = index === undefined ? undefined : idOf.get(index + 1);
    if (!roomVoiceId) continue;
    await db
      .update(transcriptSegments)
      .set({ roomVoiceId })
      .where(
        and(
          eq(transcriptSegments.meetingId, meetingId),
          eq(transcriptSegments.participantId, participantId),
          eq(transcriptSegments.startMs, line.startMs),
          eq(transcriptSegments.endMs, line.endMs),
        ),
      );
  }
  return voices.length;
}
