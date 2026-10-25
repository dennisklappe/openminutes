import { eq, meetings, participants, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TranscriptRow } from '../transcript-store.js';
import { applyCorrections, captureCorrections } from './corrections.js';

describe('user corrections', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  async function setup() {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 't',
        platform: 'recording',
        joinUrl: 'x',
        status: 'transcribed',
        trimStartMs: 5000,
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const [anna, bob] = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: 'Anna' },
        { meetingId: meeting.id, displayName: 'Bob' },
      ])
      .returning();
    if (!anna || !bob) throw new Error('insert failed');
    await test.db.insert(transcriptSegments).values([
      {
        meetingId: meeting.id,
        participantId: anna.id,
        startMs: 1000,
        endMs: 3000,
        text: 'a',
        speakerSource: 'user',
      },
      {
        meetingId: meeting.id,
        participantId: bob.id,
        startMs: 4000,
        endMs: 6000,
        text: 'b',
        speakerSource: 'ai',
      },
    ]);
    return { id: meeting.id, anna, bob };
  }

  const row = (
    meetingId: string,
    startMs: number,
    endMs: number,
    participantId: string,
  ): TranscriptRow => ({
    meetingId,
    participantId,
    startMs,
    endMs,
    text: 't',
    speakerSource: 'diarization',
    speakerConfidence: 0.4,
  });

  it('captures only the user rows, by speaker name and on the untrimmed time line', async () => {
    const { id } = await setup();
    expect(await captureCorrections(test.db, id, 5000)).toEqual([
      { name: 'Anna', startMs: 6000, endMs: 8000 },
    ]);
    expect(await captureCorrections(test.db, id, null)).toEqual([
      { name: 'Anna', startMs: 1000, endMs: 3000 },
    ]);
  });

  it('puts a correction on the row that lies mostly inside it, after the trim moved', async () => {
    const { id, anna, bob } = await setup();
    const corrections = await captureCorrections(test.db, id, 5000);
    const rows = [
      row(id, 1500, 3500, bob.id),
      row(id, 3800, 4800, bob.id),
      row(id, 8000, 9000, bob.id),
    ];

    const result = await applyCorrections(
      test.db,
      id,
      rows,
      corrections,
      { startMs: 4000, endMs: 20_000 },
      [],
    );

    expect(result[0]).toMatchObject({
      participantId: anna.id,
      speakerSource: 'user',
      speakerConfidence: 1,
      previousParticipantId: bob.id,
    });
    expect(result[1]).toBe(rows[1]);
    expect(result[2]).toBe(rows[2]);
  });

  it('lets the latest correction win', async () => {
    const { id, bob } = await setup();
    const result = await applyCorrections(
      test.db,
      id,
      [row(id, 0, 1000, bob.id)],
      [
        { name: 'Anna', startMs: 0, endMs: 1000 },
        { name: 'Bob', startMs: 0, endMs: 1000 },
      ],
      null,
      [],
    );
    expect(result[0]).toMatchObject({
      participantId: bob.id,
      speakerSource: 'user',
      previousParticipantId: null,
    });
  });

  it('never points at a stale speaker: it creates the corrected name for the new run', async () => {
    const { id, anna, bob } = await setup();
    const result = await applyCorrections(
      test.db,
      id,
      [row(id, 0, 2000, bob.id)],
      [{ name: 'Anna', startMs: 0, endMs: 2000 }],
      null,
      [anna.id],
    );
    const created = result[0]?.participantId;
    expect(created).toBeTruthy();
    expect(created).not.toBe(anna.id);
    const [stored] = await test.db
      .select()
      .from(participants)
      .where(eq(participants.id, created ?? ''));
    expect(stored).toMatchObject({ displayName: 'Anna', meetingId: id });
  });
});
