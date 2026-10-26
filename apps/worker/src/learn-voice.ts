import {
  mergedAudioPath,
  mergeEmbeddings,
  rememberVoice,
  type AudioStorage,
  type JobPayloads,
} from '@openminutes/core';
import { and, eq, inArray, participants, transcriptSegments, type Database } from '@openminutes/db';
import type { Diarizer } from '@openminutes/providers';

export interface LearnVoiceDeps {
  db: Database;
  loadStorage: () => Promise<AudioStorage>;
  createDiarizer: () => Promise<Diarizer | undefined>;
}

const MIN_RANGE_MS = 800;
/** A voice found by diarization covers minutes of speech, a correction only a few lines. */
const EXISTING_VOICE_WEIGHT = 4;

/**
 * Teaches a participant's voice from lines a person assigned to them. Best effort: a failure is
 * logged and the job ends, a missed sample is not worth a retry.
 */
export async function learnVoice(
  deps: LearnVoiceDeps,
  { meetingId, participantId, segmentIds }: JobPayloads['meeting.learn-voice'],
): Promise<void> {
  try {
    const [person] = await deps.db
      .select()
      .from(participants)
      .where(and(eq(participants.id, participantId), eq(participants.meetingId, meetingId)));
    const lines = await deps.db
      .select()
      .from(transcriptSegments)
      .where(
        and(
          eq(transcriptSegments.meetingId, meetingId),
          eq(transcriptSegments.participantId, participantId),
          inArray(transcriptSegments.id, segmentIds),
        ),
      );
    const ranges = lines.filter((line) => line.endMs - line.startMs >= MIN_RANGE_MS);
    if (!person || ranges.length === 0) return;
    const diarizer = await deps.createDiarizer();
    const storage = await deps.loadStorage();
    const path = await storage.ensureLocal(mergedAudioPath(meetingId));
    const embedding = await diarizer?.embed({ path }, ranges);
    if (!embedding) return;
    const current = person.voiceEmbedding;
    await deps.db
      .update(participants)
      .set({
        voiceEmbedding:
          current && current.length === embedding.length
            ? mergeEmbeddings(current, EXISTING_VOICE_WEIGHT, embedding)
            : embedding,
      })
      .where(eq(participants.id, person.id));
    if (person.nameConfirmed)
      await rememberVoice(
        deps.db,
        person.displayName,
        embedding,
        person.email ?? person.inviteeEmails[0] ?? null,
      );
  } catch (error) {
    console.error(`learning the voice of ${participantId} in meeting ${meetingId} failed`, error);
  }
}
