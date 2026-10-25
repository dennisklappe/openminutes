import type { Timed } from './speaker-types.js';

export interface TurnLine extends Timed {
  text: string;
  /** Whatever identifies the speaker, equal for equal speakers. */
  speaker: string | null;
  name?: string | null | undefined;
}

/** Replies and statements further apart than this are not treated as a quick exchange. */
const MAX_TURN_GAP_MS = 1000;

const ANSWER_OPENER =
  /^\s*["'‘“]?(?:ja|jawel|jazeker|jep|nee|nou|precies|klopt|inderdaad|zeker|ok[eé]?|okay|yes|yeah|yep|no|nope|well|right|sure|exactly|correct|nein|doch|genau|stimmt|klar)(?![\p{L}\p{N}])/iu;

export const endsWithQuestion = (text: string): boolean => /\?["')\]’”]*\s*$/.test(text);

const startsWithAnswer = (text: string): boolean => ANSWER_OPENER.test(text);

export const sameSpeaker = (a: TurnLine, b: TurnLine): boolean =>
  a.speaker !== null && a.speaker === b.speaker;

export const followsClosely = (previous: TurnLine, line: TurnLine): boolean =>
  line.startMs - previous.endMs <= MAX_TURN_GAP_MS;

/**
 * The line looks like an answer to the line before it, yet both carry the same speaker: a
 * question, then within a second a line that opens like an answer.
 */
export const answersOwnQuestion = (previous: TurnLine | undefined, line: TurnLine): boolean =>
  previous !== undefined &&
  sameSpeaker(previous, line) &&
  followsClosely(previous, line) &&
  endsWithQuestion(previous.text) &&
  startsWithAnswer(line.text);
