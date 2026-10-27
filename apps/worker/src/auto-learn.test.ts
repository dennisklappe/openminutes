import {
  addVoiceSamples,
  AUTO_MARGIN,
  AUTO_PER_MEETING_MS,
  AUTO_RATIO,
  AUTO_SEED_MS,
  ensurePerson,
  stopTracking,
} from '@openminutes/core';
import {
  eq,
  meetings,
  participants,
  people,
  transcriptSegments,
  voiceSamples,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { autoLearn, isNearCertain, type NearCertainInput } from './auto-learn.js';
import type { ScoredLine } from './speaker-review/voice-check.js';

const input = (extra: Partial<NearCertainInput> = {}): NearCertainInput => ({
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
  extraMargin: 0,
  ...extra,
});

describe('isNearCertain', () => {
  it('needs the indicator, a high score and a clear margin to agree', () => {
    expect(isNearCertain(input())).toBe(true);
    expect(isNearCertain(input({ source: 'diarization' }))).toBe(true);
  });

  it('never takes lines a person or an AI set, or that are short, overlapped or disputed', () => {
    for (const bad of [
      { source: 'ai' },
      { source: 'user' },
      { source: 'guess' },
      { source: null },
      { durationMs: 2900 },
      { overlapped: true },
      { disputed: true },
    ]) {
      expect(isNearCertain(input(bad))).toBe(false);
    }
  });

  it('wants an unsure indicator, a weak score or a close runner-up to count against it', () => {
    const line = (timing: number | null, own: number, other: number) => ({
      participantId: 'a',
      timing,
      scores: new Map([
        ['a', own],
        ['b', other],
      ]),
    });
    expect(isNearCertain(input({ line: line(0.8, 0.9, 0.3) }))).toBe(false);
    expect(isNearCertain(input({ line: line(null, 0.9, 0.3) }))).toBe(false);
    expect(isNearCertain(input({ line: line(0.95, 0.7, 0.1) }))).toBe(false);
    expect(isNearCertain(input({ line: line(0.95, 0.9, 0.9 - AUTO_MARGIN + 0.01) }))).toBe(false);
    expect(isNearCertain(input({ line: line(0.95, 0.9, 0.9 - AUTO_MARGIN) }))).toBe(true);
  });

  it('asks more margin of a person whose auto samples were rejected', () => {
    const line = {
      participantId: 'a',
      timing: 0.95,
      scores: new Map([
        ['a', 0.9],
        ['b', 0.9 - AUTO_MARGIN],
      ]),
    };
    expect(isNearCertain(input({ line }))).toBe(true);
    expect(isNearCertain(input({ line, extraMargin: 0.04 }))).toBe(false);
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

  it('keeps auto speech to 3 times the verified speech and 60 s per meeting', async () => {
    const ratio = await setup({ seedMs: AUTO_SEED_MS, lines: 30, ms: 4000 });
    await autoLearn(test.db, ratio.meeting.id, ratio.scored, true);
    const autoMs = (await autoSamples(ratio.person.id))
      .filter((s) => s.source === 'auto')
      .reduce((sum, s) => sum + s.durationMs, 0);
    expect(autoMs).toBeLessThanOrEqual(AUTO_PER_MEETING_MS);
    expect(autoMs).toBeLessThanOrEqual(AUTO_RATIO * AUTO_SEED_MS);

    const bigSeed = await setup({ seedMs: 600_000, lines: 30, ms: 4000 });
    await autoLearn(test.db, bigSeed.meeting.id, bigSeed.scored, true);
    const perMeeting = (await autoSamples(bigSeed.person.id))
      .filter((s) => s.source === 'auto')
      .reduce((sum, s) => sum + s.durationMs, 0);
    expect(perMeeting).toBe(AUTO_PER_MEETING_MS);
  });

  it('weighs auto samples less when the profile is built', async () => {
    const { meeting, person, scored } = await setup({ lines: 1 });
    await autoLearn(test.db, meeting.id, scored, true);
    const [row] = await test.db.select().from(people).where(eq(people.id, person.id));
    const nl = row?.voicePrototypes.find((p) => p.language === 'nl');
    expect(nl?.samples).toBeCloseTo(1 + 0.4);
  });
});
