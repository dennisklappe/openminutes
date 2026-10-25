import { joinWords } from './speaker-segments.js';
import { overlap, type SpeakerSpan, type Timed, type TimedWord } from './speaker-types.js';

export type SilentRange = Timed;

export interface Speech extends Timed {
  text: string;
  words?: TimedWord[] | undefined;
}

const EDGE_MS = 100;

const HALLUCINATIONS = [
  /^(thank you|thanks|thank you very much|thanks for watching|thank you for watching|bye|you)$/,
  /^(please )?(like and )?subscribe( to (my|the) channel)?$/,
  /^(subtitles|captions|translated|transcribed) by\b/,
];

function isHallucination(text: string): boolean {
  const plain = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, '')
    .replace(/\.+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return HALLUCINATIONS.some((pattern) => pattern.test(plain));
}

// Meet and Teams play short tones when people join and leave, which a model hears as "you".
const STRAY_MARGIN_MS = 1500;

const inside = (item: Timed, silences: readonly SilentRange[]) =>
  silences.some(
    (silence) => item.startMs >= silence.startMs + EDGE_MS && item.endMs <= silence.endMs - EDGE_MS,
  );

/**
 * Recordings have stretches that are digitally silent, before the call starts, after everyone
 * left or while the room is muted, and speech models invent text there ("Thank you", a repeated
 * word, a subtitle credit). Words that fall inside a silent stretch are dropped when no speaker
 * indicator was lit for them, and also when the indicator was lit but the words are a phrase
 * models are known to make up. Items that lose all their words are dropped, the others shrink to
 * what is left, so the recording can be trimmed to where people actually spoke.
 */
export function dropSilentSpeech<T extends Speech>(
  items: readonly T[],
  silences: readonly SilentRange[],
  spans: readonly SpeakerSpan[],
): T[] {
  return dropStrayPhrases(dropInSilence(items, silences, spans), spans);
}

/**
 * A known invented phrase that stands alone, far from every speaker indicator, is not speech even
 * when the stretch is not digitally silent (a join tone, room noise). Nothing is dropped when the
 * call has no indicator data at all, because then nobody can say it was not spoken.
 */
function dropStrayPhrases<T extends Speech>(items: T[], spans: readonly SpeakerSpan[]): T[] {
  if (spans.length === 0) return items;
  return items.filter(
    (item) =>
      !isHallucination(item.text) ||
      spans.some(
        (span) =>
          span.startMs - STRAY_MARGIN_MS < item.endMs &&
          span.endMs + STRAY_MARGIN_MS > item.startMs,
      ),
  );
}

function dropInSilence<T extends Speech>(
  items: readonly T[],
  silences: readonly SilentRange[],
  spans: readonly SpeakerSpan[],
): T[] {
  if (silences.length === 0) return [...items];
  return items.flatMap((item): T[] => {
    const invented = isHallucination(item.text);
    const unheard = (part: Timed) =>
      inside(part, silences) && (invented || !spans.some((span) => overlap(part, span) > 0));
    if (!item.words?.length) return unheard(item) ? [] : [item];
    const kept = item.words.filter((word) => !unheard(word));
    if (kept.length === item.words.length) return [item];
    const first = kept[0];
    const last = kept.at(-1);
    if (!first || !last) return [];
    return [
      { ...item, startMs: first.startMs, endMs: last.endMs, text: joinWords(kept), words: kept },
    ];
  });
}
