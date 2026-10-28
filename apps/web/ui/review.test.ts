import { describe, expect, it, vi } from 'vitest';
import type { ReviewLineDto } from '../src/dto.js';
import type { Decision } from './review.js';
import {
  commit,
  counts,
  currentLine,
  decide,
  dropPerson,
  describeDecision,
  everyoneOptions,
  focusLine,
  clickWord,
  defaultPeople,
  keyAction,
  splitIntoParts,
  pick,
  position,
  restore,
  reviewSkipped,
  rosterOptions,
  startReview,
  uncommit,
  undo,
} from './review.js';

const line = (id: string, extra: Partial<ReviewLineDto> = {}): ReviewLineDto => ({
  id,
  meetingId: 'm1',
  meetingTitle: 'Weekly',
  meetingDate: '2026-10-01T10:00:00.000Z',
  startMs: 1000,
  endMs: 4000,
  text: `Line ${id}`,
  hasAudio: true,
  speakerConfidence: 0.3,
  voiceScore: null,
  reason: 'uncertain',
  why: 'doubt',
  proposed: { id: 'p1', name: 'Anna' },
  language: 'nl',
  languageName: 'Dutch',
  profileSeconds: 45,
  profileTargetSeconds: 90,
  considered: [],
  roster: [],
  ...extra,
});

describe('the review state', () => {
  const start = () => startReview([line('a'), line('b'), line('c')]);

  it('moves on one line at a time and counts the place', () => {
    let state = start();
    expect(currentLine(state)?.id).toBe('a');
    expect(position(state)).toBe(1);
    state = decide(state, { kind: 'approve' });
    expect(currentLine(state)?.id).toBe('b');
    expect(position(state)).toBe(2);
    state = decide(decide(state, { kind: 'approve' }), { kind: 'approve' });
    expect(currentLine(state)).toBeUndefined();
    expect(position(state)).toBe(3);
  });

  it('undoes the last decision, a skip too', () => {
    let state = decide(start(), { kind: 'skip' });
    expect(state.skipped.map((l) => l.id)).toEqual(['a']);
    state = undo(state);
    expect(currentLine(state)?.id).toBe('a');
    expect(state.skipped).toEqual([]);
    expect(undo(state)).toBe(state);
  });

  it('keeps skipped lines for another pass', () => {
    let state = decide(start(), { kind: 'skip' });
    state = decide(decide(state, { kind: 'approve' }), { kind: 'reject' });
    expect(counts(state)).toEqual({ approved: 1, changed: 1, mixed: 0, skipped: 1 });
    state = reviewSkipped(state);
    expect(state.rest.map((l) => l.id)).toEqual(['a']);
    expect(state.total).toBe(3);
    expect(position(state)).toBe(3);
  });

  it('puts a decision that failed to send back on screen', () => {
    const state = decide(decide(start(), { kind: 'approve' }), { kind: 'approve' });
    const failed = state.history[0];
    if (!failed) throw new Error('missing');
    const back = restore(state, failed);
    expect(back.rest.map((l) => l.id)).toEqual(['a', 'c']);
    expect(back.history).toHaveLength(1);
    expect(restore(back, failed)).toBe(back);
  });

  it('says what happened', () => {
    const entry = (decision: Parameters<typeof decide>[1]) => ({ line: line('a'), decision });
    expect(describeDecision(entry({ kind: 'approve' }))).toBe('Approved: Anna.');
    expect(describeDecision(entry({ kind: 'move', personId: 'p2', name: 'Bram' }))).toBe(
      'Moved to Bram.',
    );
    expect(describeDecision(entry({ kind: 'skip' }))).toBe('Skipped.');
  });
});

