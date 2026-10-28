import {
  addVoiceSamples,
  AUTO_MARGIN,
  AUTO_SEED_MS,
  ELIMINATION_GAP,
  ensurePerson,
  stopTracking,
} from '@openminutes/core';
import {
  eq,
  meetings,
  participants,
  people,
  roomVoices,
  transcriptSegments,
  voiceSamples,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Diarizer } from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  autoLearn,
  isCallLabelProof,
  isEliminationProof,
  type CallLabelInput,
  type EliminationInput,
} from './auto-learn.js';
import type { ScoredLine } from './speaker-review/voice-check.js';

const input = (extra: Partial<CallLabelInput> = {}): CallLabelInput => ({
  line: {
    participantId: 'a',
    timing: 0.95,
    scores: new Map([
      ['a', 0.9],
      ['b', 0.3],
    ]),
  },
  durationMs: 5000,
  source: 'indicator',
  overlapped: false,
  disputed: false,
  rivalTiming: 0,
  threshold: 0.6,
  ...extra,
});

describe('isCallLabelProof', () => {
  it('needs the indicator and a matching voice to agree', () => {
    expect(isCallLabelProof(input())).toBe(true);
  });

  it('is not enough with the label alone: a low voice score goes to review', () => {
    const line = (own: number) => ({
      participantId: 'a',
      timing: 0.95,
      scores: new Map([['a', own]]),
    });
    expect(isCallLabelProof(input({ line: line(0.59) }))).toBe(false);
    expect(isCallLabelProof(input({ line: line(0.6) }))).toBe(true);
    expect(
      isCallLabelProof(input({ line: { participantId: 'a', timing: 0.95, scores: new Map() } })),
    ).toBe(false);
  });

  it('is not enough with the voice alone: only the speaking indicator counts, not diarization', () => {
    for (const bad of [{ source: 'diarization' }, { source: 'guess' }, { source: null }]) {
      expect(isCallLabelProof(input(bad))).toBe(false);
    }
  });

  it('never takes lines a person or an AI set, or that are short, overlapped, disputed or shared with another speaker', () => {
    for (const bad of [
      { source: 'ai' },
      { source: 'user' },
      { durationMs: 3900 },
      { overlapped: true },
      { disputed: true },
      { rivalTiming: 0.3 },
    ]) {
      expect(isCallLabelProof(input(bad))).toBe(false);
    }
  });

  it('wants a sure indicator and a clear margin over the other voices', () => {
    const line = (timing: number | null, own: number, other: number) => ({
      participantId: 'a',
      timing,
      scores: new Map([
        ['a', own],
        ['b', other],
      ]),
    });
    expect(isCallLabelProof(input({ line: line(0.8, 0.9, 0.3) }))).toBe(false);
    expect(isCallLabelProof(input({ line: line(null, 0.9, 0.3) }))).toBe(false);
    expect(isCallLabelProof(input({ line: line(0.95, 0.9, 0.9 - AUTO_MARGIN + 0.01) }))).toBe(
      false,
    );
    expect(isCallLabelProof(input({ line: line(0.95, 0.9, 0.9 - AUTO_MARGIN - 0.01) }))).toBe(true);
  });

  it('asks a higher voice score of a person whose auto samples were rejected', () => {
    const line = { participantId: 'a', timing: 0.95, scores: new Map([['a', 0.65]]) };
    expect(isCallLabelProof(input({ line }))).toBe(true);
    expect(isCallLabelProof(input({ line, threshold: 0.68 }))).toBe(false);
  });
});

