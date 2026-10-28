import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addVoiceSamples,
  AudioStorage,
  ensurePerson,
  LocalStorage,
  mergedAudioPath,
  type JobName,
  type JobPayloads,
} from '@openminutes/core';
import { and, eq, meetings, participants, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { DiarizationResult, DiarizeOptions, Diarizer } from '@openminutes/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkMeetingVoices, rerunSpeakers, type RerunDeps } from './rerun.js';

const DIARIZATION: DiarizationResult = {
  speakers: [
    { id: 1, embedding: [1, 0], durationMs: 12_000 },
    { id: 2, embedding: [0, 1], durationMs: 8000 },
  ],
  turns: [
    { startMs: 0, endMs: 4500, speaker: 1 },
    { startMs: 5000, endMs: 9500, speaker: 2 },
    { startMs: 10_000, endMs: 14_500, speaker: 1 },
    { startMs: 15_000, endMs: 19_500, speaker: 1 },
  ],
};

describe('re-running the speakers of a finished recording', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: AudioStorage;
  let sent: { name: JobName; payload: unknown }[];
  let options: DiarizeOptions[];
  let outcome: DiarizationResult | undefined;
  let embedded: [number[] | null, number[] | null];
  let checked: boolean;
  let suggested: number;

  let watching: string;
  let stepDuringDiarize: string | null | undefined;
  const diarizer: Diarizer = {
    diarize: async (_input, o = {}) => {
      options.push(o);
      if (watching) {
        const [row] = await test.db.select().from(meetings).where(eq(meetings.id, watching));
        stepDuringDiarize = row?.processingStep;
      }
      return outcome;
    },
    embed: () => Promise.resolve(undefined),
    embedEach: () => Promise.resolve({ embeddings: [...embedded, null, null], model: 'm' }),
  };
  const deps = (): RerunDeps => ({
    db: test.db,
    queue: {
      send: (name, payload) => {
        sent.push({ name, payload });
        return Promise.resolve();
      },
    },
    loadStorage: () => Promise.resolve(storage),
    recording: {
      createDiarizer: () => Promise.resolve(diarizer),
      voicesRemembered: () => Promise.resolve(false),
      voicesChecked: () => Promise.resolve(checked),
      createSuggester: () => {
        suggested += 1;
        return Promise.resolve(undefined);
      },
    },
  });

  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new AudioStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'om-rerun-'))));
  });
  afterAll(() => test.close());
  beforeEach(() => {
    sent = [];
    options = [];
    outcome = DIARIZATION;
    embedded = [null, null];
    checked = false;
    suggested = 0;
    watching = '';
    stepDuringDiarize = undefined;
  });

  /** An over-split recording: Speaker 1 to 3 and Ann, who was named, with one line set by hand. */
  async function setup(platform: 'recording' | 'imported' = 'recording') {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Call', platform, joinUrl: 'x', status: 'processing' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const [first, second, third] = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: 'Ann', nameConfirmed: true },
        { meetingId: meeting.id, displayName: 'Speaker 2' },
        { meetingId: meeting.id, displayName: 'Speaker 3' },
      ])
      .returning();
    if (!first || !second || !third) throw new Error('insert failed');
    const line = (i: number, participantId: string, extra = {}) => ({
      meetingId: meeting.id,
      participantId,
      startMs: i * 5000,
      endMs: i * 5000 + 4500,
      text: `Line ${String(i)}`,
      speakerSource: 'diarization' as const,
      ...extra,
    });
    await test.db
      .insert(transcriptSegments)
      .values([
        line(0, first.id),
        line(1, second.id),
        line(2, third.id),
        line(3, third.id, { speakerSource: 'user' }),
      ]);
    await storage.local.write(mergedAudioPath(meeting.id), new Uint8Array([1]));
    return { meeting, first, second, third };
  }

  const load = async (meetingId: string) => {
    const people = await test.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meetingId));
    const nameOf = new Map(people.map((p) => [p.id, p.displayName]));
    const lines = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId))
      .orderBy(transcriptSegments.startMs);
    return {
      names: people.map((p) => p.displayName).sort(),
      speakers: lines.map((l) => (l.participantId && nameOf.get(l.participantId)) || null),
      lines,
    };
  };

  it('diarizes with the chosen number and moves the lines to the new voices', async () => {
    const { meeting } = await setup();
    await rerunSpeakers(deps(), { meetingId: meeting.id, speakers: 2 });

    expect(options).toEqual([{ numSpeakers: 2 }]);
    const { names, speakers, lines } = await load(meeting.id);
    // Ann goes to the voice she overlaps most. Line 3 is by hand on Speaker 3, which only that
    // line still uses, so that speaker stays.
    expect(speakers.slice(0, 3)).toEqual(['Ann', 'Speaker 2', 'Ann']);
    expect(lines.slice(0, 3).every((l) => l.speakerSource === 'diarization')).toBe(true);
    expect(speakers[3]).toBe('Speaker 3');
    expect(lines[3]?.speakerSource).toBe('user');
    expect(names).toEqual(['Ann', 'Speaker 2', 'Speaker 3']);
  });

  it('keeps a named voice and the lines set by hand on it', async () => {
    const { meeting, first } = await setup();
    await test.db
      .update(transcriptSegments)
      .set({ participantId: first.id, speakerSource: 'user' })
      .where(
        and(eq(transcriptSegments.meetingId, meeting.id), eq(transcriptSegments.text, 'Line 3')),
      );
    await rerunSpeakers(deps(), { meetingId: meeting.id, speakers: 2 });

    const { names, speakers, lines } = await load(meeting.id);
    expect(names).toEqual(['Ann', 'Speaker 2']);
    expect(speakers[3]).toBe('Ann');
    expect(lines[3]?.speakerSource).toBe('user');
  });

  it('marks speakers changed, stores the count and queues the voice check', async () => {
    const { meeting } = await setup();
    await rerunSpeakers(deps(), { meetingId: meeting.id, speakers: 2 });

    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(row?.speakerCount).toBe(2);
    expect(row?.speakersChangedAt).not.toBeNull();
    expect(row?.status).toBe('processing');
    expect(sent).toEqual([{ name: 'meeting.check-voices', payload: { meetingId: meeting.id } }]);
  });

  it('shows what it is doing and keeps the step for the voice check that follows', async () => {
    const { meeting } = await setup();
    watching = meeting.id;
    await rerunSpeakers(deps(), { meetingId: meeting.id, speakers: 2 });

    expect(stepDuringDiarize).toBe('finding-voices');
    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(row).toMatchObject({ status: 'processing', processingStep: 'checking-voices' });
  });

  it('changes nothing when the voices cannot be found, and says so', async () => {
    const { meeting } = await setup();
    outcome = undefined;
    await rerunSpeakers(deps(), { meetingId: meeting.id, speakers: 2 });

    const { names } = await load(meeting.id);
    expect(names).toEqual(['Ann', 'Speaker 2', 'Speaker 3']);
    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(row).toMatchObject({ status: 'transcribed', speakersChangedAt: null });
    expect(row?.error).toContain('Re-running the speakers failed');
    expect(sent).toEqual([]);
  });

  it('does nothing for a meeting that is not being processed', async () => {
    const { meeting } = await setup();
    await test.db.update(meetings).set({ status: 'failed' }).where(eq(meetings.id, meeting.id));
    await rerunSpeakers(deps(), { meetingId: meeting.id, speakers: 2 });
    expect(options).toEqual([]);
  });

  describe('the voice check that follows', () => {
    it('queues the speaker review and returns the meeting to transcribed when the check is off', async () => {
      const { meeting } = await setup();
      await checkMeetingVoices(deps(), { meetingId: meeting.id });

      const [row] = await test.db.select().from(meetings).where(eq(meetings.id, meeting.id));
      expect(row?.status).toBe('transcribed');
      expect(row?.processingStep).toBeNull();
      expect(row?.speakerCheckRequestedAt).not.toBeNull();
      expect(sent).toEqual([
        {
          name: 'meeting.review-speakers',
          payload: { meetingId: meeting.id },
        } satisfies { name: JobName; payload: JobPayloads['meeting.review-speakers'] },
      ]);
      expect(suggested).toBe(1);
    });

    it('re-scores lines against saved voices when the setting is on, never a line set by hand', async () => {
      const { meeting } = await setup();
      for (const [name, embedding] of [
        ['Ann', [1, 0]],
        ['Speaker 2', [0, 1]],
      ] as const) {
        const person = await ensurePerson(test.db, name);
        await addVoiceSamples(test.db, person.id, [
          { kind: 'imported', embedding: [...embedding] },
        ]);
      }
      checked = true;
      // Line 0 belongs to Ann but sounds like Speaker 2.
      embedded = [
        [0, 1],
        [0, 1],
      ];
      const embedEach = vi.spyOn(diarizer, 'embedEach');
      embedEach.mockClear();
      await checkMeetingVoices(deps(), { meetingId: meeting.id });

      expect(embedEach).toHaveBeenCalledOnce();
      const { lines } = await load(meeting.id);
      expect(lines[0]?.voiceDoubt).toBe(true);
      expect(lines[0]?.suggestedParticipantId).not.toBeNull();
      expect(lines[3]?.voiceDoubt).toBe(false);
      expect(sent.map((job) => job.name)).toEqual(['meeting.review-speakers']);
    });

    it('does not listen to the audio when the setting is off', async () => {
      const { meeting } = await setup();
      const embedEach = vi.spyOn(diarizer, 'embedEach');
      embedEach.mockClear();
      await checkMeetingVoices(deps(), { meetingId: meeting.id });
      expect(embedEach).not.toHaveBeenCalled();
    });
  });

  it('chains: a speaker re-run queues the voice check, which queues the review', async () => {
    const { meeting } = await setup('imported');
    await rerunSpeakers(deps(), { meetingId: meeting.id, speakers: 2 });
    await checkMeetingVoices(deps(), { meetingId: meeting.id });
    expect(sent.map((job) => job.name)).toEqual([
      'meeting.check-voices',
      'meeting.review-speakers',
    ]);
  });
});
