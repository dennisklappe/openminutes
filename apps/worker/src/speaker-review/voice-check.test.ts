import { addVoiceSamples, ensurePerson, stopTracking } from '@openminutes/core';
import { eq, meetings, participants, people, speakerEvents } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Diarizer, EmbeddedLines } from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TranscriptRow } from '../transcript-store.js';
import {
  CONFLICT_SCORE,
  checkVoices,
  eliminate,
  judgeLine,
  RAISE_CAP,
  type EmbeddedLine,
} from './voice-check.js';

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
    // A clear lead for the label raises the timing score a little.
    expect(verdict).toMatchObject({ confidence: 0.95, doubt: false, better: null });
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

describe('relative scoring across the meeting', () => {
  it('raises the confidence when the label leads clearly, a little and never to certainty', () => {
    const low = { ...line, speakerConfidence: 0.8 };
    const raised = judgeLine(low, 6000, scores(0.9, 0.2));
    expect(raised.confidence).toBeCloseTo(0.85);
    expect(judgeLine({ ...line, speakerConfidence: 1 }, 6000, scores(0.95, 0.1)).confidence).toBe(
      1,
    );
    expect(judgeLine({ ...line, speakerConfidence: 0.94 }, 6000, scores(0.9, 0.1)).confidence).toBe(
      RAISE_CAP,
    );
    // A short line is a weak witness, a thin lead raises nothing.
    expect(judgeLine(low, 600, scores(0.9, 0.2)).confidence).toBeCloseTo(0.8, 1);
    expect(judgeLine(low, 6000, scores(0.9, 0.7)).confidence).toBe(0.8);
  });

  it('lowers both sides when a sure voice conflicts with the label', () => {
    const verdict = judgeLine(
      { ...line, speakerCandidates: [{ participantId: 'a', score: 0.8 }] },
      6000,
      new Map([
        ['a', 0.1],
        ['b', CONFLICT_SCORE + 0.1],
      ]),
    );
    expect(verdict).toMatchObject({ doubt: true, better: 'b' });
    expect(verdict.confidence).toBeLessThan(0.7);
    expect(verdict.candidates).toContainEqual({ participantId: 'a', score: 0.4 });
    expect(verdict.candidates).toContainEqual({ participantId: 'b', score: 0.2 });
  });
});

