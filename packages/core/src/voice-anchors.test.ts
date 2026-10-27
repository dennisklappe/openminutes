import { describe, expect, it } from 'vitest';
import {
  ANCHOR_MAX_PER_PERSON,
  ANCHOR_WIN_MARGIN,
  buildMeetingVoices,
  clearWinner,
  combineScores,
  dropOutliers,
  meetingScore,
  MEETING_WEIGHT,
  PROFILE_WEIGHT,
  selectAnchors,
  type AnchorCandidate,
} from './voice-anchors.js';

const line = (
  key: number,
  who: string,
  start: number,
  end: number,
  extra = {},
): AnchorCandidate => ({
  key,
  participantId: who,
  startMs: start,
  endMs: end,
  speakerSource: 'indicator',
  speakerConfidence: 0.95,
  touched: false,
  ...extra,
});

describe('selectAnchors', () => {
  const events = [
    { participantId: 'a', startMs: 0, endMs: 4000 },
    { participantId: 'b', startMs: 5000, endMs: 9000 },
  ];

  it('takes a long, confident, undisturbed line whose speaker the indicator shows throughout', () => {
    expect(selectAnchors([line(0, 'a', 100, 3900), line(1, 'b', 5000, 9000)], events)).toHaveLength(
      2,
    );
  });

  it('skips short, unsure, edited, non-indicator and user lines', () => {
    const lines = [
      line(0, 'a', 0, 2500),
      line(1, 'a', 0, 4000, { speakerConfidence: 0.8 }),
      line(2, 'a', 0, 4000, { touched: true }),
      line(3, 'a', 0, 4000, { speakerSource: 'user' }),
      line(4, 'a', 0, 4000, { speakerSource: 'ai' }),
    ];
    expect(selectAnchors(lines, events)).toEqual([]);
  });

  it('skips a line when the indicator shows another speaker or only part of its own', () => {
    expect(
      selectAnchors(
        [line(0, 'a', 0, 4000)],
        [...events, { participantId: 'b', startMs: 1000, endMs: 3000 }],
      ),
    ).toEqual([]);
    expect(selectAnchors([line(0, 'a', 0, 5000)], events)).toEqual([]);
  });

  it('skips a line that another line overlaps, but not for a few hundred milliseconds', () => {
    expect(
      selectAnchors([line(0, 'a', 0, 4000), line(1, 'b', 2000, 6000)], events).map((l) => l.key),
    ).toEqual([]);
    const near = selectAnchors([line(0, 'a', 0, 4000), line(1, 'b', 3800, 7800)], events);
    expect(near.map((l) => l.key)).toContain(0);
  });

  it('keeps the longest lines of a person up to the cap', () => {
    const many = Array.from({ length: ANCHOR_MAX_PER_PERSON + 3 }, (_, i) =>
      line(i, 'a', i * 10_000, i * 10_000 + 3000 + i * 10),
    );
    const all = many.map((l) => ({ participantId: 'a', startMs: l.startMs, endMs: l.endMs }));
    const kept = selectAnchors(many, all);
    expect(kept).toHaveLength(ANCHOR_MAX_PER_PERSON);
    expect(kept.some((l) => l.key === 0)).toBe(false);
  });
});

describe('dropOutliers', () => {
  const same = [
    { key: 0, vector: [1, 0.05] },
    { key: 1, vector: [1, -0.05] },
    { key: 2, vector: [0.9, 0] },
  ];

  it('keeps consistent anchors and drops the one that sounds like someone else', () => {
    expect(dropOutliers(same)).toHaveLength(3);
    expect(dropOutliers([...same, { key: 3, vector: [0, 1] }]).map((a) => a.key)).toEqual([
      0, 1, 2,
    ]);
  });

  it('gives nobody a voice from one anchor or two that disagree', () => {
    expect(dropOutliers([{ key: 0, vector: [1, 0] }])).toEqual([]);
    expect(
      dropOutliers([
        { key: 0, vector: [1, 0] },
        { key: 1, vector: [0, 1] },
      ]),
    ).toEqual([]);
  });
});

describe('meeting voices', () => {
  const anchors = [
    { key: 0, participantId: 'a', vector: [1, 0.1] },
    { key: 1, participantId: 'a', vector: [1, -0.1] },
    { key: 2, participantId: 'a', vector: [1, 0] },
    { key: 3, participantId: 'b', vector: [0.1, 1] },
    { key: 4, participantId: 'b', vector: [-0.1, 1] },
  ];

  it('builds one temporary voice per participant with enough anchors', () => {
    const voices = buildMeetingVoices([...anchors, { key: 9, participantId: 'c', vector: [1, 1] }]);
    expect(voices.map((v) => v.participantId)).toEqual(['a', 'b']);
  });

  it('scores a line against a voice without letting an anchor vouch for itself', () => {
    const [a] = buildMeetingVoices(anchors);
    if (!a) throw new Error('no voice');
    expect(meetingScore([1, 0], a)).toBeGreaterThan(0.95);
    expect(meetingScore([0, 1], a)).toBeLessThan(0.2);
    // Anchor 0 compared with the others only.
    const own = meetingScore([1, 0.1], a, 0);
    expect(own).toBeDefined();
    expect(own).toBeLessThan(meetingScore([1, 0.1], a) ?? 1);
  });
});

describe('combineScores and clearWinner', () => {
  it('mixes by the named weights and falls back to whichever exists', () => {
    expect(combineScores(1, 0)).toBeCloseTo(PROFILE_WEIGHT);
    expect(combineScores(0, 1)).toBeCloseTo(MEETING_WEIGHT);
    expect(combineScores(0.7, undefined)).toBe(0.7);
    expect(combineScores(undefined, 0.4)).toBe(0.4);
    expect(combineScores(undefined, undefined)).toBeUndefined();
  });

  it('wants a high score and a margin to the runner-up', () => {
    expect(
      clearWinner(
        new Map([
          ['a', 0.9],
          ['b', 0.2],
        ]),
      )?.participantId,
    ).toBe('a');
    expect(
      clearWinner(
        new Map([
          ['a', 0.9],
          ['b', 0.9 - ANCHOR_WIN_MARGIN / 2],
        ]),
      ),
    ).toBeUndefined();
    expect(
      clearWinner(
        new Map([
          ['a', 0.4],
          ['b', 0.0],
        ]),
      ),
    ).toBeUndefined();
  });
});
