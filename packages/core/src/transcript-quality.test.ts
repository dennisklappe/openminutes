import { describe, expect, it } from 'vitest';
import { dropMadeUpLines, looksInvented, suspectWindows } from './transcript-quality.js';

const at = (startMs: number, text: string, lengthMs = 1500) => ({
  startMs,
  endMs: startMs + lengthMs,
  text,
});

describe('looksInvented', () => {
  it('flags a credit repeated through the whole file', () => {
    const lines = ['Subtitles by Jan', 'Jan Jansen', 'Subtitles by Jan.', 'Jan Jansen'];
    const segments = Array.from({ length: 40 }, (_, i) => at(i * 61_000, lines[i % 4] ?? ''));
    expect(looksInvented(segments)).toBe(true);
  });

  it('flags one short line per 30 second window even when every line differs', () => {
    const segments = Array.from({ length: 40 }, (_, i) =>
      at(i * 30_000 + 200, `Name ${String(i)}`),
    );
    expect(looksInvented(segments)).toBe(true);
  });

  it('keeps ordinary conversation, including short answers and long segments', () => {
    const answers = ['Yes.', 'No.', 'Okay.'];
    const segments = Array.from({ length: 60 }, (_, i) =>
      i % 3 === 0
        ? at(i * 7000, answers[(i / 3) % 3] ?? '')
        : at(i * 7000, `We looked at point number ${String(i)} of the plan.`, 6000),
    );
    expect(looksInvented(segments)).toBe(false);
  });

  it('keeps a short window of a few different lines', () => {
    const lines = ['Hello from the meeting.', 'This is the plan.', 'Came from the stub.'];
    const segments = lines.map((text, i) => at(i * 20_000, text));
    expect(looksInvented(segments, 3)).toBe(false);
    expect(suspectWindows(segments, 76_000)).toEqual([]);
  });

  it('keeps a transcript with a few segments', () => {
    expect(looksInvented([at(0, 'Hello'), at(30_000, 'Hello')])).toBe(false);
  });
});

describe('suspectWindows', () => {
  const minute = 60_000;
  const talk = (fromMin: number, toMin: number) =>
    Array.from({ length: (toMin - fromMin) * 6 }, (_, i) =>
      at(
        fromMin * minute + i * 10_000,
        `we talked about plan ${String(i)} and what comes next for us`,
        8000,
      ),
    );

  it('flags a window with one credit line per half minute among good ones', () => {
    const credits = Array.from({ length: 20 }, (_, i) => at(i * 30_000, 'Subtitles by Jan', 2000));
    const found = suspectWindows([...credits, ...talk(10, 44)], 44 * minute);
    expect(found).toEqual([{ startMs: 0, endMs: 600_000, invented: true }]);
  });

  it('flags a thin tail as suspect but not made up', () => {
    const found = suspectWindows([...talk(0, 40), at(41 * minute, 'Ja.')], 44 * minute);
    expect(found).toEqual([{ startMs: 2_400_000, endMs: 2_640_000, invented: false }]);
  });

  it('flags nothing in an evenly spoken recording', () => {
    expect(suspectWindows(talk(0, 30), 30 * minute)).toEqual([]);
  });
});

describe('dropMadeUpLines', () => {
  const speech = (startMs: number) =>
    at(startMs, 'we looked at the numbers for the plan again', 6000);

  it.each([
    'TV GELDERLAND 2021.',
    'Ondertiteld door de Amara.org gemeenschap',
    'Untertitel der Amara.org-Community',
    'Subtitles by the Amara.org community',
    'www.example.com',
    'Omroep Brabant 2020',
  ])('drops the credit line %s even inside speech', (text) => {
    const found = dropMadeUpLines([speech(0), at(7000, text, 1500), speech(9000)]);
    expect(found.map((s) => s.text)).not.toContain(text);
    expect(found).toHaveLength(2);
  });

  it('drops a short line that returns three times, alone each time', () => {
    const lines = [20_000, 90_000, 200_000].map((t) => at(t, 'Bedankt voor het kijken', 2000));
    const found = dropMadeUpLines([speech(0), ...lines, speech(300_000)]);
    expect(found).toHaveLength(2);
  });

  it('keeps a short answer repeated in the middle of the conversation', () => {
    const talk = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0 ? at(i * 7000, 'Ja.', 1000) : speech(i * 7000),
    );
    expect(dropMadeUpLines(talk)).toHaveLength(12);
  });

  it('keeps a 2021 that is part of a sentence', () => {
    const found = dropMadeUpLines([at(0, 'in 2021 we moved to the new office downtown', 4000)]);
    expect(found).toHaveLength(1);
  });
});
