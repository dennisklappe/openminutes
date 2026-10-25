import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignSpeakers, type SpeakerSpan, type TimedWord } from './speakers.js';

interface Fixture {
  segments: { startMs: number; endMs: number; text: string; words: TimedWord[] }[];
  events: SpeakerSpan[];
  truth: { speaker: string; startMs: number; endMs: number; text: string }[];
}

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')) as Fixture;

describe.each([
  { name: 'teams-five-live', exact: false },
  { name: 'teams-five-live2', exact: true },
])('a recorded Teams meeting with five guests ($name)', ({ name, exact }) => {
  const fixture = load(name);
  const spokenBy = (word: TimedWord) => {
    const middle = (word.startMs + word.endMs) / 2;
    return fixture.truth.find((u) => middle >= u.startMs - 300 && middle <= u.endMs + 300)?.speaker;
  };
  const result = assignSpeakers(fixture.segments, fixture.events);
  const words = result.flatMap((segment) =>
    segment.words.map((word) => ({ word, owner: segment.participantId })),
  );

  it('gives every word to the guest who said it', () => {
    const right = words.filter(({ word, owner }) => spokenBy(word) === owner).length;
    expect(right / words.length).toBeGreaterThanOrEqual(0.95);
  });

  it.runIf(exact)('gives every spoken sentence to one guest', () => {
    const sentenceOf = (word: TimedWord) =>
      fixture.truth.findLastIndex(
        (u) =>
          (word.startMs + word.endMs) / 2 >= u.startMs &&
          (word.startMs + word.endMs) / 2 <= u.endMs,
      );
    fixture.truth.forEach((utterance, index) => {
      const owners = new Set(
        words.filter(({ word }) => sentenceOf(word) === index).map(({ owner }) => owner),
      );
      expect([...owners], utterance.text).toEqual([utterance.speaker]);
    });
  });

  it('keeps one-word replies that the indicator only shows after the word is over', () => {
    for (const reply of fixture.truth.filter((u) => u.text.split(' ').length === 1)) {
      const segment = result.find(
        (s) => s.startMs >= reply.startMs - 300 && s.endMs <= reply.endMs + 300,
      );
      expect(segment?.participantId, reply.text).toBe(reply.speaker);
    }
  });

  it('starts each turn with its first words', () => {
    const start = result.find((s) => s.text.startsWith('I have finished'));
    expect(start?.participantId).toBe('Carol Meyer');
  });
});
