import {
  answersOwnQuestion,
  endsWithQuestion,
  followsClosely,
  sameSpeaker,
  type TurnLine,
} from './turn-patterns.js';

/** Suspect lines never count as more certain than this. */
export const SUSPECT_CONFIDENCE_CAP = 0.5;

/** A reply this short that carries the speaker of the line before it is probably someone else. */
const SHORT_REPLY_MS = 2000;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function addressesOwnName(line: TurnLine): boolean {
  const first = line.name?.trim().split(/\s+/)[0];
  if (!first || first.length < 2 || /^speaker \d+$/i.test(line.name ?? '')) return false;
  const name = escape(first);
  return new RegExp(`(?:^|,\\s*)${name}[\\s,.!?]*$|^${name}\\s*,`, 'iu').test(line.text.trim());
}

function repliesShortlyToOwnStatement(previous: TurnLine | undefined, line: TurnLine): boolean {
  return (
    previous !== undefined &&
    sameSpeaker(previous, line) &&
    followsClosely(previous, line) &&
    !endsWithQuestion(previous.text) &&
    line.endMs - line.startMs <= SHORT_REPLY_MS
  );
}

/**
 * Indexes of lines whose speaker looks wrong from the turn-taking alone: an answer that carries
 * the speaker of the question, a speaker addressing their own name ("Thanks, Anna" said by
 * Anna), and a short reply that carries the speaker of the statement before it.
 */
export function findSuspects(lines: readonly TurnLine[]): Set<number> {
  const suspects = new Set<number>();
  lines.forEach((line, i) => {
    if (line.speaker === null) return;
    const previous = lines[i - 1];
    if (
      answersOwnQuestion(previous, line) ||
      addressesOwnName(line) ||
      repliesShortlyToOwnStatement(previous, line)
    ) {
      suspects.add(i);
    }
  });
  return suspects;
}
