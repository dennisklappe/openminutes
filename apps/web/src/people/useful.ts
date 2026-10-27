import { LOW_SPEAKER_CONFIDENCE } from '@openminutes/core';

/**
 * Which review lines are worth a person's time. A voice profile needs clean, single-speaker
 * speech of a few seconds, and only so much of it, so the queue asks for the lines that teach
 * the most and stops asking for a profile that is good enough.
 */

/** A line shorter than this says too little about a voice. */
export const MIN_LINE_MS = 3000;
/** Lines up to this long are best, longer ones are still fine but cost more to listen to. */
export const PREFERRED_MAX_MS = 15_000;
/** Verified speech per profile after which the person stops being asked about. */
export const TARGET_MS = 90_000;
/** Lines in one review session before Keep going. */
export const SESSION_CAP = 25;
/** Two lines of one person closer than this in one meeting are near duplicates. */
const NEAR_MS = 30_000;
/**
 * A line is in doubt when the labelling is less sure than this, whatever the voice profile
 * looks like. Above it a line is only worth a look while the profile still needs samples.
 */
export const DOUBT_CONFIDENCE = LOW_SPEAKER_CONFIDENCE;
/** A competing candidate this strong makes a line doubtful even when the label looks sure. */
export const DOUBT_RIVAL_SCORE = 0.5;

const FILLER = new Set([
  'uh',
  'um',
  'uhm',
  'uh-huh',
  'mm',
  'mhm',
  'hmm',
  'euh',
  'eh',
  'ah',
  'oh',
  'ja',
  'jaja',
  'nee',
  'okay',
  'ok',
  'oke',
  'yeah',
  'yes',
  'yep',
  'no',
  'right',
  'sure',
  'thanks',
  'thank',
  'you',
  'goed',
  'precies',
  'top',
  'bye',
  'hi',
  'hello',
]);

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}'-]+/u)
    .filter(Boolean);

/** Mostly filler or backchannel: at least half the words, or fewer than 4 real words. */
export function isFiller(text: string): boolean {
  const all = words(text);
  const real = all.filter((word) => !FILLER.has(word));
  return all.length === 0 || real.length < 4 || real.length * 2 < all.length;
}

export interface Candidate {
  id: string;
  /** What a target is counted per: the profile the line would train. */
  group: string;
  personId: string;
  meetingId: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Where the meeting was held or recorded, so one source does not fill the queue. */
  channel: string;
  /** Another speaker talks over this line. */
  overlapped: boolean;
  /** The voice check disagrees with the label. */
  voiceDoubt: boolean;
  /** The best competing candidate score, 0 to 1. */
  rival: number;
  /** What the labelling is sure of, 0 to 1, null when unknown. */
  confidence: number | null;
  /** The speaker review proposes this person for a line labelled as someone else. */
  suggested?: boolean;
}

/**
 * Why a line is asked about. A line in doubt (the labelling is unsure, the voice check or a
 * close rival disagrees, or it was suggested) is asked whatever the profile looks like. A sure
 * line is only a training need: it is worth confirming while the profile is under the target.
 */
export type Why = 'doubt' | 'training';

export const whyOf = (
  c: Pick<Candidate, 'voiceDoubt' | 'rival' | 'confidence' | 'suggested'>,
): Why =>
  c.voiceDoubt ||
  c.suggested === true ||
  c.rival >= DOUBT_RIVAL_SCORE ||
  (c.confidence ?? 0) < DOUBT_CONFIDENCE
    ? 'doubt'
    : 'training';

/** Whether the line can teach a profile anything at all. */
export const isUsable = (c: Candidate) =>
  c.endMs - c.startMs >= MIN_LINE_MS && !c.overlapped && !isFiller(c.text);

export interface Selection {
  /** In the order they should be asked, most useful first. */
  picked: Candidate[];
  /** Profiles that reached the target and had lines left out because of it. */
  complete: Set<string>;
}

function score(c: Candidate, have: number, taken: readonly Candidate[]): number {
  const need = Math.max(0, 1 - have / TARGET_MS);
  const length = c.endMs - c.startMs;
  let value =
    whyOf(c) === 'doubt'
      ? 100 + c.rival * 30 + (c.voiceDoubt ? 20 : 0) + (1 - (c.confidence ?? 0)) * 10
      : need * 80;
  if (length > PREFERRED_MAX_MS) value -= Math.min(15, (length - PREFERRED_MAX_MS) / 2000);
  else value += 5;
  for (const other of taken) {
    if (other.meetingId === c.meetingId) {
      value -= 12;
      if (Math.abs(other.startMs - c.startMs) < NEAR_MS) value -= 25;
    }
    if (other.channel === c.channel) value -= 1;
  }
  return value;
}

/**
 * Picks the useful lines: usable ones only, ranked by how much the profile still needs, how
 * unsure the line is and how different it is from what is already picked. A profile whose
 * verified speech plus the picked speech reaches the target gets no more training lines, only
 * lines in doubt. `coverage` is verified milliseconds per group.
 */
export function selectUseful(
  candidates: readonly Candidate[],
  coverage: ReadonlyMap<string, number>,
  limit = Infinity,
): Selection {
  const left = candidates.filter(isUsable);
  const taken = new Map<string, Candidate[]>();
  const have = new Map<string, number>();
  const picked: Candidate[] = [];
  const complete = new Set<string>();
  const covered = (group: string) => (coverage.get(group) ?? 0) + (have.get(group) ?? 0);
  while (left.length > 0 && picked.length < limit) {
    let best = -1;
    let bestScore = -Infinity;
    for (const [i, c] of left.entries()) {
      if (covered(c.group) >= TARGET_MS && whyOf(c) === 'training') continue;
      const value = score(c, covered(c.group), taken.get(c.group) ?? []);
      if (value > bestScore || (value === bestScore && c.id < (left[best]?.id ?? ''))) {
        best = i;
        bestScore = value;
      }
    }
    const [chosen] = best < 0 ? [] : left.splice(best, 1);
    if (!chosen) break;
    picked.push(chosen);
    taken.set(chosen.group, [...(taken.get(chosen.group) ?? []), chosen]);
    have.set(chosen.group, (have.get(chosen.group) ?? 0) + chosen.endMs - chosen.startMs);
  }
  for (const c of left) {
    if (covered(c.group) >= TARGET_MS && whyOf(c) === 'training') complete.add(c.group);
  }
  return { picked, complete };
}
