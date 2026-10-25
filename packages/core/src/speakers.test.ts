import { describe, expect, it } from 'vitest';
import { assignSpeakers, type SpeakerSpan } from './speakers.js';

const span = (participantId: string, startMs: number, endMs: number): SpeakerSpan => ({
  participantId,
  startMs,
  endMs,
});
const segment = (startMs: number, endMs: number, speaker?: string) => ({
  startMs,
  endMs,
  text: `${startMs}`,
  speaker,
});
const ids = (result: { participantId: string | null }[]) => result.map((r) => r.participantId);

describe('assignSpeakers', () => {
  it('assigns a segment to the speaker covering it', () => {
    const result = assignSpeakers(
      [segment(0, 2000), segment(2000, 4000)],
      [span('alice', 0, 2000), span('bob', 2000, 4000)],
    );
    expect(ids(result)).toEqual(['alice', 'bob']);
  });

  it('picks the dominant speaker when the speaker changes mid-segment', () => {
    const events = [span('alice', 0, 1000), span('bob', 1000, 4000)];
    expect(ids(assignSpeakers([segment(0, 4000)], events))).toEqual(['bob']);
  });

  it('sums several short intervals of the same speaker', () => {
    const events = [span('alice', 0, 900), span('bob', 900, 1500), span('alice', 1500, 2400)];
    expect(ids(assignSpeakers([segment(0, 3000)], events))).toEqual(['alice']);
  });

  it('handles overlapping speakers by total overlap', () => {
    const events = [span('alice', 0, 3000), span('bob', 2000, 3000)];
    expect(ids(assignSpeakers([segment(0, 3000)], events))).toEqual(['alice']);
  });

  it('returns null in a gap with no events and without a label', () => {
    expect(ids(assignSpeakers([segment(5000, 6000)], [span('alice', 0, 1000)]))).toEqual([null]);
  });

  it('does not count segments that merely touch an interval', () => {
    expect(ids(assignSpeakers([segment(1000, 2000)], [span('alice', 0, 1000)]))).toEqual([null]);
  });

  it('does not depend on the order of the events', () => {
    const events = [span('bob', 2000, 4000), span('alice', 0, 2000)];
    expect(ids(assignSpeakers([segment(0, 1500), segment(2500, 3500)], events))).toEqual([
      'alice',
      'bob',
    ]);
  });

  it('maps diarization labels to participants by overlap and uses them in gaps', () => {
    const items = [
      segment(0, 2000, 'A'),
      segment(2000, 4000, 'B'),
      segment(4000, 6000, 'A'),
      segment(6000, 8000, 'B'),
    ];
    const events = [span('alice', 0, 2000), span('bob', 2000, 4000)];
    expect(ids(assignSpeakers(items, events))).toEqual(['alice', 'bob', 'alice', 'bob']);
  });

  it('prefers the DOM over the diarization label', () => {
    const result = assignSpeakers([segment(0, 1000, 'A')], [span('bob', 0, 1000)]);
    expect(ids(result)).toEqual(['bob']);
  });

  it('leaves labels unmapped when no event ever overlaps them', () => {
    expect(ids(assignSpeakers([segment(0, 1000, 'A')], []))).toEqual([null]);
  });

  it('keeps the other fields of each item', () => {
    const [result] = assignSpeakers([segment(0, 1000)], [span('alice', 0, 1000)]);
    expect(result).toMatchObject({ text: '0', participantId: 'alice' });
  });

  describe('word times', () => {
    const word = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });
    const spanning = {
      startMs: 0,
      endMs: 9000,
      text: 'Okay so that is it. Great. Then I will prepare the notes.',
      words: [
        word('Okay', 0, 400),
        word('so', 400, 700),
        word('that', 700, 1000),
        word('is', 1000, 1200),
        word('it.', 1200, 1500),
        word('Great.', 4000, 4500),
        word('Then', 4500, 4800),
        word('I', 4800, 4900),
        word('will', 4900, 5200),
        word('prepare', 5200, 5800),
        word('the', 5800, 6000),
        word('notes.', 6000, 6500),
      ],
    };
    const turns = [span('bob', 0, 1500), span('alice', 4000, 6500)];

    it('splits a segment spanning two speakers at the turn boundary', () => {
      const result = assignSpeakers([spanning], turns);
      expect(result.map((r) => [r.participantId, r.text, r.startMs, r.endMs])).toEqual([
        ['bob', 'Okay so that is it.', 0, 1500],
        ['alice', 'Great. Then I will prepare the notes.', 4000, 6500],
      ]);
    });

    it('lets words in a gap follow the preceding speaker', () => {
      const result = assignSpeakers(
        [
          {
            startMs: 0,
            endMs: 3000,
            text: 'a b c d',
            words: [
              word('a', 0, 500),
              word('b', 500, 1000),
              word('c', 1500, 2000),
              word('d', 2500, 3000),
            ],
          },
        ],
        [span('bob', 0, 1000), span('alice', 2400, 3000)],
      );
      expect(result.map((r) => [r.participantId, r.text])).toEqual([
        ['bob', 'a b c'],
        ['alice', 'd'],
      ]);
    });

    it('keeps the words of one speaker together across a short pause', () => {
      const result = assignSpeakers([spanning], [span('alice', 0, 9000)]);
      expect(result.map((r) => r.participantId)).toEqual(['alice', 'alice']);
      expect(result.map((r) => r.text).join(' ')).toBe(spanning.text);
    });

    it('falls back to segment overlap when there are no words', () => {
      const plain = { startMs: spanning.startMs, endMs: spanning.endMs, text: spanning.text };
      expect(ids(assignSpeakers([plain], turns))).toEqual(['alice']);
    });

    it('falls back to the diarization label when no word is covered', () => {
      const result = assignSpeakers(
        [{ ...spanning, speaker: 'A' }, segment(9000, 10000, 'A')],
        [span('alice', 9000, 10000)],
      );
      expect(ids(result)).toEqual(['alice', 'alice', 'alice']);
    });
  });

  describe('word streams', () => {
    const word = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });
    const say = (text: string, startMs: number, wordMs = 300) =>
      text.split(' ').map((w, i) => word(w, startMs + i * wordMs, startMs + (i + 1) * wordMs));
    const segmentOf = (words: ReturnType<typeof say>) => ({
      startMs: words[0]?.startMs ?? 0,
      endMs: words.at(-1)?.endMs ?? 0,
      text: words.map((w) => w.text).join(' '),
      words,
    });
    const view = (result: ReturnType<typeof assignSpeakers<ReturnType<typeof segmentOf>>>) =>
      result.map((r) => [r.participantId, r.text]);

    it('removes the lag of an indicator that lights late and stays lit', () => {
      const alice = say('Hello everyone welcome to the meeting.', 1000);
      const bob = say('Thanks Alice. Good to be here.', 5000);
      const carol = say('Same here.', 9000);
      const turns = [
        span('alice', 1600, 5600),
        span('bob', 5600, 9200),
        span('carol', 9600, 11800),
      ];
      const result = assignSpeakers([segmentOf([...alice, ...bob, ...carol])], turns);
      expect(view(result)).toEqual([
        ['alice', 'Hello everyone welcome to the meeting.'],
        ['bob', 'Thanks Alice. Good to be here.'],
        ['carol', 'Same here.'],
      ]);
    });

    it('merges whisper segments that cut a sentence in the middle', () => {
      const words = say('we should ship the release on Thursday and write the notes tomorrow.', 0);
      const result = assignSpeakers(
        [segmentOf(words.slice(0, 6)), segmentOf(words.slice(6))],
        [span('alice', 0, 5000)],
      );
      expect(view(result)).toEqual([
        ['alice', 'we should ship the release on Thursday and write the notes tomorrow.'],
      ]);
    });

    it('ignores indicator flicker inside a turn', () => {
      const words = say('this plan has a few steps and we start with the first one today', 0);
      const events = [span('alice', 0, 1500), span('bob', 1500, 1800), span('alice', 1800, 5000)];
      expect(view(assignSpeakers([segmentOf(words)], events))).toEqual([
        ['alice', words.map((w) => w.text).join(' ')],
      ]);
    });

    it('splits at a speaker change only where a new speaker has started', () => {
      const first = say('so that is the plan for next week.', 0);
      const second = say('yes that works for me', 2900);
      const events = [span('alice', 0, 2400), span('bob', 3000, 5000)];
      expect(view(assignSpeakers([segmentOf([...first, ...second])], events))).toEqual([
        ['alice', 'so that is the plan for next week.'],
        ['bob', 'yes that works for me'],
      ]);
    });

    it('keeps a one word interjection from another speaker', () => {
      const talk = [...say('we ship on Thursday', 0), ...say('and then we write the notes.', 2400)];
      const yes = [word('yes', 1700, 2100)];
      const events = [span('alice', 0, 4000), span('bob', 1600, 2200)];
      const words = [...talk.slice(0, 4), ...yes, ...talk.slice(4)];
      expect(view(assignSpeakers([segmentOf(words)], events))).toEqual([
        ['alice', 'we ship on Thursday'],
        ['bob', 'yes'],
        ['alice', 'and then we write the notes.'],
      ]);
    });

    it('splits a long run at pauses when the text has no punctuation', () => {
      const words = [...say('one two three', 0), ...say('four five six', 4000)];
      const result = assignSpeakers([segmentOf(words)], [span('alice', 0, 6000)]);
      expect(view(result)).toEqual([
        ['alice', 'one two three'],
        ['alice', 'four five six'],
      ]);
    });

    it('attaches hyphenated and contracted word pieces without a space', () => {
      const words = [word('the', 0, 300), word('mail', 300, 600), word('-in', 600, 800)];
      expect(view(assignSpeakers([segmentOf(words)], [span('alice', 0, 800)]))).toEqual([
        ['alice', 'the mail-in'],
      ]);
    });

    it('averages the confidence of the merged segments', () => {
      const words = say('a b c d', 0);
      const result = assignSpeakers(
        [
          { ...segmentOf(words.slice(0, 2)), confidence: 0.8 },
          { ...segmentOf(words.slice(2)), confidence: 0.6 },
        ],
        [span('alice', 0, 2000)],
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.confidence).toBeCloseTo(0.7);
    });
  });

  describe('sentence coherence', () => {
    const word = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });
    const say = (text: string, startMs: number, wordMs = 300) =>
      text.split(' ').map((w, i) => word(w, startMs + i * wordMs, startMs + (i + 1) * wordMs));
    const segmentOf = (words: ReturnType<typeof say>, speaker?: string) => ({
      startMs: words[0]?.startMs ?? 0,
      endMs: words.at(-1)?.endMs ?? 0,
      text: words.map((w) => w.text).join(' '),
      words,
      ...(speaker === undefined ? {} : { speaker }),
    });
    const view = (result: { participantId: string | null; text: string }[]) =>
      result.map((r) => [r.participantId, r.text]);

    it('keeps a sentence together when the indicator lights up after its first words', () => {
      const first = say('We shipped the release on Thursday.', 0);
      const second = say('I will write the release notes and update the help center.', 2100);
      const events = [
        span('alice', 600, 3800),
        span('bob', 3600, 9000),
        span('carol', 11000, 13000),
      ];
      const result = assignSpeakers([segmentOf([...first, ...second])], events);
      expect(view(result)).toEqual([
        ['alice', 'We shipped the release on Thursday.'],
        ['bob', 'I will write the release notes and update the help center.'],
      ]);
    });

    it('moves a turn change to the pause when the indicator trails by different amounts', () => {
      const alice = say('Good morning everyone. Today we plan the launch.', 0);
      const bob = say('Thanks Alice. The backend is almost ready.', 4200);
      const carol = say('I have finished the new onboarding screens.', 8300);
      const events = [
        span('alice', 700, 4700),
        span('bob', 5000, 9600),
        span('carol', 9400, 12800),
      ];
      const result = assignSpeakers([segmentOf([...alice, ...bob, ...carol])], events);
      expect(view(result)).toEqual([
        ['alice', 'Good morning everyone. Today we plan the launch.'],
        ['bob', 'Thanks Alice. The backend is almost ready.'],
        ['carol', 'I have finished the new onboarding screens.'],
      ]);
    });

    it('lets a fragment join the sentence it continues', () => {
      const first = say(
        'I can prepare the demo videos for the event if Dave shares the staging',
        0,
      );
      const rest = say('link.', 4300);
      const events = [span('carol', 0, 4800), span('dave', 3700, 6000)];
      const result = assignSpeakers([segmentOf([...first, ...rest])], events);
      expect(view(result)).toEqual([
        ['carol', 'I can prepare the demo videos for the event if Dave shares the staging link.'],
      ]);
    });

    it('splits a sentence where another speaker is alone for a stretch', () => {
      const words = say('we ship on Thursday and then we write the notes tomorrow', 0);
      const events = [span('alice', 0, 1500), span('bob', 1800, 5000)];
      expect(view(assignSpeakers([segmentOf(words)], events))).toEqual([
        ['alice', 'we ship on Thursday and'],
        ['bob', 'then we write the notes tomorrow'],
      ]);
    });

    it('splits at a long pause even without punctuation', () => {
      const words = [...say('so that is the plan', 0), ...say('yes that works for me', 2700)];
      const events = [span('alice', 0, 1500), span('bob', 2700, 4400)];
      expect(view(assignSpeakers([segmentOf(words)], events))).toEqual([
        ['alice', 'so that is the plan'],
        ['bob', 'yes that works for me'],
      ]);
    });

    it('lets a diarizing provider decide where the indicators split evenly', () => {
      const words = say('this one is hard to tell', 0);
      const events = [span('alice', 0, 900), span('bob', 900, 1800), span('bob', 6000, 7000)];
      const other = { startMs: 6000, endMs: 7000, text: 'hello', speaker: 'B' };
      const result = assignSpeakers([segmentOf(words, 'B'), other], events);
      expect(result[0]?.participantId).toBe('bob');
      expect(assignSpeakers([segmentOf(words)], events)[0]?.participantId).toBe('alice');
    });
  });
});
