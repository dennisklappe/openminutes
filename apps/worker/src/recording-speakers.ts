import type { DiarizationResult, Diarizer, Segment } from '@openminutes/providers';
import type { SpeakerSpan } from '@openminutes/core';
import { eq, inArray, participants, transcriptSegments, type Database } from '@openminutes/db';

interface DetectedVoice {
  key: string;
  durationMs: number;
  embedding?: number[];
}

interface VoiceTurn {
  key: string;
  startMs: number;
  endMs: number;
  margin?: number;
}

interface Detected {
  voices: DetectedVoice[];
  turns: VoiceTurn[];
}

export interface RecordingSpeaker {
  id: string;
  name: string;
  embedding: number[] | null;
}

export interface RecordingSpeakers {
  spans: SpeakerSpan[];
  speakers: RecordingSpeaker[];
  staleIds: string[];
}

interface Earlier {
  id: string;
  name: string;
  embedding: number[] | null;
}

const SAME_VOICE = 0.6;
const SAME_SHARE = 0.5;

const cosine = (a: number[], b: number[]): number => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  a.forEach((value, i) => {
    const other = b[i] ?? 0;
    dot += value * other;
    normA += value * value;
    normB += other * other;
  });
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
};

const overlapMs = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

interface Kept {
  earlier: Earlier;
  confident: boolean;
}

interface Pair {
  voice: DetectedVoice;
  old: Earlier;
  overlap: number;
  alike: number;
}

/**
 * Pairs each new voice with the named speaker of the earlier run, so a re-run keeps the names
 * people entered. For the same recording who spoke when is exact, so overlap in time decides
 * first, then how the voice sounds. A name that matches neither well still goes to the voice it
 * overlaps most (or sounds most like), flagged as unconfirmed: a confirmed name is never dropped
 * while a voice is free. Every voice and every name is used at most once.
 */
function matchEarlier(
  voices: readonly DetectedVoice[],
  turns: readonly VoiceTurn[],
  earlier: readonly Earlier[],
  said: ReadonlyMap<string, { startMs: number; endMs: number }[]>,
): Map<string, Kept> {
  const pairs: Pair[] = voices.flatMap((voice) =>
    earlier.map((old) => {
      const spans = said.get(old.id) ?? [];
      const together = turns
        .filter((turn) => turn.key === voice.key)
        .reduce((sum, turn) => sum + spans.reduce((s, span) => s + overlapMs(turn, span), 0), 0);
      return {
        voice,
        old,
        overlap: voice.durationMs > 0 ? together / voice.durationMs : 0,
        alike: voice.embedding && old.embedding ? cosine(voice.embedding, old.embedding) : 0,
      };
    }),
  );
  const kept = new Map<string, Kept>();
  const taken = new Set<string>();
  const assign = (ranked: Pair[], confident: boolean) => {
    for (const { voice, old } of ranked) {
      if (kept.has(voice.key) || taken.has(old.id)) continue;
      kept.set(voice.key, { earlier: old, confident });
      taken.add(old.id);
    }
  };
  assign(
    pairs.filter((p) => p.overlap >= SAME_SHARE).toSorted((a, b) => b.overlap - a.overlap),
    true,
  );
  assign(
    pairs.filter((p) => p.alike >= SAME_VOICE).toSorted((a, b) => b.alike - a.alike),
    true,
  );
  assign(
    pairs.toSorted((a, b) => b.overlap + b.alike - (a.overlap + a.alike)),
    false,
  );
  return kept;
}

export interface SpeakerSources {
  createDiarizer: () => Promise<Diarizer | undefined>;
}

function fromProviderLabels(segments: readonly Segment[]): Detected | undefined {
  const labelled = segments.filter((segment) => segment.speaker);
  if (labelled.length === 0) return undefined;
  const totals = new Map<string, number>();
  const turns: VoiceTurn[] = [];
  for (const { speaker, startMs, endMs } of labelled) {
    const key = speaker ?? '';
    totals.set(key, (totals.get(key) ?? 0) + endMs - startMs);
    turns.push({ key, startMs, endMs });
  }
  return {
    voices: [...totals].map(([key, durationMs]) => ({ key, durationMs })),
    turns,
  };
}

