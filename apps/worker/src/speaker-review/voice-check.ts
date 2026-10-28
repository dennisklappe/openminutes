import {
  ANCHOR_FIRM_CONFIDENCE,
  ANCHOR_MAX_PER_PERSON,
  ANCHOR_MIN_PEOPLE,
  buildMeetingVoices,
  clearWinner,
  combineScores,
  isUndisturbed,
  meetingScore,
  MIN_SUGGESTION_SCORE,
  normalizeEmail,
  profileScore,
  ROOM_MAX_LINES,
  ROOM_MIN_LINES,
  selectAnchors,
  SHORT_UTTERANCE_MS,
  SUSPECT_CONFIDENCE_CAP,
  type SpeechRange,
} from '@openminutes/core';
import {
  eq,
  participants,
  people,
  speakerEvents,
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
  /** Told about every scored line, for learning the near-certain ones afterwards. */
  onScored?: (lines: ScoredLine[]) => void;
  /**
   * Told about every embedded line, for finding several people in one participant tile. When set,
   * a meeting is also embedded when a tile has enough clean lines for that.
   */
  onEmbedded?: (lines: EmbeddedLine[]) => void;
}

/** A line with its voice, as handed to the search for shared tiles. */
export interface EmbeddedLine {
  startMs: number;
  endMs: number;
  participantId: string;
  embedding: number[];
  /** A clean line: see `selectAnchors`. */
  anchor: boolean;
  /** Nobody else speaks over it, so it may be given to one voice of a shared tile. */
  undisturbed: boolean;
}

/** A line with its voice, what the check scored it against and how sure the timing was. */
export interface ScoredLine {
  startMs: number;
  endMs: number;
  participantId: string;
  embedding: number[];
  embedder: string | null;
  /** The timing score before the voice changed it. */
  timing: number | null;
  /** Voice check score per profiled participant of the meeting, in the language of the line. */
  scores: ReadonlyMap<string, number>;
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

/**
 * A voice clearly ahead of the others raises the confidence of the label: at least this score
 * and this margin over the best other voice add RAISE (scaled by how long the line is), up to
 * RAISE_CAP. The voice alone never makes a line fully certain.
 */
export const RAISE_MIN_SCORE = 0.7;
export const RAISE_MARGIN = 0.3;
export const RAISE = 0.05;
export const RAISE_CAP = 0.95;
/**
 * A line that fits nobody with a saved voice (every score below ELIM_MAX_SCORE) while exactly one
 * participant has no saved voice is probably that participant, by elimination. It gets ELIM_BOOST
 * more confidence up to ELIM_CAP when it is already labelled so, else that participant is
 * suggested. Only for lines of at least SHORT_UTTERANCE_MS.
 */
export const ELIM_MAX_SCORE = 0.3;
export const ELIM_BOOST = 0.1;
export const ELIM_CAP = 0.9;
/** A saved voice this sure of a line labelled as someone else is a conflict: both are doubted. */
export const CONFLICT_SCORE = 0.8;

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

interface Profiled {
  participantId: string;
  prototypes: VoicePrototype[];
}

interface Seats {
  profiled: Profiled[];
  /** People in the meeting without a saved voice, bots left out. */
  unprofiled: string[];
  /** Someone in the meeting is marked do not track, so nobody can be ruled out by elimination. */
  hasUntracked: boolean;
}

/** The meeting's participants that are a known person with a saved voice. */
async function profiledParticipants(db: Database, meetingId: string): Promise<Seats> {
  const [here, everyone] = await Promise.all([
    db.select().from(participants).where(eq(participants.meetingId, meetingId)),
    db.select().from(people),
  ]);
  const withVoice = everyone.filter(
    (person) => person.tracking === 'on' && person.voicePrototypes.length > 0,
  );
  if (withVoice.length === 0) return { profiled: [], unprofiled: [], hasUntracked: false };
  const profiled: Profiled[] = [];
  const unprofiled: string[] = [];
  const off = everyone.filter((person) => person.tracking === 'off');
  let hasUntracked = false;
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
    if (person) {
      profiled.push({ participantId: participant.id, prototypes: person.voicePrototypes });
    } else if (
      off.some(
        (candidate) =>
          candidate.id === participant.personId ||
          candidate.name.toLowerCase() === participant.displayName.toLowerCase() ||
          candidate.emails.some((email) => addresses.includes(email)),
      )
    ) {
      hasUntracked = true;
    } else if (!participant.isBot) {
      unprofiled.push(participant.id);
    }
  }
  return { profiled, unprofiled, hasUntracked };
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
  // A clear lead for the label raises the confidence a little, never to certainty.
  const lead =
    own !== undefined && own >= RAISE_MIN_SCORE && own - bestScore >= RAISE_MARGIN && !doubt;
  const raised =
    scaled !== null && lead && scaled < RAISE_CAP
      ? Math.min(RAISE_CAP, scaled + RAISE * trust)
      : scaled;
  const confidence =
    raised === null ? null : round(doubt ? Math.min(raised, SUSPECT_CONFIDENCE_CAP) : raised);
  if (doubt && better !== null) {
    const seen = candidates.find((candidate) => candidate.participantId === better);
    if (!seen) candidates.push({ participantId: better, score: MIN_SUGGESTION_SCORE });
    else if (seen.score < MIN_SUGGESTION_SCORE) seen.score = MIN_SUGGESTION_SCORE;
    // A voice that is sure of someone else conflicts with the label: the label loses weight too.
    if (bestScore >= CONFLICT_SCORE) {
      const labelled = candidates.find(
        (candidate) => candidate.participantId === row.participantId,
      );
      if (labelled) labelled.score = round(labelled.score / 2);
    }
  }
  return { confidence, doubt, better: doubt ? better : null, candidates };
}

