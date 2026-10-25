import { endsSentence, type TimedWord } from './speaker-types.js';

const PAUSE_SPLIT_MS = 2000;
const SENTENCE_PAUSE_MS = 700;
const SENTENCE_MIN_MS = 6000;
const LONG_SEGMENT_MS = 20_000;

export interface OwnedWord extends TimedWord {
  participantId: string | null;
  hint?: string | null | undefined;
  confidence?: number | undefined;
}

function startsNewSegment(group: readonly OwnedWord[], word: OwnedWord): boolean {
  const first = group[0];
  const last = group.at(-1);
  if (!first || !last) return false;
  if (word.participantId !== last.participantId) return true;
  const gap = word.startMs - last.endMs;
  const length = last.endMs - first.startMs;
  if (gap >= PAUSE_SPLIT_MS) return true;
  if (endsSentence(last) && (gap >= SENTENCE_PAUSE_MS || length >= SENTENCE_MIN_MS)) return true;
  return length >= LONG_SEGMENT_MS && gap >= SENTENCE_PAUSE_MS / 2;
}

/**
 * Cuts a stream of attributed words into segments: at every change of speaker, at long pauses,
 * after a sentence once enough has been said, and at a shorter pause when a segment runs long.
 * Cuts never fall in the middle of a sentence unless the speaker pauses there.
 */
export function groupWords(words: readonly OwnedWord[]): OwnedWord[][] {
  const groups: OwnedWord[][] = [];
  for (const word of words) {
    const group = groups.at(-1);
    if (group && !startsNewSegment(group, word)) group.push(word);
    else groups.push([word]);
  }
  return groups;
}

const ATTACHES = /^[-'\u2019,.;:!?)\]]/;

export function joinWords(words: readonly TimedWord[]): string {
  return words.reduce(
    (text, word) =>
      text === '' ? word.text : text + (ATTACHES.test(word.text) ? '' : ' ') + word.text,
    '',
  );
}
