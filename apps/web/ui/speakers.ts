import type { SegmentDto } from '../src/dto.js';

export const SPEAKER_COLORS = 8;

/**
 * A colour slot per speaker, by first appearance. People heard through the same shared tile
 * (`viaSpeaker`) never share a slot, so Voice 1 and Voice 2 of one tile stay apart even when the
 * palette has wrapped around.
 */
export function speakerSlots(
  segments: readonly { speaker: string | null; viaSpeaker?: string | null }[],
): Map<string, number> {
  const slots = new Map<string, number>();
  const byTile = new Map<string, Set<number>>();
  for (const { speaker, viaSpeaker } of segments) {
    if (speaker === null || slots.has(speaker)) continue;
    let slot = slots.size % SPEAKER_COLORS;
    const taken = viaSpeaker ? byTile.get(viaSpeaker) : undefined;
    if (taken && taken.size < SPEAKER_COLORS) {
      while (taken.has(slot)) slot = (slot + 1) % SPEAKER_COLORS;
    }
    slots.set(speaker, slot);
    if (viaSpeaker) byTile.set(viaSpeaker, (taken ?? new Set()).add(slot));
  }
  return slots;
}

/** A tile row under this share of the talk is left out. */
export const UNASSIGNED_MIN_SHARE = 0.02;

export interface TalkRow {
  /** Unique within the list. */
  key: string;
  name: string;
  /** Colour slot, as in the transcript legend and the People card; null for the muted row. */
  slot: number | null;
  unassigned: boolean;
  ms: number;
  /** Whole percent; the rows add up to 100. */
  percent: number;
  share: number;
}

/** Whole percents that add up to 100 (largest remainder). */
function percents(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const result = exact.map(Math.floor);
  let left = 100 - result.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => [e - Math.floor(e), i] as const)
    .toSorted((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
  }
  return result;
}

/**
 * Talk time per person, once each. A person with a seat and a voice is one row when both are the
 * same person (same linked person or same participant), never by name. A shared tile is not a
 * speaker next to its own voices: what only the tile has (overlap, short lines, unassigned) is one
 * muted row, left out when it is small. A tile without voices stays a normal row. The most talk
 * comes first.
 */
export function talkTime(segments: readonly SegmentDto[]): TalkRow[] {
  const slots = speakerSlots(segments);
  const tiles = new Set(segments.flatMap((s) => (s.viaSpeaker ? [s.viaSpeaker] : [])));
  const people = new Map<string, { name: string; ms: number }>();
  const unassigned = new Map<string, number>();
  for (const segment of segments) {
    const { speaker, startMs, endMs } = segment;
    if (speaker === null) continue;
    const ms = endMs - startMs;
    if (tiles.has(speaker) && !segment.viaSpeaker) {
      unassigned.set(speaker, (unassigned.get(speaker) ?? 0) + ms);
      continue;
    }
    const key = segment.speakerPersonId
      ? `person:${segment.speakerPersonId}`
      : segment.speakerId
        ? `id:${segment.speakerId}`
        : `name:${speaker}`;
    const entry = people.get(key) ?? { name: speaker, ms: 0 };
    entry.ms += ms;
    people.set(key, entry);
  }
  const total =
    [...people.values()].reduce((sum, row) => sum + row.ms, 0) +
    [...unassigned.values()].reduce((sum, ms) => sum + ms, 0);
  const rows: Omit<TalkRow, 'percent' | 'share'>[] = [
    ...[...people].map(([key, { name, ms }]) => ({
      key,
      name,
      slot: slots.get(name) ?? null,
      unassigned: false,
      ms,
    })),
    ...[...unassigned]
      .filter(([, ms]) => total > 0 && ms / total >= UNASSIGNED_MIN_SHARE)
      .map(([tile, ms]) => ({
        key: `unassigned:${tile}`,
        name: `Unassigned (${tile})`,
        slot: null,
        unassigned: true,
        ms,
      })),
  ];
  rows.sort((a, b) => b.ms - a.ms);
  const shown = rows.reduce((sum, row) => sum + row.ms, 0) || 1;
  const whole = percents(rows.map((row) => row.ms));
  return rows.map((row, i) => ({ ...row, percent: whole[i] ?? 0, share: row.ms / shown }));
}

/** How many people have lines, once each; a shared tile counts through its voices. */
export const countSpeakers = (segments: readonly SegmentDto[]): number =>
  talkTime(segments).filter((row) => !row.unassigned).length;

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** "9 speakers, requested 2": `requested` is the number fixed for a re-run, when there was one. */
export function speakerCountLabel(
  count: number,
  requested: number | null,
  noun: 'speakers' | 'people',
): string {
  const word =
    noun === 'speakers' ? plural(count, 'speaker', 'speakers') : plural(count, 'person', 'people');
  return `${String(count)} ${word}${requested === null ? '' : `, requested ${String(requested)}`}`;
}

export const speakerResultLine = (now: number, was: number): string =>
  `Found ${String(now)} ${plural(now, 'speaker', 'speakers')} (was ${String(was)})`;