/**
 * By elimination: when one participant has no saved voice and a long line fits none of the saved
 * voices, the line is probably theirs. Undefined when that does not apply.
 */
export function eliminate(
  row: Pick<TranscriptRow, 'participantId' | 'speakerCandidates' | 'startMs' | 'endMs'>,
  verdict: { confidence: number | null; candidates: SpeakerCandidate[] },
  scores: ReadonlyMap<string, number>,
  remaining: string | undefined,
): { confidence: number | null; candidates: SpeakerCandidate[]; suggest?: string } | undefined {
  if (!remaining || !row.participantId) return undefined;
  if (row.endMs - row.startMs < SHORT_UTTERANCE_MS) return undefined;
  if ([...scores.values()].some((score) => score >= ELIM_MAX_SCORE)) return undefined;
  if (row.participantId === remaining) {
    const confidence =
      verdict.confidence === null
        ? null
        : round(Math.min(ELIM_CAP, verdict.confidence + ELIM_BOOST));
    return {
      confidence: confidence === null ? null : Math.max(confidence, verdict.confidence ?? 0),
      candidates: verdict.candidates,
    };
  }
  const candidates = [...verdict.candidates];
  const seen = candidates.find((candidate) => candidate.participantId === remaining);
  if (!seen) candidates.push({ participantId: remaining, score: MIN_SUGGESTION_SCORE });
  else if (seen.score < MIN_SUGGESTION_SCORE) seen.score = MIN_SUGGESTION_SCORE;
  return {
    confidence:
      verdict.confidence === null ? null : Math.min(verdict.confidence, SUSPECT_CONFIDENCE_CAP),
    candidates,
    suggest: remaining,
  };
}

/** Lines are sent to the voice service in batches of this many ranges. */
export const EMBED_BATCH_SIZE = 400;

