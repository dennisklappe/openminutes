import { isUncertain } from './speaker-confidence.js';
import { answersOwnQuestion, type TurnLine } from './turn-patterns.js';
import type { SpeakerSource } from '@openminutes/db';

export interface GuessLine extends TurnLine {
  speakerConfidence: number | null;
  speakerSource: SpeakerSource | null;
}

function otherSpeaker(
  lines: readonly GuessLine[],
  index: number,
  everyone: readonly string[],
): string | undefined {
  const own = lines[index]?.speaker;
  if (everyone.length === 2) return everyone.find((speaker) => speaker !== own);
  for (let i = index - 1; i >= 0; i--) {
    const speaker = lines[i]?.speaker;
    if (speaker && speaker !== own) return speaker;
  }
  return undefined;
}

/**
 * The deterministic fallback when no model is available. Only the one obvious pattern is acted
 * on: a question followed within a second by a line that opens like an answer, both with the same
 * speaker, the answer being uncertain. It goes to the other speaker when the meeting has two speakers, else
 * to the most recent different speaker. Returns the new speaker per line index.
 */
export function guessSpeakers(
  lines: readonly GuessLine[],
  everyone: readonly string[],
): Map<number, string> {
  const guesses = new Map<number, string>();
  lines.forEach((line, i) => {
    if (!isUncertain(line) || !answersOwnQuestion(lines[i - 1], line)) return;
    const speaker = otherSpeaker(lines, i, everyone);
    if (speaker) guesses.set(i, speaker);
  });
  return guesses;
}
