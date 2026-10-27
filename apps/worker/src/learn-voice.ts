import {
  addVoiceSamples,
  linkParticipant,
  mergeEmbeddings,
  mergedAudioPath,
  type AudioStorage,
  type JobPayloads,
} from '@openminutes/core';
import {
  and,
  eq,
  inArray,
  participants,
  people,
  sql,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
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
 * Teaches a participant's voice from lines a person assigned or verified. Every line becomes a
 * sample of its own in the voice profile of the person, so a wrong one can be taken out again.
 * Best effort: a failure is logged and the job ends, a missed sample is not worth a retry.
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
    if (person && (await untrackedPerson(deps.db, person))) return;
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
    const ranges = lines
      .filter((line) => line.endMs - line.startMs >= MIN_RANGE_MS)
      .toSorted((a, b) => a.startMs - b.startMs);
    if (!person || ranges.length === 0) return;
    const diarizer = await deps.createDiarizer();
    const storage = await deps.loadStorage();
    const path = await storage.ensureLocal(mergedAudioPath(meetingId));
    const embedded = await diarizer?.embedEach({ path }, ranges);
    if (!embedded) return;
    const samples = ranges.flatMap((line, i) => {
      const embedding = embedded.embeddings[i];
      return embedding
        ? [
            {
              kind: 'line' as const,
              embedding,
              embedder: embedded.model,
              meetingId,
              segmentId: line.id,
              durationMs: line.endMs - line.startMs,
            },
          ]
        : [];
    });
    if (samples.length === 0) return;
    let combined = samples[0]?.embedding ?? [];
    let seconds = samples[0]?.durationMs ?? 0;
    for (const sample of samples.slice(1)) {
      combined = mergeWeighted(combined, seconds, sample.embedding, sample.durationMs);
      seconds += sample.durationMs;
    }
    const current = person.voiceEmbedding;
    await deps.db
      .update(participants)
      .set({
        voiceEmbedding:
          current && current.length === combined.length
            ? mergeEmbeddings(current, EXISTING_VOICE_WEIGHT, combined)
            : combined,
      })
      .where(eq(participants.id, person.id));
    if (person.nameConfirmed) {
      const known = await linkParticipant(deps.db, person);
      if (known) await addVoiceSamples(deps.db, known.id, samples);
    }
  } catch (error) {
    console.error(`learning the voice of ${participantId} in meeting ${meetingId} failed`, error);
  }
}

/** A person marked do not track gets no voice learned, not even on the meeting participant. */
async function untrackedPerson(
  db: Database,
  participant: { personId: string | null; displayName: string },
): Promise<boolean> {
  const [found] = await db
    .select({ tracking: people.tracking })
    .from(people)
    .where(
      participant.personId
        ? eq(people.id, participant.personId)
        : sql`lower(${people.name}) = lower(${participant.displayName.trim()})`,
    );
  return found?.tracking === 'off';
}

function mergeWeighted(
  a: readonly number[],
  weightA: number,
  b: readonly number[],
  weightB: number,
): number[] {
  const total = weightA + weightB;
  return a.map((value, i) => (value * weightA + (b[i] ?? 0) * weightB) / (total || 1));
}
