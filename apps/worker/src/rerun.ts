import {
  linkMeetingPeople,
  mergedAudioPath,
  scoreSpeaker,
  type AudioStorage,
  type JobPayloads,
  type JobSender,
  type SpeakerSpan,
} from '@openminutes/core';
import {
  and,
  eq,
  inArray,
  meetings,
  participants,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import { suggestForMeeting, type RecordingDeps } from './recording-pipeline.js';
import { labelRecording, removeStaleSpeakers } from './recording-speakers.js';
import { Run } from './run-progress.js';
import { checkVoices } from './speaker-review/voice-check.js';
import type { TranscriptRow } from './transcript-store.js';

export interface RerunDeps {
  db: Database;
  queue: JobSender;
  loadStorage: () => Promise<AudioStorage>;
  recording: RecordingDeps;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The meeting is processing while one of these jobs runs: the web API sets that before queueing. */
async function isRunning(db: Database, meetingId: string): Promise<boolean> {
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  return meeting?.status === 'processing' || meeting?.status === 'transcribed';
}

async function fail(db: Database, meetingId: string, run: Run, error: unknown, what: string) {
  run.stop();
  if (run.wasCancelled) return;
  console.error(`${what} of meeting ${meetingId} failed`, error);
  await db
    .update(meetings)
    .set({
      status: 'transcribed',
      error: `${what} failed: ${errorMessage(error)}`,
      processingStep: null,
      processingCurrent: null,
      processingTotal: null,
    })
    .where(eq(meetings.id, meetingId));
}

const overlap = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

function mostOverlapping(
  line: { startMs: number; endMs: number },
  spans: readonly SpeakerSpan[],
): string | null {
  const totals = new Map<string, number>();
  for (const span of spans) {
    totals.set(span.participantId, (totals.get(span.participantId) ?? 0) + overlap(line, span));
  }
  const [best] = [...totals].filter(([, ms]) => ms > 0).toSorted((a, b) => b[1] - a[1]);
  return best?.[0] ?? null;
}

/**
 * Finds the voices of a finished recording again with a fixed number of people and moves the
 * lines to them. A line a person set (`speakerSource: 'user'`) keeps its speaker: a named voice is
 * carried over to the new voice with that name, and a speaker only such lines still use stays.
 * Everything else is relabelled by overlap with the new turns. Nothing is transcribed again and
 * nothing is regenerated: the voice check, name suggestions and speaker review follow as jobs.
 */
export async function rerunSpeakers(
  deps: RerunDeps,
  { meetingId, speakers }: JobPayloads['meeting.rerun-speakers'],
): Promise<void> {
  if (!(await isRunning(deps.db, meetingId))) return;
  const run = new Run(deps.db, meetingId);
  let created: string[] = [];
  try {
    await run.begin();
    await run.step('speakers');
    const earlier = await deps.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meetingId));
    const path = await (await deps.loadStorage()).ensureLocal(mergedAudioPath(meetingId));
    const labels = await labelRecording(deps.db, deps.recording, meetingId, [], path, 0, speakers);
    created = labels.speakers.map((speaker) => speaker.id);
    if (created.length === 0) throw new Error('the voices could not be found, nothing changed');
    await run.step('saving');
    const idOf = new Map(
      earlier
        .filter((row) => row.nameConfirmed)
        .flatMap((row) => {
          const next = labels.speakers.find((speaker) => speaker.name === row.displayName);
          return next ? [[row.id, next.id] as const] : [];
        }),
    );
    const lines = await deps.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId));
    const kept = new Set<string>();
    await deps.db.transaction(async (tx) => {
      for (const line of lines) {
        if (line.speakerSource === 'user') {
          const next = line.participantId ? idOf.get(line.participantId) : undefined;
          if (next) {
            await tx
              .update(transcriptSegments)
              .set({ participantId: next })
              .where(eq(transcriptSegments.id, line.id));
          } else if (line.participantId) {
            kept.add(line.participantId);
          }
          continue;
        }
        const participantId = mostOverlapping(line, labels.spans);
        const score = scoreSpeaker({ ...line, participantId }, labels.spans, 'diarization');
        await tx
          .update(transcriptSegments)
          .set({
            participantId,
            speakerSource: participantId ? 'diarization' : null,
            speakerConfidence: score.confidence,
            speakerCandidates: score.candidates,
            previousParticipantId: null,
            suggestedParticipantId: null,
            voiceDoubt: false,
            byElimination: false,
            voiceScores: null,
            roomVoiceId: null,
          })
          .where(eq(transcriptSegments.id, line.id));
      }
    });
    await removeStaleSpeakers(
      deps.db,
      labels.staleIds.filter((id) => !kept.has(id)),
    );
    await deps.db
      .update(meetings)
      .set({ speakerCount: speakers, speakersChangedAt: new Date() })
      .where(eq(meetings.id, meetingId));
    await linkMeetingPeople(deps.db, meetingId).catch((failure: unknown) => {
      console.error(`the people of meeting ${meetingId} could not be saved`, failure);
    });
    await run.finish();
    await deps.queue.send('meeting.check-voices', { meetingId });
  } catch (error) {
    if (created.length > 0) {
      await deps.db
        .delete(participants)
        .where(inArray(participants.id, created))
        .catch(() => undefined);
    }
    await fail(deps.db, meetingId, run, error, 'Re-running the speakers');
  }
}

