import { cosineSimilarity } from './voices.js';

/**
 * Meeting-local anchor voices. In a meeting whose labels come from the call's speaking indicator,
 * the cleanest lines of each participant are enough to tell the participants apart inside that
 * meeting, without any saved voice. The vectors live in memory for the length of one check and are
 * never stored. Every number below is a limit, not a measured optimum: real audio has not been
 * used to tune them.
 */

/** An anchor line lasts at least this long, a shorter voice print is too noisy. */
export const ANCHOR_MIN_MS = 3000;
/** ... and its label is at least this sure. */
export const ANCHOR_MIN_CONFIDENCE = 0.9;
/** Another speaker overlapping the line by more than this makes it unclean. */
export const ANCHOR_OVERLAP_SLACK_MS = 300;
/** The indicator must show the labelled speaker for this share of the line. */
export const ANCHOR_MIN_COVERAGE = 0.9;
/** A participant needs this many surviving anchors before they get a meeting voice. */
export const ANCHOR_MIN_LINES = 2;
/** Without saved voices, at least this many participants need a meeting voice to tell them apart. */
export const ANCHOR_MIN_PEOPLE = 2;
/** The most anchors one participant contributes, the longest first. */
export const ANCHOR_MAX_PER_PERSON = 12;
/** An anchor whose median cosine to the participant's other anchors is lower is an outlier. */
export const ANCHOR_MIN_MEDIAN_COSINE = 0.4;
/** After that, an anchor whose cosine to the centroid of the rest is lower is dropped too. */
export const ANCHOR_OUTLIER_COSINE = 0.5;
/** How a saved voice and a meeting voice are mixed when a participant has both. */
export const PROFILE_WEIGHT = 0.6;
export const MEETING_WEIGHT = 0.4;
/** A meeting voice wins a line when it scores at least this and leads the runner-up by the margin. */
export const ANCHOR_WIN_MIN_SCORE = 0.6;
export const ANCHOR_WIN_MARGIN = 0.15;
/** A label that wins this way is raised to this confidence, never to certainty. */
export const ANCHOR_FIRM_CONFIDENCE = 0.85;

export interface AnchorSpan {
  participantId: string;
  startMs: number;
  endMs: number;
}

/** A line as the anchor selection sees it, times on the same clock as the indicator events. */
export interface AnchorCandidate extends AnchorSpan {
  key: number;
  speakerSource: string | null;
  speakerConfidence: number | null;
  /** An AI review or a person changed or doubts the line. */
  touched: boolean;
}

const overlapMs = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

/**
 * The lines that are safe to learn a meeting voice from: long enough, labelled by the indicator
 * with high confidence, not touched by a person or an AI, nobody else active (neither in the
 * indicator nor in another line) and the indicator showing the labelled speaker for nearly the
 * whole line. Per participant the longest ANCHOR_MAX_PER_PERSON are kept.
 */
