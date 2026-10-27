import { describe, expect, it, vi } from 'vitest';
import type { ReviewLineDto } from '../src/dto.js';
import {
  commit,
  counts,
  currentLine,
  decide,
  describeDecision,
  everyoneOptions,
  keyAction,
  pick,
  position,
  restore,
  reviewSkipped,
  rosterOptions,
  startReview,
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
  proposed: { id: 'p1', name: 'Anna' },
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
    expect(counts(state)).toEqual({ approved: 1, changed: 1, skipped: 1 });
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
  });

  it('verifies for the proposed person on approve', async () => {
    const a = api();
    await commit(a, { line: line('a'), decision: { kind: 'approve' } });
    expect(a.verifyLine).toHaveBeenCalledWith('p1', 'a');
  });

  it('moves, rejects and creates with the existing endpoints, and sends nothing for a skip', async () => {
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
