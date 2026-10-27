import { snapHandovers } from './speaker-handover.js';
import { estimateLag, removeLag } from './speaker-lag.js';
import { cohereSentences } from './speaker-sentences.js';
import { groupWords, joinWords, type OwnedWord } from './speaker-segments.js';
import { overlap, type SpeakerSpan, type Timed, type TimedWord } from './speaker-types.js';
import { splitAtChanges } from './speaker-split.js';
import { assignWords } from './speaker-words.js';

export type { SpeakerSpan, TimedWord } from './speaker-types.js';

export interface Attributable extends Timed {
  speaker?: string | undefined;
  text?: string;
  words?: readonly TimedWord[] | undefined;
  confidence?: number | undefined;
}

export type Attributed<T> = T & { participantId: string | null };

function overlapByParticipant(item: Timed, spans: readonly SpeakerSpan[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const span of spans) {
    if (span.startMs >= item.endMs) break;
    const shared = overlap(item, span);
    if (shared > 0) totals.set(span.participantId, (totals.get(span.participantId) ?? 0) + shared);
  }
  return totals;
}

function strongest(totals: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let most = 0;
  for (const [participantId, total] of totals) {
    if (total > most) [best, most] = [participantId, total];
  }
  return best;
}

function mapDiarizationLabels(
  items: readonly Attributable[],
  spans: readonly SpeakerSpan[],
): Map<string, string> {
  const perLabel = new Map<string, Map<string, number>>();
  for (const item of items) {
    if (item.speaker === undefined) continue;
    const totals = perLabel.get(item.speaker) ?? new Map<string, number>();
    for (const [participantId, total] of overlapByParticipant(item, spans)) {
      totals.set(participantId, (totals.get(participantId) ?? 0) + total);
    }
    perLabel.set(item.speaker, totals);
  }
  const labels = new Map<string, string>();
  for (const [label, totals] of perLabel) {
    const participantId = strongest(totals);
    if (participantId) labels.set(label, participantId);
  }
  return labels;
}

const hasWords = (item: Attributable) => !!item.words?.length;

function wordStream(
  items: readonly Attributable[],
  spans: readonly SpeakerSpan[],
  labels: ReadonlyMap<string, string>,
): { words: OwnedWord[] } {
  const words = items.flatMap((item) =>
    (item.words ?? []).map((word) => ({
      ...word,
      confidence: item.confidence,
      hint: item.speaker === undefined ? null : (labels.get(item.speaker) ?? null),
    })),
  );
  const lag = estimateLag(spans, words);
  const adjusted = snapHandovers(spans, removeLag(spans, lag), words, lag);
  const owners = assignWords(
    words,
    adjusted,
    words.map((word) => word.hint),
  );
  const owned = words.map((word, i) => ({ ...word, participantId: owners[i] ?? null }));
  return { words: cohereSentences(owned, adjusted) };
}

function attributeWords<T extends Attributable>(
  run: readonly T[],
  spans: readonly SpeakerSpan[],
  labels: ReadonlyMap<string, string>,
): Attributed<T>[] {
  const template = run[0];
  if (!template) return [];
  return groupWords(wordStream(run, spans, labels).words).map((group) => {
    const confidences = group.flatMap((word) => word.confidence ?? []);
    return {
      ...template,
      startMs: group[0]?.startMs ?? template.startMs,
      endMs: group.at(-1)?.endMs ?? template.endMs,
      text: joinWords(group),
      words: group.map(({ startMs, endMs, text }) => ({ startMs, endMs, text })),
      participantId: group[0]?.participantId ?? null,
      ...(confidences.length === 0
        ? {}
        : { confidence: confidences.reduce((a, b) => a + b, 0) / confidences.length }),
    };
  });
}

function attributeByOverlap<T extends Attributable>(
  item: T,
  spans: readonly SpeakerSpan[],
  labels: ReadonlyMap<string, string>,
): Attributed<T> {
  const fromDom = strongest(overlapByParticipant(item, spans));
  const fromLabel = item.speaker === undefined ? null : (labels.get(item.speaker) ?? null);
  return { ...item, participantId: fromDom ?? fromLabel };
}

/**
 * Gives each transcript item the participant who was speaking.
 *
 * Items with word times are treated as one stream of words: each word goes to a speaker using
 * the platform's active-speaker events, corrected for how late the indicator lights up and
 * clears and smoothed so flicker and one-word glitches do not split turns, and the words are
 * cut into new segments at speaker changes, pauses and sentence ends. Items without word times
 * go to the speaker whose events overlap them most, unless one speaker alone is lit in two
 * stretches of it (see `splitAtChanges`), and items with a diarization label fall back
 * to that label, mapped to a participant by how much that label's items overlap each
 * participant's events, where the events do not cover them.
 */
export function assignSpeakers<T extends Attributable>(
  items: readonly T[],
  events: readonly SpeakerSpan[],
): Attributed<T>[] {
  const spans = events.toSorted((a, b) => a.startMs - b.startMs);
  const labels = mapDiarizationLabels(items, spans);
  const result: Attributed<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    result.push(...attributeWords(run, spans, labels));
    run = [];
  };
  for (const item of items) {
    if (hasWords(item)) {
      run.push(item);
    } else {
      flush();
      const parts =
        item.text === undefined ? undefined : splitAtChanges({ ...item, text: item.text }, spans);
      if (parts) result.push(...parts.map((part) => ({ ...item, ...part })));
      else result.push(attributeByOverlap(item, spans, labels));
    }
  }
  flush();
  return result;
}