describe('commit', () => {
  const api = () => ({
    verifyLine: vi.fn().mockResolvedValue({}),
    rejectLine: vi.fn().mockResolvedValue({}),
    moveLine: vi.fn().mockResolvedValue({}),
    createPerson: vi.fn().mockResolvedValue({ person: { id: 'new' } }),
    skipLine: vi.fn().mockResolvedValue({}),
    undoReviewDecision: vi.fn().mockResolvedValue({}),
    splitLine: vi.fn().mockResolvedValue({}),
    markMixed: vi.fn().mockResolvedValue({}),
  });

  it('verifies for the proposed person on approve', async () => {
    const a = api();
    await commit(a, { line: line('a'), decision: { kind: 'approve' } });
    expect(a.verifyLine).toHaveBeenCalledWith('p1', 'a');
  });

  it('moves, rejects and creates with the existing endpoints, and stores a skip', async () => {
    const a = api();
    await commit(a, { line: line('a'), decision: { kind: 'move', personId: 'p2', name: 'B' } });
    expect(a.moveLine).toHaveBeenCalledWith('p1', 'a', 'p2');
    await commit(a, { line: line('a'), decision: { kind: 'reject' } });
    expect(a.rejectLine).toHaveBeenCalledWith('p1', 'a');
    await commit(a, { line: line('b'), decision: { kind: 'create', name: 'New One' } });
    expect(a.createPerson).toHaveBeenCalledWith({ name: 'New One' });
    expect(a.moveLine).toHaveBeenLastCalledWith('p1', 'b', 'new');
    const before = a.verifyLine.mock.calls.length + a.moveLine.mock.calls.length;
    await commit(a, { line: line('c'), decision: { kind: 'skip' } });
    expect(a.verifyLine.mock.calls.length + a.moveLine.mock.calls.length).toBe(before);
    expect(a.skipLine).toHaveBeenCalledWith('p1', 'c');
  });

  it('marks a line mixed for the proposed person', async () => {
    const a = api();
    await commit(a, { line: line('a'), decision: { kind: 'mixed' } });
    expect(a.markMixed).toHaveBeenCalledWith('p1', 'a');
    expect(a.verifyLine).not.toHaveBeenCalled();
  });

  it('splits with one person per part and makes a name-only person once', async () => {
    const a = api();
    await commit(a, {
      line: line('a'),
      decision: {
        kind: 'split',
        cuts: [3, 6],
        people: [
          { personId: 'p1', name: 'Anna' },
          { personId: null, name: 'Dana' },
          { personId: null, name: 'dana' },
        ],
      },
    });
    expect(a.createPerson).toHaveBeenCalledTimes(1);
    expect(a.splitLine).toHaveBeenCalledWith('p1', 'a', {
      cuts: [3, 6],
      personIds: ['p1', 'new', 'new'],
    });
  });

  it('takes a sent decision back on the server', async () => {
    const a = api();
    await uncommit(a, { line: line('a'), decision: { kind: 'approve' } });
    expect(a.undoReviewDecision).toHaveBeenCalledWith('a');
  });
});

describe('the person picker', () => {
  const people = [
    { id: 'p1', name: 'Anna' },
    { id: 'p2', name: 'Bram Fixture' },
    { id: 'p3', name: 'Cleo' },
  ];

  it('lists the meeting people, matching unlinked names to saved people', () => {
    const options = rosterOptions(
      [
        { personId: 'p3', name: 'Cleo' },
        { personId: null, name: 'bram fixture' },
        { personId: null, name: 'Dana' },
        { personId: null, name: 'Anna' },
      ],
      people,
      'p1',
    );
    expect(options).toEqual([
      { personId: 'p3', name: 'Cleo' },
      { personId: 'p2', name: 'bram fixture' },
      { personId: null, name: 'Dana' },
    ]);
  });

  it('searches everyone except the proposed person', () => {
    expect(everyoneOptions(people, 'p1', '').map((o) => o.name)).toEqual(['Bram Fixture', 'Cleo']);
    expect(everyoneOptions(people, 'p1', ' FIX ').map((o) => o.name)).toEqual(['Bram Fixture']);
    expect(everyoneOptions(people, 'p1', 'anna')).toEqual([]);
  });

  it('turns a pick into a move or a new person', () => {
    expect(pick({ personId: 'p2', name: 'Bram' })).toEqual({
      kind: 'move',
      personId: 'p2',
      name: 'Bram',
    });
    expect(pick({ personId: null, name: 'Dana' })).toEqual({ kind: 'create', name: 'Dana' });
  });
});

describe('keyAction', () => {
  it('maps arrows and letters on the card', () => {
    expect(keyAction('ArrowRight', 'closed')).toBe('approve');
    expect(keyAction('A', 'closed')).toBe('approve');
    expect(keyAction('ArrowLeft', 'closed')).toBe('disapprove');
    expect(keyAction('d', 'closed')).toBe('disapprove');
    expect(keyAction('ArrowDown', 'closed')).toBe('skip');
    expect(keyAction('s', 'closed')).toBe('skip');
    expect(keyAction('u', 'closed')).toBe('undo');
    expect(keyAction('Escape', 'closed')).toBe('exit');
    expect(keyAction('1', 'closed')).toBeUndefined();
  });

  it('only lets numbers and Escape through while the picker is open', () => {
    expect(keyAction('2', 'roster')).toEqual({ pick: 1 });
    expect(keyAction('0', 'roster')).toBeUndefined();
    expect(keyAction('2', 'other')).toBeUndefined();
    expect(keyAction('a', 'roster')).toBeUndefined();
    expect(keyAction('ArrowRight', 'other')).toBeUndefined();
    expect(keyAction('Escape', 'other')).toBe('exit');
  });
});