export function selectAnchors(
  lines: readonly AnchorCandidate[],
  events: readonly AnchorSpan[],
): AnchorCandidate[] {
  const clean = lines.filter((line) => {
    const duration = line.endMs - line.startMs;
    if (duration < ANCHOR_MIN_MS || line.touched) return false;
    if (line.speakerSource !== 'indicator') return false;
    if ((line.speakerConfidence ?? 0) < ANCHOR_MIN_CONFIDENCE) return false;
    const inside = events.filter((event) => overlapMs(event, line) > 0);
    if (
      inside.some(
        (event) =>
          event.participantId !== line.participantId &&
          overlapMs(event, line) > ANCHOR_OVERLAP_SLACK_MS,
      )
    ) {
      return false;
    }
    const own = inside
      .filter((event) => event.participantId === line.participantId)
      .toSorted((a, b) => a.startMs - b.startMs);
    let covered = 0;
    let reach = line.startMs;
    for (const event of own) {
      const from = Math.max(event.startMs, reach, line.startMs);
      const to = Math.min(event.endMs, line.endMs);
      if (to > from) covered += to - from;
      reach = Math.max(reach, to);
    }
    if (covered / duration < ANCHOR_MIN_COVERAGE) return false;
    return !lines.some(
      (other) =>
        other.key !== line.key &&
        other.participantId !== line.participantId &&
        overlapMs(other, line) > ANCHOR_OVERLAP_SLACK_MS,
    );
  });
  const byPerson = new Map<string, AnchorCandidate[]>();
  for (const line of clean) {
    byPerson.set(line.participantId, [...(byPerson.get(line.participantId) ?? []), line]);
  }
  return [...byPerson.values()].flatMap((list) =>
    list
      .toSorted((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
      .slice(0, ANCHOR_MAX_PER_PERSON),
  );
}

export interface AnchorVector {
  key: number;
  vector: readonly number[];
}

const unit = (vector: readonly number[]): number[] => {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return length === 0 ? [...vector] : vector.map((value) => value / length);
};

const add = (a: readonly number[], b: readonly number[], sign = 1): number[] =>
  a.map((value, i) => value + sign * (b[i] ?? 0));

const median = (values: number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/** The sum of the unit vectors, so every anchor counts the same however loud its vector is. */
const sumOf = (members: readonly AnchorVector[]): number[] =>
  members.slice(1).reduce((sum, m) => add(sum, unit(m.vector)), unit(members[0]?.vector ?? []));

/**
 * Drops the anchors that do not sound like the rest of the participant's anchors, so a label that
 * lagged behind the indicator cannot poison the print. First a median rule (an anchor whose
 * median cosine to the others is under ANCHOR_MIN_MEDIAN_COSINE), then a centroid rule (cosine to
 * the centroid of the others under ANCHOR_OUTLIER_COSINE). With only two anchors that disagree
 * there is no telling which is wrong, so both go.
 */
export function dropOutliers(anchors: readonly AnchorVector[]): AnchorVector[] {
  if (anchors.length < ANCHOR_MIN_LINES) return [];
  const first = anchors.filter((a, i) => {
    const others = anchors.filter((_, j) => j !== i);
    return (
      median(others.map((o) => cosineSimilarity(a.vector, o.vector))) >= ANCHOR_MIN_MEDIAN_COSINE
    );
  });
  if (first.length < ANCHOR_MIN_LINES) return [];
  const kept = first.filter((a) => {
    const rest = first.filter((o) => o.key !== a.key);
    return cosineSimilarity(a.vector, sumOf(rest)) >= ANCHOR_OUTLIER_COSINE;
  });
  return kept.length >= ANCHOR_MIN_LINES ? kept : [];
}

/** The temporary voice of one participant in one meeting. */
export interface MeetingVoice {
  participantId: string;
  members: AnchorVector[];
  sum: number[];
}

/**
 * One meeting voice per participant with enough anchors left after dropping outliers. Nothing
 * here is saved: it stays in memory for one check.
 */
export function buildMeetingVoices(
  anchors: readonly (AnchorVector & { participantId: string })[],
): MeetingVoice[] {
  const byPerson = new Map<string, (AnchorVector & { participantId: string })[]>();
  for (const anchor of anchors) {
    byPerson.set(anchor.participantId, [...(byPerson.get(anchor.participantId) ?? []), anchor]);
  }
  return [...byPerson].flatMap(([participantId, list]) => {
    const members = dropOutliers(list);
    return members.length === 0 ? [] : [{ participantId, members, sum: sumOf(members) }];
  });
}

/**
 * How well a voice fits a meeting voice. A line that is one of the anchors of that voice is
 * compared with the others, so it does not vouch for itself. Undefined: no one left to compare.
 */
export function meetingScore(
  embedding: readonly number[],
  voice: MeetingVoice,
  selfKey?: number,
): number | undefined {
  const self = voice.members.find((m) => m.key === selfKey);
  if (!self) return Math.max(0, cosineSimilarity(embedding, voice.sum));
  if (voice.members.length <= 1) return undefined;
  return Math.max(0, cosineSimilarity(embedding, add(voice.sum, unit(self.vector), -1)));
}

/** A saved voice and a meeting voice of one person, mixed by the named weights. */
export function combineScores(
  profile: number | undefined,
  meeting: number | undefined,
): number | undefined {
  if (profile === undefined) return meeting;
  if (meeting === undefined) return profile;
  return PROFILE_WEIGHT * profile + MEETING_WEIGHT * meeting;
}

/** The participant who leads the others clearly, by score and by margin to the runner-up. */
export function clearWinner(
  scores: ReadonlyMap<string, number>,
): { participantId: string; margin: number } | undefined {
  const ranked = [...scores].toSorted((a, b) => b[1] - a[1]);
  const [top, next] = ranked;
  if (!top || top[1] < ANCHOR_WIN_MIN_SCORE) return undefined;
  const margin = top[1] - (next?.[1] ?? 0);
  return margin >= ANCHOR_WIN_MARGIN ? { participantId: top[0], margin } : undefined;
}
