import {
  applyRoomVoices,
  mergedAudioPath,
  rememberCount,
  resetRoomVoices,
  ROOM_ASSIGN_MIN_MS,
  type AudioStorage,
  type JobPayloads,
} from '@openminutes/core';
import {
  and,
  eq,
  inArray,
  meetings,
  participants,
  people,
  roomVoices,
  summaries,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import type { Diarizer } from '@openminutes/providers';
import { splitTile, store } from './room-voices.js';
import type { EmbeddedLine } from './speaker-review/voice-check.js';

export interface SplitRoomDeps {
  db: Database;
  loadStorage: () => Promise<AudioStorage>;
  createDiarizer: () => Promise<Diarizer | undefined>;
}

/** Lines embedded for one split, the longest first. */
const MAX_EMBEDDED = 400;
/** A line another speaker talks over by more than this is not clean. */
const OVERLAP_MS = 300;

const overlap = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);

/**
 * Splits one participant tile into exactly `count` voices when the owner says how many people sit
 * there, also when the automatic check did not flag it. The lines of the tile are embedded again,
 * clustered into `count` voices and stored like the automatic ones (`room_voices`), then the
 * voices become people. A tile with a named voice is not touched. When it cannot be done the tile
 * stays as it was and the question is closed, so nothing waits for it. Best effort: logged.
 */
export async function splitRoom(
  deps: SplitRoomDeps,
  { meetingId, participantId, count }: JobPayloads['meeting.split-room'],
): Promise<void> {
  // What the tile was before the request: voices that already have people keep their count.
  let before: number | null = null;
  const close = () =>
    deps.db
      .update(participants)
      .set({ roomCount: before, roomAskedAt: null })
      .where(eq(participants.id, participantId));
  try {
    const [tile] = await deps.db
      .select()
      .from(participants)
      .where(and(eq(participants.id, participantId), eq(participants.meetingId, meetingId)));
    if (!tile || tile.isBot) return;
    const old = await deps.db
      .select({ id: roomVoices.id, personId: roomVoices.personId })
      .from(roomVoices)
      .where(eq(roomVoices.participantId, participantId));
    before = old.length > 0 && old.every((voice) => voice.personId) ? old.length : null;
    const personIds = old.flatMap((voice) => (voice.personId ? [voice.personId] : []));
    if (personIds.length > 0) {
      const named = await deps.db
        .select({ id: people.id })
        .from(people)
        .where(and(inArray(people.id, personIds), eq(people.unnamed, false)));
      if (named.length > 0) {
        console.error(`split of ${participantId}: a voice is named, not splitting`);
        // The old voices and their answer stay; only the request is closed.
        await close();
        return;
      }
    }
    const seats = personIds.length
      ? await deps.db
          .select({ id: participants.id })
          .from(participants)
          .where(
            and(eq(participants.meetingId, meetingId), inArray(participants.personId, personIds)),
          )
      : [];
    const own = new Set([participantId, ...seats.map((seat) => seat.id)]);
    const all = await deps.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId));
    const others = all.filter((line) => !line.participantId || !own.has(line.participantId));
    const candidates = all
      .filter(
        (line) =>
          line.participantId !== null &&
          own.has(line.participantId) &&
          line.speakerSource !== 'user' &&
          line.endMs - line.startMs >= ROOM_ASSIGN_MIN_MS &&
          !others.some((other) => overlap(line, other) > OVERLAP_MS),
      )
      .toSorted((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
      .slice(0, MAX_EMBEDDED);
    if (candidates.length === 0) throw new Error('no clear lines to split');
    const diarizer = await deps.createDiarizer();
    const storage = await deps.loadStorage();
    const path = await storage.ensureLocal(mergedAudioPath(meetingId));
    const embedded = await diarizer?.embedEach(
      { path },
      candidates.map((line) => ({ startMs: line.startMs, endMs: line.endMs })),
    );
    if (!embedded) throw new Error('the voice service is not available');
    const lines = candidates.flatMap((line, i): EmbeddedLine[] => {
      const embedding = embedded.embeddings[i];
      return embedding
        ? [
            {
              startMs: line.startMs,
              endMs: line.endMs,
              participantId,
              embedding,
              anchor: true,
              undisturbed: true,
            },
          ]
        : [];
    });
    const voices = splitTile(lines, participantId, count);
    if (voices.length !== count)
      throw new Error(`the lines do not split into ${String(count)} voices`);
    // The owner may have named a voice while the audio was being listened to.
    const raced = await deps.db
      .select({ id: roomVoices.id })
      .from(roomVoices)
      .innerJoin(people, eq(people.id, roomVoices.personId))
      .where(and(eq(roomVoices.participantId, participantId), eq(people.unnamed, false)))
      .limit(1);
    if (raced.length > 0) {
      console.error(`split of ${participantId}: a voice was named meanwhile, not splitting`);
      await close();
      return;
    }
    await resetRoomVoices(deps.db, meetingId, participantId, count);
    await store(deps.db, meetingId, participantId, voices, lines);
    await deps.db
      .update(participants)
      .set({ roomCount: count, roomAskedAt: null })
      .where(eq(participants.id, participantId));
    await rememberCount(deps.db, tile, count);
    await applyRoomVoices(deps.db, meetingId, participantId);
    const [done] = await deps.db
      .select({ id: summaries.id })
      .from(summaries)
      .where(and(eq(summaries.meetingId, meetingId), eq(summaries.status, 'done')))
      .limit(1);
    if (done) {
      await deps.db
        .update(meetings)
        .set({ speakersChangedAt: new Date() })
        .where(eq(meetings.id, meetingId));
    }
  } catch (error) {
    console.error(`splitting ${participantId} of meeting ${meetingId} failed`, error);
    await close();
  }
}