describe('isEliminationProof', () => {
  const elim = (extra: Partial<EliminationInput> = {}): EliminationInput => ({
    line: { participantId: 'b', timing: 0.95, scores: new Map([['a', 0.2]]) },
    durationMs: 5000,
    source: 'indicator',
    overlapped: false,
    disputed: false,
    rivalTiming: 0,
    otherScore: 0.2,
    otherThreshold: 0.6,
    twoSpeakers: false,
    ...extra,
  });

  it('takes a clean line that clearly is not the ready person', () => {
    expect(isEliminationProof(elim())).toBe(true);
    expect(isEliminationProof(elim({ otherScore: 0.6 - ELIMINATION_GAP }))).toBe(false);
    expect(isEliminationProof(elim({ otherScore: 0.6 - ELIMINATION_GAP - 0.01 }))).toBe(true);
    expect(isEliminationProof(elim({ otherScore: undefined }))).toBe(false);
  });

  it('takes diarization labels only for an import with two speakers', () => {
    expect(isEliminationProof(elim({ source: 'diarization' }))).toBe(false);
    expect(isEliminationProof(elim({ source: 'diarization', twoSpeakers: true }))).toBe(true);
  });

  it('skips short, overlapped, disputed and person set lines', () => {
    for (const bad of [
      { durationMs: 3000 },
      { overlapped: true },
      { disputed: true },
      { source: 'user' },
      { rivalTiming: 0.4 },
    ]) {
      expect(isEliminationProof(elim(bad))).toBe(false);
    }
  });
});

