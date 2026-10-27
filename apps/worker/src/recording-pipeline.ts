import type { Database, NameSuggestion } from '@openminutes/db';
import type { SummaryProvider } from '@openminutes/providers';
import {
  conversationSuggestions,
  storeSuggestions,
  voiceSuggestions,
  type SpokenLine,
} from './name-suggestions.js';
import {
  removeStaleSpeakers,
  type RecordingSpeakers,
  type SpeakerSources,
} from './recording-speakers.js';
import type { TranscriptRow } from './transcript-store.js';

export interface RecordingDeps extends SpeakerSources {
  voicesRemembered: () => Promise<boolean>;
  /** Lines are checked against the saved voices of the people in the meeting. */
  voicesChecked: () => Promise<boolean>;
  createSuggester: () => Promise<SummaryProvider | undefined>;
}

async function askConversation(
  provider: SummaryProvider,
  lines: readonly SpokenLine[],
  labels: RecordingSpeakers,
): Promise<Map<string, NameSuggestion[]>> {
  try {
    return await conversationSuggestions(provider, lines, labels.speakers);
  } catch (error) {
    console.error('name suggestions from the conversation failed, storing none', error);
    return new Map();
  }
}

async function suggest(
  db: Database,
  recording: RecordingDeps,
  labels: RecordingSpeakers,
  rows: readonly TranscriptRow[],
): Promise<void> {
  const nameOf = new Map(labels.speakers.map((speaker) => [speaker.id, speaker.name]));
  const lines: SpokenLine[] = rows.map((row) => ({
    speaker: (row.participantId && nameOf.get(row.participantId)) || null,
    text: row.text,
  }));
  const provider = lines.length > 0 ? await recording.createSuggester() : undefined;
  const [voices, conversation] = await Promise.all([
    (await recording.voicesRemembered()) ? voiceSuggestions(db, labels.speakers) : new Map(),
    provider ? askConversation(provider, lines, labels) : new Map(),
  ]);
  await storeSuggestions(db, voices, conversation);
}

/**
 * Runs after the new transcript is saved: drops the speakers of an earlier run, then stores name
 * suggestions. Suggestions are best effort and never fail the meeting.
 */
export async function finishRecording(
  db: Database,
  recording: RecordingDeps | undefined,
  meetingId: string,
  labels: RecordingSpeakers,
  rows: readonly TranscriptRow[],
): Promise<void> {
  await removeStaleSpeakers(db, labels.staleIds);
  if (!recording || labels.speakers.length === 0) return;
  try {
    await suggest(db, recording, labels, rows);
  } catch (error) {
    console.error(`name suggestions for meeting ${meetingId} failed, storing none`, error);
  }
}
