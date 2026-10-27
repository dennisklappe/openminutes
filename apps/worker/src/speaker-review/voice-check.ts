import {
  MIN_SUGGESTION_SCORE,
  normalizeEmail,
  profileScore,
  SHORT_UTTERANCE_MS,
  SUSPECT_CONFIDENCE_CAP,
  type SpeechRange,
} from '@openminutes/core';
import {
  eq,
  participants,
  people,
  type Database,
  type SpeakerCandidate,
  type VoicePrototype,
} from '@openminutes/db';
import type { Diarizer } from '@openminutes/providers';
import type { TranscriptRow } from '../transcript-store.js';

export interface VoiceCheckDeps {
  db: Database;
  createDiarizer: () => Promise<Diarizer | undefined>;
  enabled: () => Promise<boolean>;
}

/** The own voice may trail the best fitting other voice by this much before a line is doubted. */
export const DOUBT_MARGIN = 0.1;
/** A saved voice must fit at least this well to be called a better fit. */
export const MIN_BETTER_SCORE = 0.45;
/** A line this weak against its own saved voice is doubted even when no other voice fits better. */
export const WEAK_OWN_SCORE = 0.25;
/** The span of margins that scales the confidence: a margin of 0.2 or more changes nothing and a
 * line whose own voice trails another by 0.1 or more loses half of its confidence. */
const FULL_MARGIN = 0.3;
const AGREE_OFFSET = 0.1;
const MARGIN_FLOOR = 0.5;
/** Under this a line is read from a one second window, too little to doubt it on its own. */
const MIN_RELIABLE_MS = 1000;
const MAX_LINES = 3000;

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

interface Profiled {
  participantId: string;
  prototypes: VoicePrototype[];
}

/** The meeting's participants that are a known person with a saved voice. */
async function profiledParticipants(db: Database, meetingId: string): Promise<Profiled[]> {
  const [here, everyone] = await Promise.all([
    db.select().from(participants).where(eq(participants.meetingId, meetingId)),
    db.select().from(people),
  ]);
  const withVoice = everyone.filter((person) => person.voicePrototypes.length > 0);
  if (withVoice.length === 0) return [];
  const profiled: Profiled[] = [];
  for (const participant of here) {
    const addresses = [participant.email, ...participant.inviteeEmails]
      .filter((address): address is string => !!address)
      .map(normalizeEmail);
    const person =
      withVoice.find((candidate) => candidate.id === participant.personId) ??
      withVoice.find(
        (candidate) => candidate.name.toLowerCase() === participant.displayName.toLowerCase(),
      ) ??
      withVoice.find((candidate) => candidate.emails.some((email) => addresses.includes(email)));
    if (person)
      profiled.push({ participantId: participant.id, prototypes: person.voicePrototypes });
  }
  return profiled;
}

/**
 * How trustworthy the voice of a line is as evidence: a full turn counts completely, a short one
 * less, because a voice print of a few words cannot tell speakers apart.
 */
export const reliability = (durationMs: number) => clamp(durationMs / SHORT_UTTERANCE_MS, 0, 1);

/**
 * Combines the timing score of a line with how its voice fits the saved voices of the people in
 * the meeting. The voice can only lower the confidence, by half at the most, scaled by how long
 * the line is. A line is doubted when another saved voice fits clearly better than the labelled
 * one, or the labelled one fits very badly, and it is not shorter than a second.
 */