describe('do not track in the queue', () => {
  const mine = (id: string, who: string) => line(id, { proposed: { id: who, name: who } });

  it('drops every line proposed for that person, counting the total down', () => {
    let state = startReview([mine('a', 'p1'), mine('b', 'p2'), mine('c', 'p1'), mine('d', 'p3')]);
    state = decide(state, { kind: 'skip' });
    const after = dropPerson(state, 'p1');
    expect([...after.rest, ...after.skipped].map((l) => l.id)).toEqual(['b', 'd']);
    expect(after.total).toBe(2);
    expect(currentLine(after)?.id).toBe('b');
  });

  it('offers a person who is not tracked only in the full list, marked', () => {
    const people = [
      { id: 'p1', name: 'Anna' },
      { id: 'p2', name: 'Mute', tracked: false },
    ];
    expect(everyoneOptions(people, 'p1', 'mu')).toEqual([
      { personId: 'p2', name: 'Mute', untracked: true },
    ]);
    // A meeting participant with the name of an untracked person is not matched to them.
    expect(rosterOptions([{ personId: null, name: 'Mute' }], people, 'p1')).toEqual([
      { personId: null, name: 'Mute' },
    ]);
  });
});

describe('opening a card by its line', () => {
  const start = () => startReview([line('a'), line('b'), line('c')]);

  it('puts the line on screen and keeps the order of the rest', () => {
    const state = focusLine(start(), 'c');
    expect(state?.rest.map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(focusLine(start(), 'a')?.rest.map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('says when the line is gone: decided, skipped or never in the queue', () => {
    const decided = decide(start(), { kind: 'approve' });
    expect(focusLine(decided, 'a')).toBeUndefined();
    expect(focusLine(decide(start(), { kind: 'skip' }), 'a')).toBeUndefined();
    expect(focusLine(start(), 'zzz')).toBeUndefined();
  });
});

describe('splitting a line', () => {
  const words = 'one two three four five six'.split(' ');

  it('turns the cuts into parts', () => {
    expect(splitIntoParts(words, [2]).map((p) => p.join(' '))).toEqual([
      'one two',
      'three four five six',
    ]);
    expect(splitIntoParts(words, [1, 4]).map((p) => p.join(' '))).toEqual([
      'one',
      'two three four',
      'five six',
    ]);
  });

  it('moves the nearest cut on a click, adds one only on "split again", removes on a second click', () => {
    expect(clickWord([], 3, false)).toEqual([3]);
    expect(clickWord([3], 5, false)).toEqual([5]);
    expect(clickWord([3], 5, true)).toEqual([3, 5]);
    expect(clickWord([2, 5], 4, false)).toEqual([2, 4]);
    expect(clickWord([2, 5], 4, true)).toEqual([2, 4]);
    expect(clickWord([3], 3, false)).toEqual([]);
    expect(clickWord([3], 0, false)).toEqual([3]);
  });

  it('proposes the proposed person first, the first other person second, then the first again', () => {
    const anna = { personId: 'p1', name: 'Anna' };
    const bram = { personId: 'p2', name: 'Bram' };
    const cleo = { personId: 'p3', name: 'Cleo' };
    expect(defaultPeople(anna, [bram, cleo], 2)).toEqual([anna, bram]);
    expect(defaultPeople(anna, [bram, cleo], 3)).toEqual([anna, bram, anna]);
    expect(defaultPeople(anna, [], 2)).toEqual([anna, anna]);
  });

  it('has keys for split and mixed, and only Escape while splitting', () => {
    expect(keyAction('x', 'closed')).toBe('split');
    expect(keyAction('M', 'closed')).toBe('mixed');
    expect(keyAction('x', 'split')).toBeUndefined();
    expect(keyAction('m', 'roster')).toBeUndefined();
    expect(keyAction('Escape', 'split')).toBe('exit');
  });

  it('counts and describes the new decisions', () => {
    const entry = (decision: Decision) => ({ line: line('a'), decision });
    expect(describeDecision(entry({ kind: 'split', cuts: [2], people: [] }))).toBe(
      'Split into 2 lines.',
    );
    expect(describeDecision(entry({ kind: 'mixed' }))).toMatch(/mixed/);
    const state = decide(decide(startReview([line('a'), line('b')]), { kind: 'mixed' }), {
      kind: 'split',
      cuts: [1],
      people: [],
    });
    expect(counts(state)).toMatchObject({ changed: 1, mixed: 1 });
  });
});
