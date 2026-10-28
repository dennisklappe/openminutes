import { rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  archiveAudio,
  detectSpeechRange,
  dropMadeUpLines,
  linkMeetingPeople,
  dropSilentSpeech,
  looksInvented,
  mergedAudioPath,
  originalAudioPath,
  type SilentRange,
  type SpeechRange,
  SummaryNotConfiguredError,
  type AudioStorage,
} from '@openminutes/core';
import {
  audioFiles,
  eq,
  meetings,
  speakerEvents,
  type Database,
  type MeetingPlatform,
  type MeetingStatus,
} from '@openminutes/db';
import type { Segment, SummaryProvider, TranscriptionProvider } from '@openminutes/providers';
import type { DetectLanguage } from './local-whisper.js';
import type { DetectSilence } from './detect-silence.js';
import type { MergeAudio } from './merge-audio.js';
import { finishRecording, type RecordingDeps } from './recording-pipeline.js';
import { labelRecording } from './recording-speakers.js';
import { Cancelled, limitFor, Run } from './run-progress.js';
import { repairWindows } from './repair-windows.js';
import { applyCorrections, captureCorrections } from './speaker-review/corrections.js';
import { reviewTranscript } from './speaker-review/transcript-review.js';
import { checkVoices } from './speaker-review/voice-check.js';
import type { TrimAudio } from './trim-audio.js';
import { autoLearn } from './auto-learn.js';
import type { EmbeddedLine, ScoredLine } from './speaker-review/voice-check.js';
import { saveRoomVoices } from './room-voices.js';
import { saveTranscript, toTranscriptRows, type TranscriptRow } from './transcript-store.js';

export interface ProcessDeps {
  db: Database;
  loadStorage: () => Promise<AudioStorage>;
  mergeAudio: MergeAudio;
  trimAudio: TrimAudio;
  detectSilence: DetectSilence;
  detectLanguage?: DetectLanguage;
  createTranscriber: () => Promise<TranscriptionProvider>;
  createFallbackTranscriber?: () => Promise<TranscriptionProvider | undefined>;
  createRefiner: () => Promise<SummaryProvider | undefined>;
  requestSummary: (meetingId: string) => Promise<unknown>;
  recording?: RecordingDeps;
}

const PROCESSABLE: readonly MeetingStatus[] = ['ended', 'processing', 'transcribed', 'failed'];

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function mergeOriginalAudio(
  deps: ProcessDeps,
  storage: AudioStorage,
  meetingId: string,
): Promise<{ path: string; durationMs: number }> {
  const files = await deps.db
    .select({ path: audioFiles.path, durationMs: audioFiles.durationMs })
    .from(audioFiles)
    .where(eq(audioFiles.meetingId, meetingId))
    .orderBy(audioFiles.path);
  if (files.length === 0) throw new Error('No audio was recorded');

  const original = originalAudioPath(meetingId);
  await storage.local.ensureDirectory(dirname(original));
  const inputs = await Promise.all(files.map((file) => storage.ensureLocal(file.path)));
  await deps.mergeAudio(inputs, storage.local.absolutePath(original));
  return {
    path: storage.local.absolutePath(original),
    durationMs: files.reduce((total, file) => total + file.durationMs, 0),
  };
}

async function findSilences(
  deps: ProcessDeps,
  path: string,
  durationMs: number,
  meetingId: string,
): Promise<SilentRange[]> {
  try {
    return await deps.detectSilence(path, durationMs);
  } catch (error) {
    console.error(`silence detection of meeting ${meetingId} failed, keeping all speech`, error);
    return [];
  }
}

/**
 * Speech models sometimes lock onto a made-up line and repeat it through the whole file. That
 * transcript is worse than none, so it is redone by the local service once and dropped when that
 * one makes things up too. When only some windows are made up, only those are redone.
 */
async function transcribeTrusted(
  deps: ProcessDeps,
  path: string,
  meetingId: string,
  language: string | undefined,
  durationMs: number,
  run: Run,
): Promise<Segment[]> {
  const report = (step: 'transcribing' | 'repairing') => (done: number, total: number) => {
    run.step(step, done, total).catch((error: unknown) => {
      console.error(`progress of meeting ${meetingId} could not be saved`, error);
    });
  };
  const options = {
    signal: run.signal,
    onProgress: report('transcribing'),
    ...(language && { language }),
  };
  const transcriber = await deps.createTranscriber();
  const segments = await transcriber.transcribe({ path }, options);
  if (!looksInvented(segments)) {
    const fallback = await deps.createFallbackTranscriber?.();
    return repairWindows(segments, durationMs, path, deps.trimAudio, fallback, {
      ...options,
      onProgress: report('repairing'),
    });
  }
  console.error(`transcript of meeting ${meetingId} looks made up, trying the local service`);
  try {
    const retry = await (await deps.createFallbackTranscriber?.())?.transcribe({ path }, options);
    if (retry && !looksInvented(retry)) return retry;
  } catch (error) {
    console.error(`local transcription of meeting ${meetingId} failed`, error);
  }
  return [];
}

async function publishAudio(
  deps: ProcessDeps,
  storage: AudioStorage,
  meetingId: string,
  original: string,
  range: SpeechRange | null,
): Promise<void> {
  const merged = storage.local.absolutePath(mergedAudioPath(meetingId));
  if (range) await deps.trimAudio(original, merged, range);
  else await rename(original, merged);
  await rm(original, { force: true });
}

async function startSummary(deps: ProcessDeps, meetingId: string): Promise<void> {
  try {
    await deps.requestSummary(meetingId);
  } catch (error) {
    if (error instanceof SummaryNotConfiguredError) return;
    console.error(`summary of meeting ${meetingId} could not be started`, error);
  }
}

