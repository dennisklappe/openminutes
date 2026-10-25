import { describe, expect, it } from 'vitest';
import { guessSpeakers } from './speaker-guess.js';
import { findSuspects } from './speaker-suspects.js';
import type { TurnLine } from './turn-patterns.js';

const line = (
  startMs: number,
  endMs: number,
  text: string,
  speaker: string | null,
  name: string | null = speaker,
): TurnLine => ({ startMs, endMs, text, speaker, name });

describe('findSuspects', () => {
  it('flags an answer opener right after a question with the same speaker', () => {
    const lines = [
      line(0, 3000, 'Heb je het getest?', 'a'),
      line(3400, 6000, 'Ja, dat werkt.', 'a'),
    ];
    expect([...findSuspects(lines)]).toEqual([1]);
  });

  it.each([
    'Yes, it works.',
    'Well, maybe.',
    'Nein, noch nicht.',
    'Oké, goed.',
    'Nou, eigenlijk niet.',
  ])('knows %s as an answer opener', (answer) => {
    const lines = [line(0, 3000, 'Is it done?', 'a'), line(3200, 8000, answer, 'a')];
    expect(findSuspects(lines).has(1)).toBe(true);
  });

  it('leaves an answer from another speaker, a slow answer and a statement alone', () => {
    expect(
      findSuspects([line(0, 3000, 'Done?', 'a'), line(3200, 8000, 'Ja, klaar.', 'b')]).size,
    ).toBe(0);
    expect(
      findSuspects([line(0, 3000, 'Done?', 'a'), line(9000, 14_000, 'Ja, klaar.', 'a')]).size,
    ).toBe(0);
    expect(
      findSuspects([
        line(0, 3000, 'Het is klaar.', 'a'),
        line(3200, 9000, 'Jammer genoeg niet.', 'a'),
      ]).size,
    ).toBe(0);
  });

  it('flags a speaker who names themselves', () => {
    const lines = [
      line(0, 4000, 'De demo is klaar.', 'b', 'Bob'),
      line(4200, 6500, 'Thanks, Anna.', 'a', 'Anna'),
    ];
    expect([...findSuspects(lines)]).toEqual([1]);
    expect(
      findSuspects([line(0, 5000, 'I asked Anna yesterday about it.', 'a', 'Anna')]).size,
    ).toBe(0);
  });

  it('flags a short reply that carries the speaker of the statement before it', () => {
    const lines = [
      line(0, 6000, 'De release staat gepland voor vrijdag.', 'a'),
      line(6200, 7800, 'Dat is snel.', 'a'),
    ];
    expect([...findSuspects(lines)]).toEqual([1]);
  });

  it('ignores lines without a speaker', () => {
    expect(findSuspects([line(0, 3000, 'Done?', null), line(3200, 4000, 'Ja.', null)]).size).toBe(
      0,
    );
  });
});

describe('guessSpeakers', () => {
  const scored = (
    text: string,
    speaker: string,
    start: number,
    end: number,
    confidence: number,
  ) => ({
    ...line(start, end, text, speaker),
    speakerConfidence: confidence,
    speakerSource: 'diarization' as const,
  });

  it('gives an uncertain answer to the other speaker of a dialog', () => {
    const lines = [
      scored('Hoe was de dag?', 'b', 0, 3000, 0.9),
      scored('Goed, druk.', 'a', 3100, 5000, 0.9),
      scored('Heb je het getest?', 'a', 5100, 7000, 0.9),
      scored('Ja, het werkt.', 'a', 7200, 9000, 0.4),
    ];
    expect(guessSpeakers(lines, ['a', 'b'])).toEqual(new Map([[3, 'b']]));
  });

  it('uses the most recent other speaker with three speakers and leaves confident lines alone', () => {
    const lines = [
      scored('Hallo allemaal.', 'c', 0, 2000, 0.9),
      scored('Zijn we klaar?', 'b', 2100, 4000, 0.9),
      scored('Ja, bijna.', 'b', 4200, 6000, 0.4),
      scored('Is het getest?', 'a', 6200, 8000, 0.9),
      scored('Ja, zeker.', 'a', 8200, 9500, 0.95),
      scored('Nee.', 'a', 9600, 10_000, 0.95),
    ];
    expect(guessSpeakers(lines, ['a', 'b', 'c'])).toEqual(new Map([[2, 'c']]));
  });

  it('does not touch lines with a user speaker or no obvious pattern', () => {
    const lines = [
      scored('Is het klaar?', 'a', 0, 2000, 0.9),
      { ...scored('Ja.', 'a', 2100, 3000, 0.2), speakerSource: 'user' as const },
      scored('Mooi zo.', 'a', 3100, 4000, 0.2),
      scored('Anderen?', 'b', 4100, 5000, 0.9),
    ];
    expect(guessSpeakers(lines, ['a', 'b']).size).toBe(0);
  });
});