describe('autoLearn', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  /** A Dutch meeting with `lines` lines of `ms` ms each for one linked person, all near-certain. */
  async function setup(
    opts: { seedMs?: number; lines?: number; ms?: number; language?: string } = {},
  ) {
    const { seedMs = AUTO_SEED_MS, lines = 3, ms = 5000, language = 'nl' } = opts;
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Sync', platform: 'meet', joinUrl: 'u', language })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const name = `Auto ${meeting.id.slice(0, 6)}`;
    const person = await ensurePerson(test.db, name);
    const [seat, other] = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: name, personId: person.id },
        { meetingId: meeting.id, displayName: `Other ${meeting.id.slice(0, 4)}` },
      ])
      .returning();
    if (!seat || !other) throw new Error('insert failed');
    if (seedMs > 0) {
      await addVoiceSamples(test.db, person.id, [
        { kind: 'imported', embedding: [1, 0], durationMs: seedMs, language, source: 'verified' },
      ]);
    }
    const rows = await test.db
      .insert(transcriptSegments)
      .values(
        Array.from({ length: lines }, (_, i) => ({
          meetingId: meeting.id,
          participantId: seat.id,
          startMs: i * (ms + 1000),
          endMs: i * (ms + 1000) + ms,
          text: `Line ${String(i)}`,
          speakerConfidence: 0.95,
          speakerSource: 'indicator' as const,
        })),
      )
      .returning();
    const scored: ScoredLine[] = rows
      .toSorted((a, b) => a.startMs - b.startMs)
      .map((row) => ({
        startMs: row.startMs,
        endMs: row.endMs,
        participantId: seat.id,
        embedding: [1, 0],
        embedder: 'm',
        timing: 0.95,
        scores: new Map([
          [seat.id, 0.95],
          [other.id, 0.1],
        ]),
      }));
    return { meeting, person, seat, other, rows, scored };
  }
  const autoSamples = (personId: string) =>
    test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, personId));

  it('adds near-certain lines of a seeded profile as auto samples in the language of the line', async () => {
    const { meeting, person, scored } = await setup();
    expect(await autoLearn(test.db, meeting.id, scored, true)).toBe(3);
    const auto = (await autoSamples(person.id)).filter((s) => s.source === 'auto');
    expect(auto).toHaveLength(3);
    expect(auto.every((s) => s.language === 'nl' && s.kind === 'line')).toBe(true);
  });

  it('adds nothing without a seed of verified speech in that language', async () => {
    const none = await setup({ seedMs: 0 });
    expect(await autoLearn(test.db, none.meeting.id, none.scored, true)).toBe(0);
    const short = await setup({ seedMs: AUTO_SEED_MS - 1 });
    expect(await autoLearn(test.db, short.meeting.id, short.scored, true)).toBe(0);
    // A seed in Dutch does not open English.
    const wrong = await setup();
    await test.db
      .update(transcriptSegments)
      .set({ language: 'en' })
      .where(eq(transcriptSegments.meetingId, wrong.meeting.id));
    expect(await autoLearn(test.db, wrong.meeting.id, wrong.scored, true)).toBe(0);
    // An auto sample alone is never a seed.
    const again = await setup({ seedMs: 0 });
    await addVoiceSamples(test.db, again.person.id, [
      { kind: 'imported', embedding: [1, 0], durationMs: 60_000, language: 'nl', source: 'auto' },
    ]);
    expect(await autoLearn(test.db, again.meeting.id, again.scored, true)).toBe(0);
  });

  it('does nothing when learning is off or the person is not tracked', async () => {
    const off = await setup();
    expect(await autoLearn(test.db, off.meeting.id, off.scored, false)).toBe(0);
    const untracked = await setup();
    await stopTracking(test.db, untracked.person.id);
    expect(await autoLearn(test.db, untracked.meeting.id, untracked.scored, true)).toBe(0);
    expect(await autoSamples(untracked.person.id)).toEqual([]);
  });

  it('skips lines an AI changed or suggested, a person set, that overlap, or the voice check doubted', async () => {
    const { meeting, rows, other, scored, person } = await setup({ lines: 4 });
    const [ai, user, suggested, doubted] = rows.toSorted((a, b) => a.startMs - b.startMs);
    await test.db
      .update(transcriptSegments)
      .set({ speakerSource: 'ai' })
      .where(eq(transcriptSegments.id, ai?.id ?? ''));
    await test.db
      .update(transcriptSegments)
      .set({ speakerSource: 'user' })
      .where(eq(transcriptSegments.id, user?.id ?? ''));
    await test.db
      .update(transcriptSegments)
      .set({ suggestedParticipantId: other.id })
      .where(eq(transcriptSegments.id, suggested?.id ?? ''));
    await test.db
      .update(transcriptSegments)
      .set({ voiceDoubt: true })
      .where(eq(transcriptSegments.id, doubted?.id ?? ''));
    expect(await autoLearn(test.db, meeting.id, scored, true)).toBe(0);
    expect((await autoSamples(person.id)).filter((s) => s.source === 'auto')).toEqual([]);

    const talkedOver = await setup({ lines: 1 });
    const [only] = talkedOver.rows;
    await test.db.insert(transcriptSegments).values({
      meetingId: talkedOver.meeting.id,
      participantId: talkedOver.other.id,
      startMs: (only?.startMs ?? 0) + 500,
      endMs: (only?.endMs ?? 0) + 500,
      text: 'over',
    });
    expect(await autoLearn(test.db, talkedOver.meeting.id, talkedOver.scored, true)).toBe(0);
  });

  describe('the mixed line guard', () => {
    // Setup lines are 5 s, so every near-certain line is guarded.
    const diarizerOf = (embeddings: (number[] | null)[]) => {
      const embedEach = vi.fn<Diarizer['embedEach']>(() =>
        Promise.resolve({ embeddings, model: 'm' }),
      );
      const diarizer: Diarizer = {
        diarize: () => Promise.resolve(undefined),
        embed: () => Promise.resolve(undefined),
        embedEach,
      };
      return { diarizer, embedEach };
    };
    const flag = async (id: string) =>
      (await test.db.select().from(transcriptSegments).where(eq(transcriptSegments.id, id)))[0]
        ?.mixed;

    it('drops a probable line, flags it and learns the clean ones', async () => {
      const { meeting, person, rows, scored } = await setup();
      const [a, b, c] = rows.toSorted((x, y) => x.startMs - y.startMs);
      // Halves per line in order: line 2 has two different voices.
      const d = diarizerOf([
        [1, 0],
        [1, 0.1],
        [1, 0],
        [0, 1],
        [1, 0],
        [0.9, 0],
      ]);
      expect(
        await autoLearn(test.db, meeting.id, scored, true, {
          audioPath: '/a',
          diarizer: d.diarizer,
        }),
      ).toBe(2);
      const auto = (await autoSamples(person.id)).filter((s) => s.source === 'auto');
      expect(auto.map((s) => s.segmentId).sort()).toEqual([a?.id, c?.id].sort());
      expect(await flag(b?.id ?? '')).toBe('probable');
      expect(await flag(a?.id ?? '')).toBeNull();
      expect(d.embedEach).toHaveBeenCalledTimes(1);
    });

    it('skips lines with a mixed flag and does not embed them', async () => {
      const { meeting, person, rows, scored } = await setup({ lines: 2 });
      const [a] = rows.toSorted((x, y) => x.startMs - y.startMs);
      await test.db
        .update(transcriptSegments)
        .set({ mixed: 'marked' })
        .where(eq(transcriptSegments.id, a?.id ?? ''));
      const d = diarizerOf([
        [1, 0],
        [1, 0],
      ]);
      expect(
        await autoLearn(test.db, meeting.id, scored, true, {
          audioPath: '/a',
          diarizer: d.diarizer,
        }),
      ).toBe(1);
      expect(d.embedEach.mock.calls[0]?.[1]).toHaveLength(2);
      expect((await autoSamples(person.id)).filter((s) => s.source === 'auto')).toHaveLength(1);
    });

    it('fails open without a voice service or when it throws', async () => {
      const none = await setup({ lines: 2 });
      expect(
        await autoLearn(test.db, none.meeting.id, none.scored, true, {
          audioPath: '/a',
          diarizer: undefined,
        }),
      ).toBe(2);
      const broken = await setup({ lines: 2 });
      const d = diarizerOf([]);
      d.embedEach.mockRejectedValue(new Error('down'));
      expect(
        await autoLearn(test.db, broken.meeting.id, broken.scored, true, {
          audioPath: '/a',
          diarizer: d.diarizer,
        }),
      ).toBe(2);
    });
  });

  it('never replaces a line that already has a sample or was rejected for the person', async () => {
    const { meeting, person, rows, scored } = await setup({ lines: 2 });
    const [first] = rows.toSorted((a, b) => a.startMs - b.startMs);
    await test.db.insert(voiceSamples).values({
      personId: person.id,
      kind: 'line',
      segmentId: first?.id ?? '',
      meetingId: meeting.id,
      rejected: true,
    });
    expect(await autoLearn(test.db, meeting.id, scored, true)).toBe(1);
  });

  it('has no caps: every proven line is learned, however much speech there already is', async () => {
    const big = await setup({ seedMs: AUTO_SEED_MS, lines: 30, ms: 4500 });
    expect(await autoLearn(test.db, big.meeting.id, big.scored, true)).toBe(30);
    const autoMs = (await autoSamples(big.person.id))
      .filter((s) => s.source === 'auto')
      .reduce((sum, s) => sum + s.durationMs, 0);
    expect(autoMs).toBe(30 * 4500);
  });

  it('does not learn a line on the label alone when the voice does not match', async () => {
    const { meeting, scored, person } = await setup({ lines: 2 });
    const weak = scored.map((line) => ({
      ...line,
      scores: new Map([[line.participantId, 0.3]]),
    }));
    expect(await autoLearn(test.db, meeting.id, weak, true)).toBe(0);
    expect(await autoSamples(person.id)).toHaveLength(1);
  });

  it('never learns from a shared tile or a line given to a voice of a tile', async () => {
    const tile = await setup({ lines: 2 });
    await test.db
      .update(participants)
      .set({ roomCount: 2 })
      .where(eq(participants.id, tile.seat.id));
    expect(await autoLearn(test.db, tile.meeting.id, tile.scored, true)).toBe(0);
    const voiced = await setup({ lines: 2 });
    await test.db.insert(roomVoices).values({
      meetingId: voiced.meeting.id,
      participantId: voiced.seat.id,
      number: 1,
      centroid: [1, 0],
      lines: 2,
      durationMs: 10_000,
    });
    expect(await autoLearn(test.db, voiced.meeting.id, voiced.scored, true)).toBe(0);
    const lineVoice = await setup({ lines: 2 });
    const [rv] = await test.db
      .insert(roomVoices)
      .values({
        meetingId: lineVoice.meeting.id,
        participantId: lineVoice.other.id,
        number: 1,
        centroid: [1, 0],
        lines: 2,
        durationMs: 10_000,
      })
      .returning();
    await test.db
      .update(transcriptSegments)
      .set({ roomVoiceId: rv?.id ?? '' })
      .where(eq(transcriptSegments.meetingId, lineVoice.meeting.id));
    expect(await autoLearn(test.db, lineVoice.meeting.id, lineVoice.scored, true)).toBe(0);
  });

  it('weighs auto samples less when the profile is built', async () => {
    const { meeting, person, scored } = await setup({ lines: 1 });
    await autoLearn(test.db, meeting.id, scored, true);
    const [row] = await test.db.select().from(people).where(eq(people.id, person.id));
    const nl = row?.voicePrototypes.find((p) => p.language === 'nl');
    expect(nl?.samples).toBeCloseTo(1 + 0.4);
  });
});