export async function embedInBatches(
  diarizer: Diarizer | undefined,
  audioPath: string,
  ranges: { startMs: number; endMs: number }[],
): Promise<{ embeddings: (number[] | null)[]; model: string | null } | undefined> {
  if (!diarizer) return undefined;
  const embeddings: (number[] | null)[] = [];
  let model: string | null = null;
  for (let i = 0; i < ranges.length; i += EMBED_BATCH_SIZE) {
    const batch = await diarizer.embedEach(
      { path: audioPath },
      ranges.slice(i, i + EMBED_BATCH_SIZE),
    );
    if (!batch) return undefined;
    embeddings.push(...batch.embeddings);
    model = batch.model ?? model;
  }
  return { embeddings, model };
}

/**
 * Embeds every line of a meeting whose labels came from the speaking indicator and compares it
 * with the saved voices of the people in that meeting and with the meeting-local voices of its
 * participants (see `voice-anchors`). It changes nothing when the check is off, there is neither
 * a saved voice nor a usable pair of meeting voices, or the voice service is unavailable. Lines a
 * person set are never touched. A doubted line gets the better fitting speaker as a suggestion.
 * Meeting voices are temporary: nothing about them is saved.
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
    const { profiled, unprofiled, hasUntracked } = await profiledParticipants(deps.db, meetingId);
    const remaining = unprofiled.length === 1 && !hasUntracked ? unprofiled[0] : undefined;
    const checked = rows.flatMap((row, i) =>
      row.participantId && row.speakerSource !== 'user' ? [i] : [],
    );
    if (checked.length === 0 || checked.length > MAX_LINES) return [...rows];
    const offset = range?.startMs ?? 0;
    const picked = await pickAnchors(deps.db, meetingId, rows, offset);
    const anchorsOf = new Map<string | null | undefined, number[]>();
    for (const key of picked.anchors) {
      const who = rows[key]?.participantId;
      anchorsOf.set(who, [...(anchorsOf.get(who) ?? []), key]);
    }
    // Without saved voices the meeting voices must tell at least two people apart, or a tile must
    // hold enough clean lines to be looked at as a shared one.
    const roomTile =
      deps.onEmbedded !== undefined &&
      [...anchorsOf.values()].some((list) => list.length >= ROOM_MIN_LINES);
    if (profiled.length === 0 && anchorsOf.size < ANCHOR_MIN_PEOPLE && !roomTile) {
      return [...rows];
    }
    const diarizer = await deps.createDiarizer();
    const embedded = await embedInBatches(
      diarizer,
      audioPath,
      checked.map((i) => ({
        startMs: (rows[i]?.startMs ?? 0) + offset,
        endMs: (rows[i]?.endMs ?? 0) + offset,
      })),
    );
    if (!embedded) return [...rows];
    const anchorSet = new Set(picked.anchors);
    const embeddingOf = new Map(checked.map((i, n) => [i, embedded.embeddings[n] ?? null]));
    deps.onEmbedded?.(
      checked.flatMap((i) => {
        const row = rows[i];
        const embedding = embeddingOf.get(i);
        return row?.participantId && embedding
          ? [
              {
                startMs: row.startMs,
                endMs: row.endMs,
                participantId: row.participantId,
                embedding,
                anchor: anchorSet.has(i),
                undisturbed: picked.undisturbed.has(i),
              },
            ]
          : [];
      }),
    );
    const voices = buildMeetingVoices(
      [...anchorsOf.values()].flatMap((list) =>
        list.slice(0, ANCHOR_MAX_PER_PERSON).flatMap((i) => {
          const vector = embeddingOf.get(i);
          const participantId = rows[i]?.participantId;
          return vector && participantId ? [{ key: i, participantId, vector }] : [];
        }),
      ),
    );
    if (profiled.length === 0 && voices.length < ANCHOR_MIN_PEOPLE) return [...rows];
    const result = [...rows];
    const scored: ScoredLine[] = [];
    for (const i of checked) {
      const row = rows[i];
      const embedding = embeddingOf.get(i);
      if (!row || !embedding) continue;
      const profileScores = new Map(
        profiled.map((p) => [
          p.participantId,
          clamp(profileScore(embedding, p.prototypes, row.language), 0, 1),
        ]),
      );
      const meetingScores = new Map(
        voices.flatMap((voice) => {
          const score = meetingScore(embedding, voice, i);
          return score === undefined ? [] : [[voice.participantId, clamp(score, 0, 1)] as const];
        }),
      );
      const scores = new Map<string, number>();
      for (const id of new Set([...profileScores.keys(), ...meetingScores.keys()])) {
        const mixed = combineScores(profileScores.get(id), meetingScores.get(id));
        if (mixed !== undefined) scores.set(id, mixed);
      }
      const duration = row.endMs - row.startMs;
      const verdict = judgeLine(row, duration, scores);
      const winner = meetingScores.size > 0 ? clearWinner(scores)?.participantId : undefined;
      // A clear winner among the meeting voices rules out elimination, which only knows saved voices.
      const left = winner ? undefined : eliminate(row, verdict, profileScores, remaining);
      const firm =
        winner !== undefined &&
        winner === row.participantId &&
        !verdict.doubt &&
        duration >= SHORT_UTTERANCE_MS &&
        verdict.confidence !== null &&
        verdict.confidence < ANCHOR_FIRM_CONFIDENCE
          ? ANCHOR_FIRM_CONFIDENCE
          : undefined;
      // A line flagged as mixed holds two voices and never trains a profile.
      if (row.participantId && profiled.length > 0 && !row.mixed) {
        scored.push({
          startMs: row.startMs,
          endMs: row.endMs,
          participantId: row.participantId,
          embedding,
          embedder: embedded.model,
          timing: row.speakerConfidence ?? null,
          // Only saved voices count for learning, a meeting voice never trains a profile.
          scores: profileScores,
        });
      }
      result[i] = {
        ...row,
        speakerConfidence: left?.confidence ?? firm ?? verdict.confidence,
        speakerCandidates: left?.candidates ?? verdict.candidates,
        voiceDoubt: verdict.doubt,
        ...(left && { byElimination: true }),
        voiceScores: [...scores]
          .map(([participantId, score]) => ({ participantId, score: round(score) }))
          .toSorted((a, b) => b.score - a.score),
        ...(verdict.better && { suggestedParticipantId: verdict.better }),
        ...(left?.suggest && !verdict.better && { suggestedParticipantId: left.suggest }),
      };
    }
    deps.onScored?.(scored);
    return result;
  } catch (error) {
    console.error(`voice check of meeting ${meetingId} failed, keeping the labels`, error);
    return [...rows];
  }
}

/**
 * The indices of the rows that are clean anchor lines (see `selectAnchors`), the longest first per
 * participant, and of the rows nobody else speaks over.
 */