describe('eliminate', () => {
  const nobody = new Map([
    ['a', 0.1],
    ['b', 0.15],
  ]);
  const verdict = { confidence: 0.6, candidates: [{ participantId: 'c', score: 0.5 }] };
  const long = { participantId: 'c', speakerCandidates: [], startMs: 0, endMs: 4000 };

  it('raises a line of the one participant without a saved voice when it fits nobody else', () => {
    const left = eliminate(long, verdict, nobody, 'c');
    expect(left?.confidence).toBeCloseTo(0.7);
    expect(left?.suggest).toBeUndefined();
  });

  it('suggests that participant for a line labelled as someone else that fits nobody', () => {
    const left = eliminate({ ...long, participantId: 'a' }, verdict, nobody, 'c');
    expect(left?.suggest).toBe('c');
    expect(left?.candidates).toContainEqual({ participantId: 'c', score: 0.5 });
  });

  it('does nothing when a voice fits, the line is short, or more than one person is left', () => {
    expect(eliminate(long, verdict, new Map([['a', 0.5]]), 'c')).toBeUndefined();
    expect(eliminate({ ...long, endMs: 1000 }, verdict, nobody, 'c')).toBeUndefined();
    expect(eliminate(long, verdict, nobody, undefined)).toBeUndefined();
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

  it('never suggests a person marked do not track and scores nobody against their voice', async () => {
    const { meeting, anna, bram, row } = await setup(true);
    const [bramPerson] = await test.db
      .select()
      .from(people)
      .where(eq(people.name, bram.displayName));
    await stopTracking(test.db, bramPerson?.id ?? '');
    const rows = [row(0, anna.id)];
    const out = await checkVoices(deps(diarizer([[0, 1]]).client), meeting.id, rows, '/a', null);
    expect(out[0]?.suggestedParticipantId).toBeUndefined();
    expect(out[0]?.voiceScores?.map((s) => s.participantId)).toEqual([anna.id]);
    expect(out[0]?.speakerCandidates?.some((c) => c.participantId === bram.id)).toBe(false);
  });

  it('compares a line with the voice profile in its own language first', async () => {
    const { meeting, anna, bram, row } = await setup(false);
    const a = await ensurePerson(test.db, anna.displayName);
    const b = await ensurePerson(test.db, bram.displayName);
    // Anna sounds like [1,0] in Dutch and like [0,1] in English, Bram like [0,1] in Dutch.
    await addVoiceSamples(test.db, a.id, [
      { kind: 'imported', embedding: [1, 0], language: 'nl' },
      { kind: 'imported', embedding: [0, 1], language: 'en' },
    ]);
    await addVoiceSamples(test.db, b.id, [{ kind: 'imported', embedding: [0, 1], language: 'nl' }]);
    const rows = [row(0, anna.id, { language: 'nl' }), row(1, anna.id, { language: 'en' })];
    const out = await checkVoices(
      deps(
        diarizer([
          [1, 0],
          [0, 1],
        ]).client,
      ),
      meeting.id,
      rows,
      '/a',
      null,
    );
    // Dutch Anna fits her Dutch voice, English Anna her English voice: neither is doubted.
    expect(out[0]).toMatchObject({ voiceDoubt: false });
    expect(out[1]).toMatchObject({ voiceDoubt: false });
    expect(out[0]?.voiceScores?.[0]).toEqual({ participantId: anna.id, score: 1 });
    // Bram has no English voice: his Dutch voice counts there with the small penalty.
    expect(out[1]?.voiceScores?.find((s) => s.participantId === bram.id)?.score).toBe(0.95);
  });

  it('rules out by elimination: the unmatched voice is the one participant without a saved voice', async () => {
    const { meeting, anna, bram, row } = await setup(true);
    const [carla] = await test.db
      .insert(participants)
      .values({ meetingId: meeting.id, displayName: `Carla ${meeting.id.slice(0, 4)}` })
      .returning();
    if (!carla) throw new Error('insert failed');
    const rows = [
      row(0, carla.id, { speakerConfidence: 0.6 }),
      row(1, anna.id, { speakerConfidence: 0.9 }),
      row(2, bram.id, { endMs: 2 * 5000 + 1000 }),
    ];
    const d = diarizer([
      [0.7, 0.7],
      [0.7, -0.7],
      [0.7, 0.7],
    ]);
    const out = await checkVoices(deps(d.client), meeting.id, rows, '/a', null);
    // Fits Anna and Bram a bit (0.7), so only the clearly unmatched voice counts.
    expect(out.every((r) => !r.byElimination)).toBe(true);

    const none = diarizer([
      [-1, -1],
      [-1, -1],
      [-1, -1],
    ]);
    const left = await checkVoices(deps(none.client), meeting.id, rows, '/a', null);
    expect(left[0]).toMatchObject({ byElimination: true });
    expect(left[0]?.speakerConfidence).toBeCloseTo(0.7);
    expect(left[0]?.suggestedParticipantId).toBeUndefined();
    expect(left[1]).toMatchObject({ byElimination: true, suggestedParticipantId: carla.id });
    // The short line of Bram is only a weak witness.
    expect(left[2]?.byElimination).toBeUndefined();
  });

  it('does not rule out by elimination when two people lack a saved voice or someone is not tracked', async () => {
    const two = await setup(true);
    await test.db.insert(participants).values([
      { meetingId: two.meeting.id, displayName: `Carla ${two.meeting.id.slice(0, 4)}` },
      { meetingId: two.meeting.id, displayName: `Dirk ${two.meeting.id.slice(0, 4)}` },
    ]);
    const rows = [two.row(0, two.anna.id)];
    const out = await checkVoices(
      deps(diarizer([[-1, -1]]).client),
      two.meeting.id,
      rows,
      '/a',
      null,
    );
    expect(out[0]?.byElimination).toBeUndefined();

    const off = await setup(true);
    const [eve] = await test.db
      .insert(participants)
      .values({ meetingId: off.meeting.id, displayName: `Eve ${off.meeting.id.slice(0, 4)}` })
      .returning();
    const [frank] = await test.db
      .insert(participants)
      .values({ meetingId: off.meeting.id, displayName: `Frank ${off.meeting.id.slice(0, 4)}` })
      .returning();
    await ensurePerson(test.db, frank?.displayName ?? '').then((p) => stopTracking(test.db, p.id));
    const lines = [off.row(0, eve?.id ?? '')];
    const kept = await checkVoices(
      deps(diarizer([[-1, -1]]).client),
      off.meeting.id,
      lines,
      '/a',
      null,
    );
    expect(kept[0]?.byElimination).toBeUndefined();
  });
});

const at = (rows: TranscriptRow[], i: number): TranscriptRow => {
  const row = rows[i];
  if (!row) throw new Error(`no row ${String(i)}`);
  return row;
};

describe('checkVoices with meeting-local anchor voices', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  // Anna and Bram have no saved voice. Lines 0 to 2 are clean Anna turns, 3 to 5 clean Bram turns,
  // line 6 is a doubtful boundary line labelled Anna, line 7 a doubtful one labelled Bram.
  async function meeting(extra: Partial<TranscriptRow>[] = []) {
    const [m] = await test.db
      .insert(meetings)
      .values({ title: 'Anchors', platform: 'meet', joinUrl: 'u' })
      .returning();
    if (!m) throw new Error('insert failed');
    const [anna, bram] = await test.db
      .insert(participants)
      .values([
        { meetingId: m.id, displayName: `Anna ${m.id.slice(0, 4)}` },
        { meetingId: m.id, displayName: `Bram ${m.id.slice(0, 4)}` },
      ])
      .returning();
    if (!anna || !bram) throw new Error('insert failed');
    const who = [anna, anna, anna, bram, bram, bram, anna, bram];
    const rows: TranscriptRow[] = who.map((p, i) => ({
      meetingId: m.id,
      participantId: p.id,
      startMs: i * 5000,
      endMs: i * 5000 + 4000,
      text: `Line ${String(i)}`,
      speakerConfidence: i < 6 ? 0.95 : 0.5,
      speakerSource: 'indicator',
      speakerCandidates: [{ participantId: p.id, score: i < 6 ? 0.95 : 0.5 }],
      ...extra[i],
    }));
    await test.db.insert(speakerEvents).values(
      rows.map((r) => ({
        meetingId: m.id,
        participantId: r.participantId ?? '',
        startMs: r.startMs,
        endMs: r.endMs,
      })),
    );
    return { m, anna, bram, rows };
  }

  const voices = (embeddings: (number[] | null)[]) => {
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
  const config = (d: Diarizer | undefined, enabled = true) => ({
    db: test.db,
    createDiarizer: () => Promise.resolve(d),
    enabled: () => Promise.resolve(enabled),
  });
  const A = [1, 0.05];
  const A2 = [1, -0.05];
  const B = [0.05, 1];
  const B2 = [-0.05, 1];

  it('separates two unknown people: a doubtful line gets the voice it sounds like', async () => {
    const { m, anna, bram, rows } = await meeting();
    // Line 6 is labelled Anna but sounds like Bram, line 7 is labelled Bram and sounds like Bram.
    const d = voices([A, A2, A, B, B2, B, B, B2]);
    const out = await checkVoices(config(d.client), m.id, rows, '/a.opus', null);

    expect(d.embedEach).toHaveBeenCalledOnce();
    expect(out[6]).toMatchObject({ voiceDoubt: true, suggestedParticipantId: bram.id });
    expect(out[6]?.speakerConfidence).toBeLessThan(0.5 + 0.001);
    // The agreeing doubtful line is firmed up, to below certainty.
    expect(out[7]).toMatchObject({ voiceDoubt: false });
    expect(out[7]?.speakerConfidence).toBe(0.85);
    // The clean anchors keep their labels and show who the meeting voices think they are.
    expect(out[0]?.voiceScores?.[0]?.participantId).toBe(anna.id);
    expect(out[0]).toMatchObject({ voiceDoubt: false, speakerConfidence: 0.95 });
  });

  it('drops an anchor that sounds like someone else so the print is not poisoned', async () => {
    // Anna gets four anchors, the last is really Bram (the indicator lagged).
    const { m, anna, rows } = await meeting([{}, {}, {}, {}, {}, {}, {}, {}]);
    const lagged: TranscriptRow = {
      ...at(rows, 0),
      participantId: anna.id,
      startMs: 40_000,
      endMs: 44_000,
      text: 'Lagged',
    };
    await test.db.insert(speakerEvents).values({
      meetingId: m.id,
      participantId: anna.id,
      startMs: 40_000,
      endMs: 44_000,
    });
    const all = [...rows, lagged];
    const d = voices([A, A2, A, B, B2, B, B, B2, B]);
    const out = await checkVoices(config(d.client), m.id, all, '/a.opus', null);
    // With the outlier in the print Bram-like lines would still score 0.3 against Anna.
    const annaScore = out[6]?.voiceScores?.find((s) => s.participantId === anna.id)?.score ?? 1;
    expect(annaScore).toBeLessThan(0.1);
  });

  it('changes nothing and calls nothing when there are no clean anchors', async () => {
    const { m, rows } = await meeting();
    const noisy = rows.map((r) => ({ ...r, endMs: r.startMs + 2000 }));
    const d = voices([]);
    expect(await checkVoices(config(d.client), m.id, noisy, '/a.opus', null)).toEqual(noisy);
    expect(d.embedEach).not.toHaveBeenCalled();
  });

  it('needs two people with anchors when nobody has a saved voice', async () => {
    const { m, anna, rows } = await meeting();
    const onlyAnna = rows.map((r) => ({ ...r, participantId: anna.id }));
    const d = voices([]);
    await checkVoices(config(d.client), m.id, onlyAnna, '/a.opus', null);
    expect(d.embedEach).not.toHaveBeenCalled();
  });

  it('never touches a line a person set and does not use it as an anchor', async () => {
    const { m, bram, rows } = await meeting();
    const edited: TranscriptRow = {
      ...at(rows, 6),
      participantId: bram.id,
      speakerSource: 'user',
      speakerConfidence: 1,
    };
    const all = [...rows.slice(0, 6), edited, at(rows, 7)];
    const d = voices([A, A2, A, B, B2, B, B2]);
    const out = await checkVoices(config(d.client), m.id, all, '/a.opus', null);
    expect(out[6]).toBe(edited);
    // The user line is left out of the embedded ranges.
    expect(d.embedEach).toHaveBeenCalledWith(
      { path: '/a.opus' },
      expect.not.arrayContaining([{ startMs: 30_000, endMs: 34_000 }]),
    );
  });

  it('also embeds a meeting with one tile when asked to look for a shared room', async () => {
    const { m, anna, rows } = await meeting();
    const tile = rows.map((r) => ({ ...r, participantId: anna.id }));
    await test.db
      .update(speakerEvents)
      .set({ participantId: anna.id })
      .where(eq(speakerEvents.meetingId, m.id));
    const embeddings = [A, A2, A, B, B2, B, B, B2];
    const plain = voices(embeddings);
    await checkVoices(config(plain.client), m.id, tile, '/a.opus', null);
    expect(plain.embedEach).not.toHaveBeenCalled();

    const seen: EmbeddedLine[] = [];
    const d = voices(embeddings);
    const out = await checkVoices(
      { ...config(d.client), onEmbedded: (lines) => seen.push(...lines) },
      m.id,
      tile,
      '/a.opus',
      null,
    );
    expect(d.embedEach).toHaveBeenCalledOnce();
    // Nothing is relabelled: one tile and no saved voices change no line.
    expect(out).toEqual(tile);
    expect(seen).toHaveLength(8);
    expect(seen.filter((line) => line.anchor).length).toBeGreaterThanOrEqual(6);
  });

  it('does not use a line flagged as mixed as an anchor', async () => {
    const mixed = (i: number) => (i < 3 ? { mixed: 'marked' as const } : {});
    const flagged = await meeting(Array.from({ length: 8 }, (_, i) => mixed(i)));
    const d = voices([A, A2, A, B, B2, B, B, B2]);
    // All three clean Anna turns are mixed, so only Bram has anchors and no voice pair exists.
    const out = await checkVoices(config(d.client), flagged.m.id, flagged.rows, '/a.opus', null);
    expect(d.embedEach).not.toHaveBeenCalled();
    expect(out).toEqual(flagged.rows);
    // The same meeting without flags still separates the two people.
    const clean = await meeting();
    const e = voices([A, A2, A, B, B2, B, B, B2]);
    await checkVoices(config(e.client), clean.m.id, clean.rows, '/a.opus', null);
    expect(e.embedEach).toHaveBeenCalledOnce();
  });

  it('makes no calls when the check is off and saves no voice for anyone', async () => {
    const { m, rows } = await meeting();
    const d = voices([A, A2, A, B, B2, B, B, B2]);
    expect(await checkVoices(config(d.client, false), m.id, rows, '/a.opus', null)).toEqual(rows);
    expect(d.embedEach).not.toHaveBeenCalled();

    const scored: unknown[] = [];
    await checkVoices(
      { ...config(d.client), onScored: (lines) => scored.push(...lines) },
      m.id,
      rows,
      '/a.opus',
      null,
    );
    // No saved voice, so nothing is offered for automatic learning and nothing is stored.
    expect(scored).toEqual([]);
    expect(
      await test.db
        .select()
        .from(people)
        .where(eq(people.name, `Anna ${m.id.slice(0, 4)}`)),
    ).toEqual([]);
  });
});
