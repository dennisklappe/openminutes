import {
  accountVoicePrints,
  assignToRoomVoice,
  matchVoiceNumbers,
  buildMeetingVoices,
  applyRoomVoices,
  findRoomVoices,
  findRoomVoicesFixed,
  rememberedCount,
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
 * row per voice and, per line, the voice it sounds like. The old voices of the meeting are always
 * replaced, because the transcript they point into was just rebuilt (the rebuild also puts every
 * line back on its tile). Tiles the owner called one person, bots and people marked do not track
 * are left alone.
 *
 * How many people sit in a tile: the number the owner gave for this meeting, else the one
 * remembered for the account. With a number of 2 or more the lines are clustered into exactly
 * that many voices and the voices become people at once. Without one, a tile that clusters into
 * several voices on its own keeps them as an open question ("how many?") and no person is made
 * until it is answered. Best effort: a failure is logged.
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
    const auto = new Map(detect(lines, skip).map((found) => [found.participantId, found.voices]));
    let saved = 0;
    for (const seat of seats) {
      if (skip.has(seat.id)) continue;
      const known = seat.roomCount ?? (await rememberedCount(db, seat));
      if (known === 1) continue;
      if (known !== undefined && known >= 2) {
        const voices = splitTile(lines, seat.id, known);
        if (voices.length === 0) continue;
        saved += await store(db, meetingId, seat.id, voices, lines);
        await db
          .update(participants)
          .set({ roomCount: known, roomAskedAt: null })
          .where(eq(participants.id, seat.id));
        await applyRoomVoices(db, meetingId, seat.id);
        continue;
      }
      const voices = auto.get(seat.id);
      if (!voices) continue;
      saved += await store(db, meetingId, seat.id, voices, lines);
      await db
        .update(participants)
        .set({ roomAskedAt: new Date() })
        .where(eq(participants.id, seat.id));
    }
    return saved;
  } catch (error) {
    console.error(`shared voices of meeting ${meetingId} could not be saved`, error);
    return 0;
  }
}

/** The meeting voices of every participant, built from their anchor lines. */
function meetingVoicesOf(lines: readonly EmbeddedLine[]) {
  const anchors = lines.flatMap((line, key) =>
    line.anchor ? [{ key, participantId: line.participantId, vector: line.embedding }] : [],
  );
  return buildMeetingVoices(anchors);
}

/** The clean (anchor) lines of one tile, ready for clustering. */
export function cleanLinesOf(
  lines: readonly EmbeddedLine[],
  participantId: string,
): { key: number; embedding: number[]; durationMs: number }[] {
  return lines.flatMap((line, key) =>
    line.anchor && line.participantId === participantId
      ? [{ key, embedding: line.embedding, durationMs: line.endMs - line.startMs }]
      : [],
  );
}

/** The tiles that hold several voices, and those voices. Pure apart from the input. */
export function detect(
  lines: readonly EmbeddedLine[],
  skip: ReadonlySet<string>,
): { participantId: string; voices: RoomVoiceFound[] }[] {
  const meetingVoices = meetingVoicesOf(lines);
  const tiles = [...new Set(lines.filter((l) => l.anchor).map((l) => l.participantId))];
  return tiles.flatMap((participantId) => {
    if (skip.has(participantId)) return [];
    const others = meetingVoices.filter((v) => v.participantId !== participantId).map((v) => v.sum);
    const voices = findRoomVoices(cleanLinesOf(lines, participantId), others);
    return voices.length >= 2 ? [{ participantId, voices }] : [];
  });
}

/** The lines of one tile in exactly `count` voices, empty when they do not split that way. */
export function splitTile(
  lines: readonly EmbeddedLine[],
  participantId: string,
  count: number,
): RoomVoiceFound[] {
  return findRoomVoicesFixed(cleanLinesOf(lines, participantId), count);
}

export async function store(
  db: Database,
  meetingId: string,
  participantId: string,
  voices: readonly RoomVoiceFound[],
  lines: readonly EmbeddedLine[],
): Promise<number> {
  const [tile] = await db.select().from(participants).where(eq(participants.id, participantId));
  // The same person keeps the same voice number: a new voice takes the number of the known voice
  // it sounds like, whatever order the clusters came in.
  const numbers = matchVoiceNumbers(
    voices.map((voice) => voice.centroid),
    tile ? await accountVoicePrints(db, tile) : [],
  );
  const created = await db
    .insert(roomVoices)
    .values(
      voices.map((voice, i) => ({
        meetingId,
        participantId,
        number: numbers[i] ?? i + 1,
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
    const roomVoiceId = index === undefined ? undefined : idOf.get(numbers[index] ?? index + 1);
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
