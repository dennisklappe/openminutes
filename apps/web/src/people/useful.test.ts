import { describe, expect, it } from 'vitest';
import {
  DOUBT_CONFIDENCE,
  DOUBT_RIVAL_SCORE,
  isFiller,
  isUsable,
  SESSION_CAP,
  TARGET_MS,
  selectUseful,
  whyOf,
  type Candidate,
} from './useful.js';

const cand = (id: string, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  group: 'p1',
  personId: 'p1',
  meetingId: 'm1',
  startMs: 0,
  endMs: 6000,
  text: 'we should move the planning meeting to thursday',
  channel: 'meet',
  overlapped: false,
  voiceDoubt: false,
  rival: 0,
  confidence: 0.95,
  ...extra,
});

describe('useful lines', () => {
  it('drops short, overlapped and filler lines', () => {
    expect(isUsable(cand('a'))).toBe(true);
    expect(isUsable(cand('a', { endMs: 2900 }))).toBe(false);
    expect(isUsable(cand('a', { overlapped: true }))).toBe(false);
    expect(isUsable(cand('a', { text: 'yeah okay right' }))).toBe(false);
    expect(isFiller('uh yeah no sure thanks')).toBe(true);
    expect(isFiller('ja ja dat klopt helemaal met de planning')).toBe(false);
  });

  it('asks about people with little verified speech first', () => {
    const picked = selectUseful(
      [
        cand('rich', { group: 'rich', personId: 'rich' }),
        cand('poor', { group: 'poor', personId: 'poor' }),
      ],
      new Map([['rich', 60_000]]),
    ).picked;
    expect(picked.map((c) => c.id)).toEqual(['poor', 'rich']);
  });

  it('does not queue a confident line of a well-profiled person', () => {
    const done = selectUseful([cand('sure')], new Map([['p1', TARGET_MS]]));
    expect(done.picked).toEqual([]);
    expect([...done.complete]).toEqual(['p1']);
  });

  it('queues a doubtful line of the same well-profiled person', () => {
    const covered = new Map([['p1', TARGET_MS]]);
    for (const doubtful of [
      cand('unsure', { confidence: DOUBT_CONFIDENCE - 0.01 }),
      cand('voice', { voiceDoubt: true }),
      cand('rival', { rival: DOUBT_RIVAL_SCORE }),
      cand('suggested', { suggested: true }),
    ]) {
      expect(selectUseful([doubtful], covered).picked.map((c) => c.id)).toEqual([doubtful.id]);
    }
  });

  it('queues a confident line of a poorly profiled person until the target is reached', () => {
    expect(selectUseful([cand('sure')], new Map([['p1', TARGET_MS - 1000]])).picked).toHaveLength(
      1,
    );
    expect(whyOf(cand('sure'))).toBe('training');
    expect(whyOf(cand('x', { confidence: 0.1 }))).toBe('doubt');
    const lines = [cand('a', { endMs: 50_000 }), cand('b', { meetingId: 'm2', endMs: 50_000 })];
    expect(selectUseful(lines, new Map([['p1', 50_000]])).picked.map((c) => c.id)).toHaveLength(1);
  });

  it('asks doubt before training', () => {
    const picked = selectUseful(
      [cand('train', { meetingId: 'a' }), cand('doubt', { meetingId: 'b', confidence: 0.2 })],
      new Map([['p1', 0]]),
    ).picked;
    expect(picked[0]?.id).toBe('doubt');
  });

  it('counts the picked speech towards the target', () => {
    const lines = Array.from({ length: 30 }, (_, i) =>
      cand(`l${String(i)}`, { meetingId: `m${String(i)}`, startMs: 0, endMs: 10_000 }),
    );
    const { picked } = selectUseful(lines, new Map());
    expect(picked).toHaveLength(TARGET_MS / 10_000);
  });

  it('prefers different meetings and far apart moments over near duplicates', () => {
    const picked = selectUseful(
      [
        cand('first', { startMs: 0, endMs: 5000 }),
        cand('near', { startMs: 6000, endMs: 11_000 }),
        cand('far', { startMs: 600_000, endMs: 605_000 }),
        cand('other', { meetingId: 'm2', startMs: 0, endMs: 5000 }),
      ],
      new Map(),
    ).picked.map((c) => c.id);
    expect(picked.indexOf('near')).toBe(3);
    expect(picked.slice(0, 3)).toContain('other');
  });

  it('ranks a rival or a doubting voice check up', () => {
    const picked = selectUseful(
      [cand('sure', { meetingId: 'a' }), cand('rival', { meetingId: 'b', rival: 0.6 })],
      new Map(),
    ).picked;
    expect(picked[0]?.id).toBe('rival');
  });

  it('has a session of 25 cards', () => {
    expect(SESSION_CAP).toBe(25);
  });
});
