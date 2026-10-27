import { eq, meetings, participants, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { SummaryProvider } from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewMeetingSpeakers } from './job.js';

describe('reviewMeetingSpeakers', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  async function setup() {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 't', platform: 'recording', joinUrl: 'x', status: 'transcribed' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const [one, two] = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: 'Speaker 1' },
        { meetingId: meeting.id, displayName: 'Speaker 2' },
      ])
      .returning();
    if (!one || !two) throw new Error('insert failed');
    const candidates = [
      { participantId: one.id, score: 0.7 },
      { participantId: two.id, score: 0.3 },
    ];
    const line = (i: number, text: string, extra: object = {}) => ({
      meetingId: meeting.id,
      participantId: one.id,
      startMs: i * 4000,
      endMs: i * 4000 + 3000,
      text,
      speakerConfidence: 0.4,
      speakerSource: 'diarization' as const,
      speakerCandidates: candidates,
      ...extra,
    });
    await test.db
      .insert(transcriptSegments)
      .values([
        line(0, 'Heb je het getest?'),
        line(1, 'Ja, het werkt.'),
        line(2, 'Ja, zeker weten.', { speakerSource: 'user' }),
      ]);
    return { id: meeting.id, one, two };
  }

  const stored = (id: string) =>
    test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, id))
      .orderBy(transcriptSegments.startMs);
  const checked = async (id: string) => {
    const [meeting] = await test.db.select().from(meetings).where(eq(meetings.id, id));
    return meeting;
  };

  it('suggests the obvious answer without a model and leaves corrected lines alone', async () => {
    const { id, one, two } = await setup();
    await reviewMeetingSpeakers(
      { db: test.db, createRefiner: () => Promise.resolve(undefined) },
      id,
    );

    const rows = await stored(id);
    expect(rows.map((r) => r.participantId)).toEqual([one.id, one.id, one.id]);
    expect(rows[1]).toMatchObject({ speakerSource: 'diarization', suggestedParticipantId: two.id });
    expect(rows[2]).toMatchObject({ speakerSource: 'user', suggestedParticipantId: null });
    expect((await checked(id))?.speakerCheckedAt).toBeInstanceOf(Date);
  });

  it('uses the model when there is one and marks the meeting refined', async () => {
    const { id, one, two } = await setup();
    const provider: SummaryProvider = {
      model: 'fake',
      maxInputChars: 100_000,
      summarize: () => Promise.resolve('{"changes":[{"index":1,"speaker":"Speaker 2"}]}'),
      test: () => Promise.resolve({}),
    };
    await reviewMeetingSpeakers(
      { db: test.db, createRefiner: () => Promise.resolve(provider) },
      id,
    );

    expect((await stored(id))[1]).toMatchObject({
      participantId: one.id,
      speakerSource: 'diarization',
      suggestedParticipantId: two.id,
    });
    expect(await checked(id)).toMatchObject({ speakersRefined: true, speakerCheckError: null });
  });

  it('writes the error to the meeting instead of throwing', async () => {
    const { id } = await setup();
    await reviewMeetingSpeakers(
      { db: test.db, createRefiner: () => Promise.reject(new Error('no key')) },
      id,
    );
    expect((await checked(id))?.speakerCheckError).toBe('no key');
  });
});
