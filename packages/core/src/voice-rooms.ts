import { cosineSimilarity } from './voices.js';

/**
 * Several people in front of one screen share one participant tile, so the speaking indicator
 * cannot tell them apart. The clean lines of one tile are clustered by voice: two or more
 * distinct clusters, each with enough lines and speech, mean the tile is probably several
 * people. Nothing is relabelled by this. A person names a cluster, or says it is one person.
 * Every number is a starting value that has not been tuned on real audio.
 */

/** Two clusters join while their average cosine similarity is at least this. */
export const ROOM_LINK_SIMILARITY = 0.45;
/** A cluster counts as a voice only with this many clean lines and this much speech. */
export const ROOM_MIN_CLUSTER_LINES = 3;
export const ROOM_MIN_CLUSTER_MS = 12_000;
/** Clean lines of one tile that are clustered, the longest first. */
export const ROOM_MAX_LINES = 60;
/** A tile needs at least this many clean lines before it is worth looking at. */
export const ROOM_MIN_LINES = 2 * ROOM_MIN_CLUSTER_LINES;
/** The most voices kept for one tile. */
export const ROOM_MAX_VOICES = 4;
/** A cluster this similar to another participant's meeting voice is that participant, not a second person. */
export const ROOM_OTHER_TILE_SIMILARITY = 0.7;
/** A line joins a voice when it scores this much and leads the second voice by the margin. */
export const ROOM_ASSIGN_MIN_SCORE = 0.5;
export const ROOM_ASSIGN_MARGIN = 0.1;
/** Lines shorter than this are never assigned to a voice, a print of a few words says too little. */
export const ROOM_ASSIGN_MIN_MS = 1500;

export interface RoomLine {
  key: number;
  embedding: readonly number[];
  durationMs: number;
}

export interface RoomVoiceFound {
  /** Keys of the lines that formed the voice. */
  keys: number[];
  /** The direction of the voice, length one. */
  centroid: number[];
  durationMs: number;
}

const unit = (vector: readonly number[]): number[] => {
  const length = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return length === 0 ? [...vector] : vector.map((value) => value / length);
};

interface Group {
  members: RoomLine[];
  sum: number[];
}

/** The mean cosine similarity between all pairs across two groups (average linkage). */
function linkage(a: Group, b: Group): number {
  let total = 0;
  for (const x of a.members) {
    for (const y of b.members) total += cosineSimilarity(x.embedding, y.embedding);
  }
  return total / (a.members.length * b.members.length);
}

/** The clean lines of one tile that are clustered: the longest first, at most ROOM_MAX_LINES. */
const usableLines = (lines: readonly RoomLine[]) =>
  lines
    .filter((line) => line.embedding.length > 0)
    .toSorted((a, b) => b.durationMs - a.durationMs)
    .slice(0, ROOM_MAX_LINES);

/**
 * Average linkage clustering. Joins the two closest groups while `keepGoing` says so, given the
 * best similarity and the number of groups.
 */
function cluster(
  usable: readonly RoomLine[],
  keepGoing: (best: number, groups: number) => boolean,
): Group[] {
  let groups: Group[] = usable.map((line) => ({ members: [line], sum: unit(line.embedding) }));
  while (groups.length > 1) {
    let best = -Infinity;
    let pair: [number, number] | undefined;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const score = linkage(groups[i] as Group, groups[j] as Group);
        if (score > best) {
          best = score;
          pair = [i, j];
        }
      }
    }
    if (!pair || !keepGoing(best, groups.length)) break;
    const [i, j] = pair;
    const a = groups[i] as Group;
    const b = groups[j] as Group;
    const merged: Group = {
      members: [...a.members, ...b.members],
      sum: a.sum.map((value, k) => value + (b.sum[k] ?? 0)),
    };
    groups = [...groups.filter((_, k) => k !== i && k !== j), merged];
  }
  return groups;
}

const toVoice = (group: Group): RoomVoiceFound => ({
  keys: group.members.map((m) => m.key),
  centroid: unit(group.sum),
  durationMs: group.members.reduce((sum, m) => sum + m.durationMs, 0),
});

/**
 * Clusters the clean lines of one tile by voice (agglomerative, average linkage, stopping at
 * ROOM_LINK_SIMILARITY) and keeps the clusters that are big enough to be a person, the one with
 * the most speech first. `others` are the meeting voices of the other participants: a cluster
 * that sounds like one of them is that participant leaking into the tile, not a new person.
 * Fewer than two voices left means the tile is not flagged: an empty list.
 */