async function pickAnchors(
  db: Database,
  meetingId: string,
  rows: readonly TranscriptRow[],
  offset: number,
): Promise<{ anchors: number[]; undisturbed: Set<number> }> {
  const events = await db
    .select({
      participantId: speakerEvents.participantId,
      startMs: speakerEvents.startMs,
      endMs: speakerEvents.endMs,
    })
    .from(speakerEvents)
    .where(eq(speakerEvents.meetingId, meetingId));
  // Every labelled line counts for overlaps, also the ones a person set.
  const candidates = rows.flatMap((row, i) =>
    row.participantId
      ? [
          {
            key: i,
            participantId: row.participantId,
            startMs: row.startMs + offset,
            endMs: row.endMs + offset,
            speakerSource: row.speakerSource ?? null,
            speakerConfidence: row.speakerConfidence ?? null,
            touched:
              !!row.previousParticipantId ||
              !!row.suggestedParticipantId ||
              !!row.voiceDoubt ||
              // Two voices in one line: no anchor for a meeting voice, but it still counts for overlaps.
              !!row.mixed,
          },
        ]
      : [],
  );
  return {
    anchors: selectAnchors(candidates, events, ROOM_MAX_LINES).map((anchor) => anchor.key),
    undisturbed: new Set(
      candidates.filter((c) => isUndisturbed(c, candidates, events)).map((c) => c.key),
    ),
  };
}