/**
 * Checks every line against the voices of the meeting again, when the setting is on, stores name
 * suggestions for recordings, and queues the speaker review. The lines a person set are skipped,
 * the audio file is already cut to the speech so the lines are used as they are.
 */
export async function checkMeetingVoices(
  deps: RerunDeps,
  { meetingId }: JobPayloads['meeting.check-voices'],
): Promise<void> {
  if (!(await isRunning(deps.db, meetingId))) return;
  const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, meetingId));
  const run = new Run(deps.db, meetingId);
  try {
    await run.begin();
    await run.step('speakers');
    if (await deps.recording.voicesChecked())
      await recheckLines(deps, meetingId, meeting?.trimStartMs);
    if (meeting?.platform === 'recording' || meeting?.platform === 'imported') {
      await suggestForMeeting(deps.db, deps.recording, meetingId);
    }
    await run.finish();
    await deps.db
      .update(meetings)
      .set({
        status: 'transcribed',
        error: null,
        speakersChangedAt: new Date(),
        speakerCheckRequestedAt: new Date(),
        speakerCheckError: null,
      })
      .where(and(eq(meetings.id, meetingId), eq(meetings.status, 'processing')));
    await deps.queue.send('meeting.review-speakers', { meetingId });
  } catch (error) {
    await fail(deps.db, meetingId, run, error, 'The voice check');
  }
}

async function recheckLines(
  deps: RerunDeps,
  meetingId: string,
  trimStartMs: number | null | undefined,
) {
  const lines = await deps.db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(transcriptSegments.startMs, transcriptSegments.id);
  const fresh: TranscriptRow[] = lines.map((line) =>
    line.speakerSource === 'user'
      ? line
      : {
          ...line,
          suggestedParticipantId: null,
          voiceDoubt: false,
          byElimination: false,
          voiceScores: null,
        },
  );
  const path = await (await deps.loadStorage()).ensureLocal(mergedAudioPath(meetingId));
  const range = trimStartMs ? { startMs: trimStartMs, endMs: trimStartMs } : null;
  const checked = await checkVoices(
    {
      db: deps.db,
      createDiarizer: deps.recording.createDiarizer,
      enabled: () => Promise.resolve(true),
    },
    meetingId,
    fresh,
    path,
    range,
    0,
  );
  await deps.db.transaction(async (tx) => {
    for (const [i, line] of lines.entries()) {
      const next = checked[i];
      if (!next || line.speakerSource === 'user') continue;
      await tx
        .update(transcriptSegments)
        .set({
          speakerConfidence: next.speakerConfidence ?? null,
          speakerCandidates: next.speakerCandidates ?? null,
          voiceDoubt: next.voiceDoubt ?? false,
          byElimination: next.byElimination ?? false,
          voiceScores: next.voiceScores ?? null,
          suggestedParticipantId: next.suggestedParticipantId ?? null,
        })
        .where(eq(transcriptSegments.id, line.id));
    }
  });
}
