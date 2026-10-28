import { addVoiceSamples, ensurePerson, stopTracking } from '@openminutes/core';
import {
  eq,
  meetings,
  participants,
  roomVoices,
  transcriptSegments,
  voiceReviews,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ScoredLine } from './speaker-review/voice-check.js';
import { createVoiceReviews, findEnvironmentChanges } from './voice-reviews.js';

const line = (startMs: number, ms: number, own: number, participantId = 'a'): ScoredLine => ({
  startMs,
  endMs: startMs + ms,
  participantId,
  embedding: [1, 0],
  embedder: 'm',
  timing: 0.95,
  scores: new Map([[participantId, own]]),
});

describe('findEnvironmentChanges', () => {
  const bar = () => 0.6;
  const run = (lines: ScoredLine[]) => findEnvironmentChanges(lines, bar);

  it('flags a voice that does not match for most of its speech', () => {
    const lines = Array.from({ length: 8 }, (_, i) => line(i * 6000, 5000, i < 2 ? 0.8 : 0.2));
    const [found] = run(lines);
    expect(found?.participantId).toBe('a');
    expect(found?.mismatch).toBeCloseTo(0.75);
    expect(found?.lines).toHaveLength(6);
  });

  it('weighs by speech, not by lines', () => {
    const lines = [
      line(0, 30_000, 0.9),
      ...Array.from({ length: 6 }, (_, i) => line(40_000 + i * 6000, 3000, 0.2)),
    ];
    expect(run(lines)).toEqual([]);
  });

  it('asks nothing of a voice that mostly matches, or that was heard only briefly', () => {
    expect(
      run(Array.from({ length: 8 }, (_, i) => line(i * 6000, 5000, i < 5 ? 0.8 : 0.2))),
    ).toEqual([]);
    expect(run(Array.from({ length: 4 }, (_, i) => line(i * 6000, 5000, 0.1)))).toEqual([]);
    expect(run(Array.from({ length: 10 }, (_, i) => line(i * 4000, 2000, 0.1)))).toEqual([]);
  });

  it('skips a voice that has no profile to compare with', () => {
    const lines = Array.from({ length: 8 }, (_, i) => line(i * 6000, 5000, 0.1));
    expect(findEnvironmentChanges(lines, () => undefined)).toEqual([]);
  });

  it('offers the longest clean lines first and keeps the rest of the speech out of the sample', () => {
    const lines = Array.from({ length: 8 }, (_, i) => line(i * 10_000, 4000 + i * 500, 0.1));
    const [found] = findEnvironmentChanges(lines, bar, (l) => l.startMs !== 70_000);
    expect(found?.lines.map((l) => l.endMs - l.startMs)).toEqual([
      7000, 6500, 6000, 5500, 5000, 4500,
    ]);
    expect(found?.lines.some((l) => l.startMs === 70_000)).toBe(false);
  });
});

describe('createVoiceReviews', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  async function setup(opts: { lines?: number; own?: number; voices?: number } = {}) {
    const { lines = 8, own = 0.1, voices = 1 } = opts;
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'New desk', platform: 'meet', joinUrl: 'u', language: 'nl' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const people = [];
    const seats = [];
    for (let v = 0; v < voices; v++) {
      const person = await ensurePerson(test.db, `Jo ${String(v)} ${meeting.id.slice(0, 6)}`);
      await addVoiceSamples(test.db, person.id, [
        { kind: 'imported', embedding: [1, 0], durationMs: 60_000, language: 'nl' },
      ]);
      const [seat] = await test.db
        .insert(participants)
        .values({ meetingId: meeting.id, displayName: person.name, personId: person.id })
        .returning();
      people.push(person);
      if (seat) seats.push(seat);
    }
    const rows = await test.db
      .insert(transcriptSegments)
      .values(
        seats.flatMap((seat, v) =>
          Array.from({ length: lines }, (_, i) => ({
            meetingId: meeting.id,
            participantId: seat.id,
            startMs: (v * lines + i) * 6000,
            endMs: (v * lines + i) * 6000 + 5000,
            text: `Line ${String(i)}`,
            speakerConfidence: 0.95,
            speakerSource: 'indicator' as const,
          })),
        ),
      )
      .returning();
    const scored: ScoredLine[] = rows.map((row) => ({
      startMs: row.startMs,
      endMs: row.endMs,
      participantId: row.participantId ?? '',
      embedding: [0, 1],
      embedder: 'm',
      timing: 0.95,
      scores: new Map([[row.participantId ?? '', own]]),
    }));
    return { meeting, people, seats, rows, scored };
  }
  const reviews = (meetingId: string) =>
    test.db.select().from(voiceReviews).where(eq(voiceReviews.meetingId, meetingId));

  it('makes one open question per voice with the lines to play', async () => {
    const { meeting, people, seats, scored } = await setup();
    expect(await createVoiceReviews(test.db, meeting.id, scored)).toBe(1);
    const [review] = await reviews(meeting.id);
    expect(review).toMatchObject({
      participantId: seats[0]?.id,
      personId: people[0]?.id,
      status: 'open',
      language: 'nl',
      mismatch: 1,
    });
    expect(review?.sampleSegmentIds).toHaveLength(6);
  });

  it('is asked for each voice of the meeting, and only once per voice', async () => {
    const { meeting, scored } = await setup({ voices: 2 });
    expect(await createVoiceReviews(test.db, meeting.id, scored)).toBe(2);
    expect(await createVoiceReviews(test.db, meeting.id, scored)).toBe(0);
    expect(await reviews(meeting.id)).toHaveLength(2);
  });

  it('does not ask again after an answer', async () => {
    const { meeting, scored } = await setup();
    await createVoiceReviews(test.db, meeting.id, scored);
    await test.db
      .update(voiceReviews)
      .set({ status: 'confirmed', decidedAt: new Date() })
      .where(eq(voiceReviews.meetingId, meeting.id));
    expect(await createVoiceReviews(test.db, meeting.id, scored)).toBe(0);
    expect((await reviews(meeting.id))[0]?.status).toBe('confirmed');
  });

  it('asks nothing when the voice matches', async () => {
    const { meeting, scored } = await setup({ own: 0.9 });
    expect(await createVoiceReviews(test.db, meeting.id, scored)).toBe(0);
  });

  it('skips shared tiles, people who are not tracked and lines marked mixed', async () => {
    const tile = await setup();
    await test.db
      .insert(roomVoices)
      .values({
        meetingId: tile.meeting.id,
        participantId: tile.seats[0]?.id ?? '',
        number: 1,
        centroid: [1, 0],
        lines: 2,
        durationMs: 10_000,
      });
    expect(await createVoiceReviews(test.db, tile.meeting.id, tile.scored)).toBe(0);
    const off = await setup();
    await stopTracking(test.db, off.people[0]?.id ?? '');
    expect(await createVoiceReviews(test.db, off.meeting.id, off.scored)).toBe(0);
    const mixed = await setup();
    await test.db
      .update(transcriptSegments)
      .set({ mixed: 'marked' })
      .where(eq(transcriptSegments.meetingId, mixed.meeting.id));
    expect(await createVoiceReviews(test.db, mixed.meeting.id, mixed.scored)).toBe(0);
  });
});