export function judgeLine(
  row: Pick<TranscriptRow, 'participantId' | 'speakerConfidence' | 'speakerCandidates'>,
  durationMs: number,
  scores: ReadonlyMap<string, number>,
): {
  confidence: number | null;
  doubt: boolean;
  better: string | null;
  candidates: SpeakerCandidate[];
} {
  const own = row.participantId ? scores.get(row.participantId) : undefined;
  const others = [...scores].filter(([id]) => id !== row.participantId);
  const [bestId, bestScore] = others.toSorted((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const candidates = [...(row.speakerCandidates ?? [])];
  // Without a saved voice for the label only a clearly fitting other voice counts against it.
  const margin =
    own !== undefined ? own - bestScore : bestScore >= MIN_BETTER_SCORE ? -bestScore : FULL_MARGIN;
  const fit = clamp((margin + AGREE_OFFSET) / FULL_MARGIN, 0, 1);
  const factor = MARGIN_FLOOR + (1 - MARGIN_FLOOR) * fit;
  const trust = reliability(durationMs);
  const timing = row.speakerConfidence ?? null;
  const scaled = timing === null ? null : timing * (1 - trust * (1 - factor));
  const better =
    bestId !== null && bestScore >= MIN_BETTER_SCORE && bestScore - (own ?? 0) >= DOUBT_MARGIN
      ? bestId
      : null;
  const weak = own !== undefined && own < WEAK_OWN_SCORE;
  const doubt = durationMs >= MIN_RELIABLE_MS && (better !== null || weak);
  const confidence =
    scaled === null ? null : round(doubt ? Math.min(scaled, SUSPECT_CONFIDENCE_CAP) : scaled);
  if (doubt && better !== null) {
    const seen = candidates.find((candidate) => candidate.participantId === better);
    if (!seen) candidates.push({ participantId: better, score: MIN_SUGGESTION_SCORE });
    else if (seen.score < MIN_SUGGESTION_SCORE) seen.score = MIN_SUGGESTION_SCORE;
  }
  return { confidence, doubt, better: doubt ? better : null, candidates };
}

/**
 * Embeds every line of a meeting whose labels came from the speaking indicator and compares it
 * with the saved voices of the people in that meeting. It changes nothing when the check is off,
 * nobody in the meeting has a saved voice, or the voice service is unavailable. Lines a person
 * set are never touched. A doubted line gets the better fitting speaker as a suggestion.
 */
export async function checkVoices(
  deps: VoiceCheckDeps,
  meetingId: string,
  rows: readonly TranscriptRow[],
  audioPath: string,
  range: SpeechRange | null,
): Promise<TranscriptRow[]> {
  try {
    if (!(await deps.enabled())) return [...rows];
    const profiled = await profiledParticipants(deps.db, meetingId);
    if (profiled.length === 0) return [...rows];
    const checked = rows.flatMap((row, i) =>
      row.participantId && row.speakerSource !== 'user' ? [i] : [],
    );
    if (checked.length === 0 || checked.length > MAX_LINES) return [...rows];
    const diarizer = await deps.createDiarizer();
    const offset = range?.startMs ?? 0;
    const embedded = await diarizer?.embedEach(
      { path: audioPath },
      checked.map((i) => ({
        startMs: (rows[i]?.startMs ?? 0) + offset,
        endMs: (rows[i]?.endMs ?? 0) + offset,
      })),
    );
    if (!embedded) return [...rows];
    const result = [...rows];
    for (const [n, i] of checked.entries()) {
      const row = rows[i];
      const embedding = embedded.embeddings[n];
      if (!row || !embedding) continue;
      const scores = new Map(
        profiled.map((p) => [p.participantId, clamp(profileScore(embedding, p.prototypes), 0, 1)]),
      );
      const verdict = judgeLine(row, row.endMs - row.startMs, scores);
      result[i] = {
        ...row,
        speakerConfidence: verdict.confidence,
        speakerCandidates: verdict.candidates,
        voiceDoubt: verdict.doubt,
        voiceScores: [...scores]
          .map(([participantId, score]) => ({ participantId, score: round(score) }))
          .toSorted((a, b) => b.score - a.score),
        ...(verdict.better && { suggestedParticipantId: verdict.better }),
      };
    }
    return result;
  } catch (error) {
    console.error(`voice check of meeting ${meetingId} failed, keeping the labels`, error);
    return [...rows];
  }
}
