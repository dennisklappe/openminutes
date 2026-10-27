import { addVoiceSamples, ensurePerson } from '@openminutes/core';
import { meetings, participants } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Diarizer, EmbeddedLines } from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TranscriptRow } from '../transcript-store.js';
import { checkVoices, judgeLine } from './voice-check.js';

const scores = (own: number, other: number) =>
  new Map([
    ['a', own],
    ['b', other],
  ]);
const line = {
  participantId: 'a',
  speakerConfidence: 0.9,
  speakerCandidates: [{ participantId: 'a', score: 0.9 }],
};

describe('judgeLine', () => {
  it('keeps a long line whose own voice fits best', () => {
    const verdict = judgeLine(line, 6000, scores(0.8, 0.2));
    expect(verdict).toMatchObject({ confidence: 0.9, doubt: false, better: null });
  });

  it('doubts a long line that sounds like someone else and suggests them', () => {
    const verdict = judgeLine(line, 6000, scores(0.2, 0.8));
    expect(verdict.doubt).toBe(true);
    expect(verdict.better).toBe('b');
    expect(verdict.confidence).toBeLessThan(0.7);
    expect(verdict.candidates).toContainEqual({ participantId: 'b', score: 0.2 });
  });

  it('trusts a short line less: no doubt under a second, a lighter penalty under 2.5 s', () => {
    const tiny = judgeLine(line, 600, scores(0.2, 0.8));
    expect(tiny.doubt).toBe(false);
    expect(tiny.confidence).toBeGreaterThan(0.75);
    expect(tiny.confidence).toBeGreaterThan(
      judgeLine(line, 6000, scores(0.2, 0.8)).confidence ?? 1,
    );
    const brief = judgeLine(line, 1250, scores(0.45, 0.8));
    expect(brief.doubt).toBe(true);
    const mid = judgeLine({ ...line, speakerConfidence: 1 }, 1250, scores(0.5, 0.58));
    expect(mid.doubt).toBe(false);
    expect(mid.confidence).toBeGreaterThan(0.7);
  });

  it('does not penalise a label without a saved voice when nobody fits', () => {
    const verdict = judgeLine(line, 6000, new Map([['b', 0.2]]));
    expect(verdict).toMatchObject({ confidence: 0.9, doubt: false });
  });

  it('doubts a label without a saved voice when another voice fits clearly', () => {
    const verdict = judgeLine(line, 6000, new Map([['b', 0.7]]));
    expect(verdict).toMatchObject({ doubt: true, better: 'b' });
  });

  it('doubts a line that fits its own saved voice very badly', () => {
    expect(judgeLine(line, 6000, scores(0.1, 0.1))).toMatchObject({ doubt: true, better: null });
  });
});

describe('checkVoices', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  async function setup(withVoices: boolean) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Sync', platform: 'meet', joinUrl: 'u' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const [anna, bram] = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: `Anna ${meeting.id.slice(0, 4)}` },
        { meetingId: meeting.id, displayName: `Bram ${meeting.id.slice(0, 4)}` },
      ])
      .returning();
    if (!anna || !bram) throw new Error('insert failed');
    if (withVoices) {
      const a = await ensurePerson(test.db, anna.displayName);
      const b = await ensurePerson(test.db, bram.displayName);
      await addVoiceSamples(test.db, a.id, [{ kind: 'imported', embedding: [1, 0] }]);
      await addVoiceSamples(test.db, b.id, [{ kind: 'imported', embedding: [0, 1] }]);
    }
    const row = (i: number, participantId: string, extra: Partial<TranscriptRow> = {}) => ({
      meetingId: meeting.id,
      participantId,
      startMs: i * 5000,
      endMs: i * 5000 + 4000,
      text: `Line ${String(i)}`,
      speakerConfidence: 0.95,
      speakerSource: 'indicator' as const,
      speakerCandidates: [{ participantId, score: 1 }],
      ...extra,
    });
    return { meeting, anna, bram, row };
  }

  const diarizer = (embeddings: (number[] | null)[]) => {
    const embedEach = vi.fn((): Promise<EmbeddedLines | undefined> =>
      Promise.resolve({ embeddings, model: 'm' }),
    );
    const client: Diarizer = {
      diarize: () => Promise.resolve(undefined),
      embed: () => Promise.resolve(undefined),
      embedEach,
    };
    return { client, embedEach };
  };
  const deps = (d: Diarizer | undefined, enabled = true) => ({
    db: test.db,
    createDiarizer: () => Promise.resolve(d),
    enabled: () => Promise.resolve(enabled),
  });

  it('flags a line that sounds like the other person and suggests them', async () => {
    const { meeting, anna, bram, row } = await setup(true);
    const rows = [row(0, anna.id), row(1, anna.id), row(2, bram.id, { speakerSource: 'user' })];
    const d = diarizer([
      [1, 0],
      [0, 1],
    ]);
    const out = await checkVoices(deps(d.client), meeting.id, rows, '/audio.opus', {
      startMs: 1000,
      endMs: 99000,
    });

    expect(d.embedEach).toHaveBeenCalledWith({ path: '/audio.opus' }, [
      { startMs: 1000, endMs: 5000 },
      { startMs: 6000, endMs: 10000 },
    ]);
    expect(out[0]).toMatchObject({ voiceDoubt: false, speakerConfidence: 0.95 });
    expect(out[1]).toMatchObject({ voiceDoubt: true, suggestedParticipantId: bram.id });
    expect(out[1]?.speakerConfidence).toBeLessThan(0.7);
    expect(out[1]?.voiceScores?.[0]).toEqual({ participantId: bram.id, score: 1 });
    expect(out[2]).toBe(rows[2]);
  });

  it('changes nothing without saved voices, when off, or without the voice service', async () => {
    const none = await setup(false);
    const noneRows = [none.row(0, none.anna.id)];
    const unused = diarizer([[1, 0]]);
    expect(await checkVoices(deps(unused.client), none.meeting.id, noneRows, '/a', null)).toEqual(
      noneRows,
    );
    expect(unused.embedEach).not.toHaveBeenCalled();

    const some = await setup(true);
    const rows = [some.row(0, some.anna.id)];
    expect(
      await checkVoices(deps(unused.client, false), some.meeting.id, rows, '/a', null),
    ).toEqual(rows);
    expect(await checkVoices(deps(undefined), some.meeting.id, rows, '/a', null)).toEqual(rows);
    expect(unused.embedEach).not.toHaveBeenCalled();
  });

  it('keeps the labels when the voice service fails', async () => {
    const { meeting, anna, row } = await setup(true);
    const rows = [row(0, anna.id)];
    const broken: Diarizer = {
      ...diarizer([]).client,
      embedEach: () => Promise.reject(new Error('whisper is down')),
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await checkVoices(deps(broken), meeting.id, rows, '/a', null)).toEqual(rows);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