function fromDiarization(result: DiarizationResult): Detected {
  return {
    voices: result.speakers.map(({ id, durationMs, embedding }) => ({
      key: String(id),
      durationMs,
      ...(embedding.length > 0 ? { embedding } : {}),
    })),
    turns: result.turns.map(({ speaker, startMs, endMs, similarity, runnerUp }) => ({
      key: String(speaker),
      startMs,
      endMs,
      ...(similarity !== undefined && runnerUp ? { margin: similarity - runnerUp.similarity } : {}),
    })),
  };
}

async function diarize(
  sources: SpeakerSources | undefined,
  meetingId: string,
  audioPath: string,
  numSpeakers: number | null,
): Promise<Detected | undefined> {
  try {
    const diarizer = await sources?.createDiarizer();
    const result = await diarizer?.diarize(
      { path: audioPath },
      numSpeakers === null ? {} : { numSpeakers },
    );
    return result && fromDiarization(result);
  } catch (error) {
    console.error(
      `diarization of meeting ${meetingId} failed, leaving the speakers unknown`,
      error,
    );
    return undefined;
  }
}

/**
 * Finds the voices in a recording and creates one participant per voice, "Speaker 1" being the
 * one who talks longest. The provider's own speaker labels win, then the local diarizer on the
 * original audio. Without either the transcript stays unlabelled. Participants from an earlier
 * run are only reported as stale: they are still referenced by the old transcript rows, so
 * `removeStaleSpeakers` deletes them once the new transcript is saved.
 */
export async function labelRecording(
  db: Database,
  sources: SpeakerSources | undefined,
  meetingId: string,
  segments: readonly Segment[],
  audioPath: string,
  earlierTrimMs = 0,
  numSpeakers: number | null = null,
): Promise<RecordingSpeakers> {
  const stale = await db.select().from(participants).where(eq(participants.meetingId, meetingId));
  const staleIds = stale.map((row) => row.id);
  const detected =
    fromProviderLabels(segments) ?? (await diarize(sources, meetingId, audioPath, numSpeakers));
  if (!detected || detected.voices.length === 0) return { spans: [], speakers: [], staleIds };

  const voices = detected.voices.toSorted((a, b) => b.durationMs - a.durationMs);
  const named = [
    ...new Map(
      stale.filter((row) => row.nameConfirmed).map((row) => [row.displayName, row]),
    ).values(),
  ];
  const said = new Map<string, { startMs: number; endMs: number }[]>();
  if (named.length > 0) {
    const earlierRows = await db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId));
    for (const row of earlierRows) {
      if (!row.participantId) continue;
      const spans = said.get(row.participantId) ?? [];
      spans.push({ startMs: row.startMs + earlierTrimMs, endMs: row.endMs + earlierTrimMs });
      said.set(row.participantId, spans);
    }
  }
  const kept = matchEarlier(
    voices,
    detected.turns,
    named.map((row) => ({ id: row.id, name: row.displayName, embedding: row.voiceEmbedding })),
    said,
  );
  const created = await db
    .insert(participants)
    .values(
      voices.map((voice, i) => {
        const match = kept.get(voice.key);
        return {
          meetingId,
          displayName: match?.earlier.name ?? `Speaker ${String(i + 1)}`,
          nameConfirmed: match?.confident ?? false,
          voiceEmbedding: voice.embedding ?? null,
        };
      }),
    )
    .returning();
  const idOf = new Map<string, string>();
  const speakers = voices.flatMap((voice, i): RecordingSpeaker[] => {
    const row = created[i];
    if (!row) return [];
    idOf.set(voice.key, row.id);
    return [{ id: row.id, name: row.displayName, embedding: voice.embedding ?? null }];
  });
  const spans = detected.turns.flatMap(({ key, startMs, endMs, margin }) => {
    const participantId = idOf.get(key);
    return participantId ? [{ participantId, startMs, endMs, margin }] : [];
  });
  return { spans, speakers, staleIds };
}

export async function removeStaleSpeakers(db: Database, staleIds: readonly string[]) {
  if (staleIds.length > 0)
    await db.delete(participants).where(inArray(participants.id, [...staleIds]));
}