/** Everyone in the meeting gets a profile. It never fails the meeting. */
async function linkPeople(db: Database, meetingId: string): Promise<void> {
  try {
    await linkMeetingPeople(db, meetingId);
  } catch (error) {
    console.error(`the people of meeting ${meetingId} could not be saved`, error);
  }
}

async function archive(db: Database, storage: AudioStorage, meetingId: string): Promise<void> {
  try {
    await archiveAudio(db, storage, meetingId);
  } catch (error) {
    console.error(`audio of meeting ${meetingId} could not be moved to the bucket`, error);
    await db
      .update(meetings)
      .set({ error: `Audio could not be moved to the bucket: ${errorMessage(error)}` })
      .where(eq(meetings.id, meetingId));
  }
}

async function chooseLanguage(
  deps: ProcessDeps,
  path: string,
  chosen: string | undefined,
): Promise<string | undefined> {
  if (chosen) return chosen;
  try {
    return await deps.detectLanguage?.(path);
  } catch (error) {
    console.error('language detection failed, leaving it to the provider', error);
    return undefined;
  }
}

const separatesVoices = (platform: MeetingPlatform) =>
  platform === 'recording' || platform === 'imported';

export async function processMeeting(
  deps: ProcessDeps,
  meetingId: string,
  chosenLanguage?: string,
): Promise<void> {
  const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting || !PROCESSABLE.includes(meeting.status)) return;

  const setStatus = (status: MeetingStatus, error: string | null = null) =>
    deps.db.update(meetings).set({ status, error }).where(eq(meetings.id, meetingId));

  await setStatus('processing');
  const run = new Run(deps.db, meetingId);
  await run.begin();
  const storage = await deps.loadStorage();
  try {
    const original = await mergeOriginalAudio(deps, storage, meetingId);
    run.limit(limitFor(original.durationMs));
    const language = await chooseLanguage(deps, original.path, chosenLanguage);
    const transcribed = await transcribeTrusted(
      deps,
      original.path,
      meetingId,
      language,
      original.durationMs,
      run,
    );
    await run.step('speakers');
    const events = await deps.db
      .select({
        participantId: speakerEvents.participantId,
        startMs: speakerEvents.startMs,
        endMs: speakerEvents.endMs,
      })
      .from(speakerEvents)
      .where(eq(speakerEvents.meetingId, meetingId));
    const silences = await findSilences(deps, original.path, original.durationMs, meetingId);
    const segments = dropSilentSpeech(dropMadeUpLines(transcribed), silences, events);
    const range = detectSpeechRange(segments, original.durationMs);
    const labels = separatesVoices(meeting.platform)
      ? await labelRecording(
          deps.db,
          deps.recording,
          meetingId,
          segments,
          original.path,
          meeting.trimStartMs ?? 0,
          meeting.speakerCount,
        )
      : undefined;
    const spans = labels?.spans ?? events;
    await run.step('saving');
    // Everything that reads the original audio runs first: publishing moves or removes it.
    let checked: TranscriptRow[];
    const scored: ScoredLine[] = [];
    const embedded: EmbeddedLine[] = [];
    const staleIds = labels?.staleIds ?? [];
    try {
      const corrections = await captureCorrections(deps.db, meetingId, meeting.trimStartMs);
      const aligned = toTranscriptRows(
        meetingId,
        segments,
        spans,
        range,
        labels ? 'diarization' : 'indicator',
        language,
      );
      const corrected = await applyCorrections(
        deps.db,
        meetingId,
        aligned,
        corrections,
        range,
        staleIds,
      );
      // A diarized import of two speakers is only scored, for learning by 1:1 elimination.
      const pairImport = labels !== undefined && meeting.speakerCount === 2;
      checked =
        (labels && !pairImport) || !deps.recording
          ? corrected
          : await checkVoices(
              {
                db: deps.db,
                createDiarizer: deps.recording.createDiarizer,
                enabled: pairImport
                  ? deps.recording.voicesRemembered
                  : deps.recording.voicesChecked,
                scoreOnly: pairImport,
                onScored: (lines) => {
                  scored.push(...lines);
                },
                ...(!pairImport && {
                  onEmbedded: (lines: EmbeddedLine[]) => {
                    embedded.push(...lines);
                  },
                }),
              },
              meetingId,
              corrected,
              original.path,
              range,
            );
    } finally {
      await publishAudio(deps, storage, meetingId, original.path, range);
    }
    const { rows, check } = await reviewTranscript(deps, meetingId, checked, staleIds);
    await saveTranscript(deps.db, meetingId, rows, range);
    await saveRoomVoices(deps.db, meetingId, embedded);
    if (labels) await finishRecording(deps.db, deps.recording, meetingId, labels, rows);
    await deps.db
      .update(meetings)
      .set({ ...check, language: language ?? null })
      .where(eq(meetings.id, meetingId));
    await run.finish();
    await setStatus('transcribed');
    await linkPeople(deps.db, meetingId);
    await autoLearn(
      deps.db,
      meetingId,
      scored,
      (await deps.recording?.voicesRemembered()) ?? false,
      scored.length > 0 && deps.recording
        ? {
            audioPath: storage.local.absolutePath(mergedAudioPath(meetingId)),
            diarizer: await deps.recording.createDiarizer().catch(() => undefined),
          }
        : undefined,
    );
    await archive(deps.db, storage, meetingId);
    if (segments.length > 0) await startSummary(deps, meetingId);
  } catch (error) {
    run.stop();
    if (run.wasCancelled || error instanceof Cancelled) return;
    console.error(`transcription of meeting ${meetingId} failed`, error);
    const reason: unknown = run.signal.aborted ? run.signal.reason : error;
    await setStatus('failed', `Transcription failed: ${errorMessage(reason)}`);
  }
}