export function findRoomVoices(
  lines: readonly RoomLine[],
  others: readonly (readonly number[])[] = [],
): RoomVoiceFound[] {
  const usable = usableLines(lines);
  if (usable.length < ROOM_MIN_LINES) return [];
  const voices = cluster(usable, (best) => best >= ROOM_LINK_SIMILARITY)
    .map(toVoice)
    .filter(
      (voice) =>
        voice.keys.length >= ROOM_MIN_CLUSTER_LINES &&
        voice.durationMs >= ROOM_MIN_CLUSTER_MS &&
        !others.some((o) => cosineSimilarity(voice.centroid, o) >= ROOM_OTHER_TILE_SIMILARITY),
    )
    .toSorted((a, b) => b.durationMs - a.durationMs)
    .slice(0, ROOM_MAX_VOICES);
  return voices.length >= 2 ? voices : [];
}

/** A voice of a tile whose number of people is known needs at least this many lines. */
export const ROOM_FIXED_MIN_LINES = 2;

/**
 * Clusters the clean lines of one tile into exactly `count` voices, the one with the most speech
 * first, for when the owner knows how many people sit there. There is no similarity bar: the
 * closest groups join until `count` are left. Empty when `count` is under two or over
 * ROOM_MAX_VOICES, there are too few lines, or a voice would have fewer than ROOM_FIXED_MIN_LINES
 * lines, because then the lines do not split into that many voices.
 */
export function findRoomVoicesFixed(lines: readonly RoomLine[], count: number): RoomVoiceFound[] {
  if (!Number.isInteger(count) || count < 2 || count > ROOM_MAX_VOICES) return [];
  const usable = usableLines(lines);
  if (usable.length < count * ROOM_FIXED_MIN_LINES) return [];
  const voices = cluster(usable, (_, groups) => groups > count)
    .map(toVoice)
    .toSorted((a, b) => b.durationMs - a.durationMs);
  return voices.length === count && voices.every((v) => v.keys.length >= ROOM_FIXED_MIN_LINES)
    ? voices
    : [];
}

/**
 * The voice a line belongs to, by the nearest centroid: it must score ROOM_ASSIGN_MIN_SCORE and
 * lead the second voice by ROOM_ASSIGN_MARGIN, else the line stays unassigned. Undefined too for
 * a line shorter than ROOM_ASSIGN_MIN_MS.
 */
export function assignToRoomVoice(
  embedding: readonly number[],
  durationMs: number,
  centroids: readonly (readonly number[])[],
): number | undefined {
  if (durationMs < ROOM_ASSIGN_MIN_MS || centroids.length === 0) return undefined;
  const ranked = centroids
    .map((centroid, index) => ({ index, score: cosineSimilarity(embedding, centroid) }))
    .toSorted((a, b) => b.score - a.score);
  const [top, next] = ranked;
  if (!top || top.score < ROOM_ASSIGN_MIN_SCORE) return undefined;
  return top.score - (next?.score ?? 0) >= ROOM_ASSIGN_MARGIN ? top.index : undefined;
}

/** A voice of a shared account is the same person as one heard before at this similarity. */
export const ROOM_MATCH_SIMILARITY = 0.6;

/**
 * The voice number each found voice takes, so the same person keeps the same number in the next
 * meeting and after processing again, whatever order the clusters came in. A found voice joins
 * the known voice it sounds most like (at least ROOM_MATCH_SIMILARITY, each known voice once).
 * What is left takes a number that has no voice print yet, else a number nobody used before.
 */
export function matchVoiceNumbers(
  found: readonly (readonly number[])[],
  known: readonly { number: number; centroid: readonly number[] | null }[],
): number[] {
  const pairs = found.flatMap((voice, index) =>
    known.flatMap((k) =>
      k.centroid && k.centroid.length === voice.length
        ? [{ index, number: k.number, score: cosineSimilarity(voice, k.centroid) }]
        : [],
    ),
  );
  const result: (number | undefined)[] = found.map(() => undefined);
  const taken = new Set<number>();
  for (const pair of pairs.toSorted((a, b) => b.score - a.score)) {
    if (pair.score < ROOM_MATCH_SIMILARITY) break;
    if (result[pair.index] !== undefined || taken.has(pair.number)) continue;
    result[pair.index] = pair.number;
    taken.add(pair.number);
  }
  const blank = known
    .filter((k) => k.centroid === null && !taken.has(k.number))
    .map((k) => k.number)
    .toSorted((a, b) => a - b);
  let next = Math.max(0, ...known.map((k) => k.number)) + 1;
  return result.map((value) => {
    if (value !== undefined) return value;
    const free = blank.shift();
    if (free !== undefined) return free;
    return next++;
  });
}