describe('autoLearn, 1:1 elimination', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  const jo = (degrees: number) => [
    Math.cos((degrees * Math.PI) / 180),
    Math.sin((degrees * Math.PI) / 180),
    0,
    0,
  ];
  const SAM = [0, 0, 1, 0];
  const VISITOR = [0, 0, 0, 1];

  /** Jo has a ready profile: 5 meetings, 5 ways of sounding, 120 s of verified speech in Dutch. */
  async function readyJo(name: string) {
    const person = await ensurePerson(test.db, name);
    const meetingIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [m] = await test.db
        .insert(meetings)
        .values({ title: `Old ${String(i)}`, platform: 'meet', joinUrl: 'u', language: 'nl' })
        .returning();
      meetingIds.push(m?.id ?? '');
    }
    await addVoiceSamples(
      test.db,
      person.id,
      [0, 60, 120, 180, 240].map((degrees, i) => ({
        kind: 'line' as const,
        embedding: jo(degrees),
        durationMs: 24_000,
        meetingId: meetingIds[i] ?? null,
        language: 'nl',
      })),
    );
    return person;
  }

  interface Opts {
    ready?: boolean;
    ms?: number;
    joScore?: number;
    source?: 'indicator' | 'diarization';
    speakerCount?: number | null;
    third?: boolean;
    extraPerson?: boolean;
    samLines?: number;
  }

  async function pair(opts: Opts = {}) {
    const {
      ready = true,
      ms = 5000,
      joScore = 0.1,
      source = 'indicator',
      speakerCount = null,
      third = false,
      extraPerson = false,
      samLines = 4,
    } = opts;
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'One on one', platform: 'meet', joinUrl: 'u', language: 'nl', speakerCount })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const tag = meeting.id.slice(0, 6);
    const joPerson = ready ? await readyJo(`Jo ${tag}`) : await ensurePerson(test.db, `Jo ${tag}`);
    if (!ready) {
      await addVoiceSamples(test.db, joPerson.id, [
        { kind: 'line', embedding: jo(0), durationMs: 40_000, language: 'nl' },
      ]);
    }
    const samPerson = await ensurePerson(test.db, `Sam ${tag}`);
    const seats = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: joPerson.name, personId: joPerson.id },
        { meetingId: meeting.id, displayName: samPerson.name, personId: samPerson.id },
        ...(extraPerson ? [{ meetingId: meeting.id, displayName: `Ann ${tag}` }] : []),
      ])
      .returning();
    const [joSeat, samSeat] = seats;
    if (!joSeat || !samSeat) throw new Error('insert failed');
    const rows = await test.db
      .insert(transcriptSegments)
      .values(
        Array.from({ length: samLines }, (_, i) => ({
          meetingId: meeting.id,
          participantId: samSeat.id,
          startMs: i * (ms + 1000),
          endMs: i * (ms + 1000) + ms,
          text: `Sam ${String(i)}`,
          speakerConfidence: 0.95,
          speakerSource: source,
        })),
      )
      .returning();
    const scored: ScoredLine[] = rows
      .toSorted((a, b) => a.startMs - b.startMs)
      .map((row, i) => ({
        startMs: row.startMs,
        endMs: row.endMs,
        participantId: samSeat.id,
        embedding: third && i % 2 === 1 ? VISITOR : SAM,
        embedder: 'm',
        timing: 0.95,
        scores: new Map([[joSeat.id, joScore]]),
      }));
    return { meeting, joPerson, samPerson, joSeat, samSeat, rows, scored };
  }
  const autoOf = async (personId: string) =>
    (await test.db.select().from(voiceSamples).where(eq(voiceSamples.personId, personId))).filter(
      (s) => s.source === 'auto',
    );

  it('gives a clean line that is clearly not the ready person to the other person', async () => {
    const { meeting, samPerson, scored } = await pair();
    expect(await autoLearn(test.db, meeting.id, scored, true)).toBe(4);
    const auto = await autoOf(samPerson.id);
    expect(auto).toHaveLength(4);
    expect(auto.every((s) => s.language === 'nl')).toBe(true);
  });

  it('does nothing when learning is off or nobody is ready', async () => {
    const off = await pair();
    expect(await autoLearn(test.db, off.meeting.id, off.scored, false)).toBe(0);
    const notReady = await pair({ ready: false });
    expect(await autoLearn(test.db, notReady.meeting.id, notReady.scored, true)).toBe(0);
  });

  it('wants the line to be clearly not them, relative to their threshold', async () => {
    const close = await pair({ joScore: 0.5 });
    expect(await autoLearn(test.db, close.meeting.id, close.scored, true)).toBe(0);
    const far = await pair({ joScore: 0.4 });
    expect(await autoLearn(test.db, far.meeting.id, far.scored, true)).toBe(4);
  });

  it('skips short lines and lines somebody talks over', async () => {
    const short = await pair({ ms: 3900 });
    expect(await autoLearn(test.db, short.meeting.id, short.scored, true)).toBe(0);
    const over = await pair({ samLines: 2 });
    const [first] = over.rows.toSorted((a, b) => a.startMs - b.startMs);
    await test.db.insert(transcriptSegments).values({
      meetingId: over.meeting.id,
      participantId: over.joSeat.id,
      startMs: (first?.startMs ?? 0) + 500,
      endMs: (first?.endMs ?? 0) + 500,
      text: 'over',
    });
    expect(await autoLearn(test.db, over.meeting.id, over.scored, true)).toBe(1);
  });

  it('skips a meeting with a third person or a third voice', async () => {
    const extra = await pair({ extraPerson: true });
    expect(await autoLearn(test.db, extra.meeting.id, extra.scored, true)).toBe(0);
    // Six lines: three of Sam's voice and three of a visitor's voice, both under the label of Sam.
    const third = await pair({ third: true, samLines: 6, ms: 5000 });
    expect(await autoLearn(test.db, third.meeting.id, third.scored, true)).toBe(0);
  });

  it('skips a shared tile', async () => {
    const tile = await pair();
    await test.db
      .update(participants)
      .set({ roomCount: 2 })
      .where(eq(participants.id, tile.samSeat.id));
    expect(await autoLearn(test.db, tile.meeting.id, tile.scored, true)).toBe(0);
  });

  it('takes diarization labels only in an import whose speaker count is two', async () => {
    const counted = await pair({ source: 'diarization', speakerCount: 2 });
    expect(await autoLearn(test.db, counted.meeting.id, counted.scored, true)).toBe(4);
    const unknown = await pair({ source: 'diarization', speakerCount: null });
    expect(await autoLearn(test.db, unknown.meeting.id, unknown.scored, true)).toBe(0);
  });

  it('does not touch a person who is not tracked', async () => {
    const { meeting, samPerson, scored } = await pair();
    await stopTracking(test.db, samPerson.id);
    expect(await autoLearn(test.db, meeting.id, scored, true)).toBe(0);
    expect(await autoOf(samPerson.id)).toEqual([]);
    const [row] = await test.db.select().from(people).where(eq(people.id, samPerson.id));
    expect(row?.voicePrototypes).toEqual([]);
  });
});
