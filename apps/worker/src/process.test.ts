import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import {
  addVoiceSamples,
  AudioStorage,
  ensurePerson,
  LocalStorage,
  mergedAudioPath,
  originalAudioPath,
  S3Storage,
  type SilentRange,
  SummaryNotConfiguredError,
} from '@openminutes/core';
import {
  audioFiles,
  eq,
  meetings,
  participants,
  roomVoices,
  speakerEvents,
  transcriptSegments,
} from '@openminutes/db';
import { startFakeS3 } from '@openminutes/core/testing';
import { createTestDatabase } from '@openminutes/db/testing';
import type {
  Diarizer,
  Segment,
  SummaryProvider,
  TranscriptionProvider,
} from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processMeeting, type ProcessDeps } from './process.js';

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

describe('processMeeting', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: LocalStorage;
  let merges: { inputs: string[]; output: string }[];
  let trims: { input: string; output: string; range: unknown }[];
  let transcribed: string[];
  let outcome: Segment[] | Error;
  let summaryRequests: string[];
  let summaryError: Error | undefined;
  let refiner: SummaryProvider | undefined;
  let silences: SilentRange[];
  let fallback: Segment[] | undefined;
  let detected: string | undefined;
  let languages: (string | undefined)[];

  const deps = (): ProcessDeps => ({
    db: test.db,
    loadStorage: () => Promise.resolve(new AudioStorage(storage)),
    mergeAudio: async (inputs, output) => {
      merges.push({ inputs, output });
      await writeFile(output, 'merged');
    },
    trimAudio: async (input, output, range) => {
      trims.push({ input, output, range });
      await writeFile(output, 'trimmed');
    },
    detectSilence: () => Promise.resolve(silences),
    detectLanguage: () => Promise.resolve(detected),
    requestSummary: (meetingId) => {
      summaryRequests.push(meetingId);
      return summaryError ? Promise.reject(summaryError) : Promise.resolve();
    },
    createRefiner: () => Promise.resolve(refiner),
    createFallbackTranscriber: () =>
      Promise.resolve<TranscriptionProvider | undefined>(
        fallback && {
          transcribe: () => Promise.resolve(fallback ?? []),
          test: () => Promise.resolve({}),
        },
      ),
    createTranscriber: () =>
      Promise.resolve<TranscriptionProvider>({
        transcribe: (audio, options) => {
          transcribed.push(audio.path);
          languages.push(options?.language);
          return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
        },
        test: () => Promise.resolve({}),
      }),
  });

  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-worker-')));
  });
  afterAll(() => test.close());

  async function insertMeeting(
    status: typeof meetings.$inferInsert.status,
    files: string[],
    durationMs = 1000,
  ) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 't', platform: 'meet', joinUrl: 'https://meet.google.com/abc', status })
      .returning();
    if (!meeting) throw new Error('insert failed');
    await storage.ensureDirectory(`meetings/${meeting.id}`);
    for (const name of files) {
      await test.db.insert(audioFiles).values({
        meetingId: meeting.id,
        path: `meetings/${meeting.id}/${name}`,
        durationMs,
        codec: 'opus',
        size: 1,
      });
    }
    return meeting.id;
  }

  const load = async (id: string) => {
    const [meeting] = await test.db.select().from(meetings).where(eq(meetings.id, id));
    if (!meeting) throw new Error('meeting missing');
    const segments = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, id))
      .orderBy(transcriptSegments.startMs);
    return { meeting, segments };
  };

  const reset = (next: Segment[] | Error = []) => {
    merges = [];
    trims = [];
    transcribed = [];
    summaryRequests = [];
    summaryError = undefined;
    refiner = undefined;
    silences = [];
    fallback = undefined;
    detected = undefined;
    languages = [];
    outcome = next;
  };

  it('merges the segments in order, transcribes and stores the result', async () => {
    reset([
      { startMs: 0, endMs: 1500, text: 'Hello.', confidence: 0.9 },
      { startMs: 1500, endMs: 3000, text: 'World.' },
    ]);
    const id = await insertMeeting('ended', ['001.opus', '000.opus']);
    await processMeeting(deps(), id);

    expect(merges).toHaveLength(1);
    expect(merges[0]?.inputs.map((p) => p.slice(-8))).toEqual(['000.opus', '001.opus']);
    expect(merges[0]?.output).toBe(storage.absolutePath(originalAudioPath(id)));
    expect(transcribed).toEqual([storage.absolutePath(originalAudioPath(id))]);
    expect(trims).toEqual([]);
    expect(await storage.exists(mergedAudioPath(id))).toBe(true);
    expect(await storage.exists(originalAudioPath(id))).toBe(false);

    const { meeting, segments } = await load(id);
    expect(meeting).toMatchObject({ status: 'transcribed', error: null });
    expect(segments.map((s) => [s.text, s.participantId, s.confidence])).toEqual([
      ['Hello.', null, 0.9],
      ['World.', null, null],
    ]);
  });

  it('starts a summary after transcribing, and a summary problem never fails the meeting', async () => {
    reset([{ startMs: 0, endMs: 1000, text: 'Hello.' }]);
    const id = await insertMeeting('ended', ['000.opus']);
    await processMeeting(deps(), id);
    expect(summaryRequests).toEqual([id]);

    summaryError = new SummaryNotConfiguredError();
    await processMeeting(deps(), id);
    summaryError = new Error('queue down');
    await processMeeting(deps(), id);
    expect((await load(id)).meeting.status).toBe('transcribed');
  });

  it('does not summarise an empty transcript or a failed run', async () => {
    reset([]);
    await processMeeting(deps(), await insertMeeting('ended', ['000.opus']));
    reset(new Error('boom'));
    await processMeeting(deps(), await insertMeeting('ended', ['000.opus']));
    expect(summaryRequests).toEqual([]);
  });

  it('assigns segments to the participant who was speaking', async () => {
    reset([
      { startMs: 0, endMs: 2000, text: 'Alice talking.' },
      { startMs: 2000, endMs: 4000, text: 'Bob talking.' },
      { startMs: 4000, endMs: 5000, text: 'Nobody.' },
    ]);
    const id = await insertMeeting('ended', ['000.opus']);
    const people = await test.db
      .insert(participants)
      .values([
        { meetingId: id, displayName: 'Alice' },
        { meetingId: id, displayName: 'Bob' },
      ])
      .returning();
    const [alice, bob] = people;
    if (!alice || !bob) throw new Error('insert failed');
    await test.db.insert(speakerEvents).values([
      { meetingId: id, participantId: alice.id, startMs: 0, endMs: 1900 },
      { meetingId: id, participantId: bob.id, startMs: 2100, endMs: 3900 },
    ]);
    await processMeeting(deps(), id);

    const { segments } = await load(id);
    expect(segments.map((s) => s.participantId)).toEqual([alice.id, bob.id, null]);
  });

  describe('speaker refinement', () => {
    const answering = (answer: () => Promise<string>): SummaryProvider => ({
      model: 'fake',
      maxInputChars: 100_000,
      summarize: answer,
      test: () => Promise.resolve({}),
    });

    async function twoSpeakers() {
      reset([
        { startMs: 0, endMs: 2000, text: 'Hello Bob.' },
        { startMs: 2000, endMs: 4000, text: 'Thanks, Alice.' },
      ]);
      const id = await insertMeeting('ended', ['000.opus']);
      const [alice, bob] = await test.db
        .insert(participants)
        .values([
          { meetingId: id, displayName: 'Alice' },
          { meetingId: id, displayName: 'Bob' },
        ])
        .returning();
      if (!alice || !bob) throw new Error('insert failed');
      await test.db.insert(speakerEvents).values([
        { meetingId: id, participantId: alice.id, startMs: 0, endMs: 4000 },
        { meetingId: id, participantId: bob.id, startMs: 2500, endMs: 3000 },
      ]);
      return { id, alice, bob };
    }

    it('stores the corrections of the model as suggestions and flags the transcript', async () => {
      const { id, alice, bob } = await twoSpeakers();
      refiner = answering(() =>
        Promise.resolve(JSON.stringify({ changes: [{ index: 1, speaker: 'Bob' }] })),
      );
      await processMeeting(deps(), id);
      const { meeting, segments } = await load(id);
      expect(segments.map((s) => s.participantId)).toEqual([alice.id, alice.id]);
      expect(segments[1]).toMatchObject({
        speakerSource: 'indicator',
        suggestedParticipantId: bob.id,
        text: 'Thanks, Alice.',
      });
      expect(meeting.speakersRefined).toBe(true);
      expect(meeting.speakerCheckedAt).toBeInstanceOf(Date);
    });

    it('keeps the aligned labels when the model fails or names a stranger', async () => {
      const { id, alice } = await twoSpeakers();
      refiner = answering(() => Promise.reject(new Error('rate limited')));
      await processMeeting(deps(), id);
      let loaded = await load(id);
      expect(loaded.segments.map((s) => s.participantId)).toEqual([alice.id, alice.id]);
      expect(loaded.meeting).toMatchObject({
        speakersRefined: false,
        status: 'transcribed',
        speakerCheckError: 'The model gave no usable answer',
      });

      refiner = answering(() =>
        Promise.resolve(JSON.stringify({ changes: [{ index: 1, speaker: 'Carol' }] })),
      );
      await processMeeting(deps(), id);
      loaded = await load(id);
      expect(loaded.segments.map((s) => s.participantId)).toEqual([alice.id, alice.id]);
      expect(loaded.meeting.speakersRefined).toBe(false);
    });

    describe('voice check', () => {
      const diarizer = (embeddings: number[][]): Diarizer => ({
        diarize: () => Promise.resolve(undefined),
        embed: () => Promise.resolve(undefined),
        embedEach: () => Promise.resolve({ embeddings, model: 'test' }),
      });
      const withRecording = (
        checked: boolean,
        embeddings: number[][],
        createDiarizer = () => Promise.resolve<Diarizer | undefined>(diarizer(embeddings)),
      ): ProcessDeps => ({
        ...deps(),
        recording: {
          createDiarizer,
          voicesRemembered: () => Promise.resolve(false),
          voicesChecked: () => Promise.resolve(checked),
          createSuggester: () => Promise.resolve(undefined),
        },
      });
      async function saveVoices(...names: string[]) {
        for (const [i, name] of names.entries()) {
          const person = await ensurePerson(test.db, name);
          await addVoiceSamples(test.db, person.id, [
            { kind: 'imported', embedding: i === 0 ? [1, 0] : [0, 1] },
          ]);
        }
      }

      it('flags a line that sounds like the other participant and suggests them', async () => {
        const { id, alice, bob } = await twoSpeakers();
        await saveVoices('Alice', 'Bob');
        await processMeeting(
          withRecording(true, [
            [1, 0],
            [1, 0],
          ]),
          id,
        );
        const { segments } = await load(id);
        expect(segments[0]).toMatchObject({ participantId: alice.id, voiceDoubt: false });
        expect(segments[1]).toMatchObject({
          participantId: alice.id,
          voiceDoubt: false,
        });
        await processMeeting(
          withRecording(true, [
            [1, 0],
            [0, 1],
          ]),
          id,
        );
        const flagged = (await load(id)).segments[1];
        expect(flagged).toMatchObject({
          participantId: alice.id,
          voiceDoubt: true,
          suggestedParticipantId: bob.id,
        });
        expect(flagged?.speakerConfidence).toBeLessThan(0.7);
      });

      it('saves the room voices of a tile with two distinct voices', async () => {
        const lines = 8;
        reset(
          Array.from({ length: lines }, (_, i) => ({
            startMs: i * 5000,
            endMs: i * 5000 + 4000,
            text: `Line ${i}.`,
          })),
        );
        const id = await insertMeeting('ended', ['000.opus']);
        const [room] = await test.db
          .insert(participants)
          .values({ meetingId: id, displayName: 'Two at a screen' })
          .returning();
        if (!room) throw new Error('insert failed');
        await test.db
          .insert(speakerEvents)
          .values({ meetingId: id, participantId: room.id, startMs: 0, endMs: lines * 5000 });
        const one = [1, 0, 0];
        const two = [0, 1, 0];
        const embeddings = Array.from({ length: lines }, (_, i) => (i < lines / 2 ? one : two));
        await processMeeting(withRecording(true, embeddings), id);
        const voices = await test.db.select().from(roomVoices).where(eq(roomVoices.meetingId, id));
        expect(voices.map((v) => v.lines).toSorted()).toEqual([4, 4]);
      });

      it('opens the real original audio for the voice check, then publishes it', async () => {
        const { id } = await twoSpeakers();
        await saveVoices('Alice', 'Bob');
        const original = storage.absolutePath(originalAudioPath(id));
        const merged = storage.absolutePath(mergedAudioPath(id));
        const seen: { path: string; exists: boolean }[] = [];
        const opening = (): Promise<Diarizer> =>
          Promise.resolve({
            diarize: () => Promise.resolve(undefined),
            embed: () => Promise.resolve(undefined),
            embedEach: async (audio) => {
              seen.push({ path: audio.path, exists: await exists(audio.path) });
              return {
                embeddings: [
                  [1, 0],
                  [0, 1],
                ],
                model: 'test',
              };
            },
          });
        await processMeeting(withRecording(true, [], opening), id);
        expect(seen).toEqual([{ path: original, exists: true }]);
        expect(await exists(merged)).toBe(true);
        expect(await exists(original)).toBe(false);
      });

      it('still publishes the audio when the voice check fails', async () => {
        const { id } = await twoSpeakers();
        await saveVoices('Alice', 'Bob');
        await processMeeting(
          withRecording(true, [], () => Promise.reject(new Error('no model'))),
          id,
        );
        expect(await exists(storage.absolutePath(mergedAudioPath(id)))).toBe(true);
        expect(await exists(storage.absolutePath(originalAudioPath(id)))).toBe(false);
        expect((await load(id)).meeting.status).toBe('transcribed');
      });

      it('changes nothing when the check is off', async () => {
        const { id } = await twoSpeakers();
        await saveVoices('Alice', 'Bob');
        await processMeeting(
          withRecording(false, [
            [1, 0],
            [0, 1],
          ]),
          id,
        );
        const { segments } = await load(id);
        expect(segments.every((s) => !s.voiceDoubt && s.voiceScores === null)).toBe(true);
      });
    });

    it('does not refine when no model is set up', async () => {
      const { id } = await twoSpeakers();
      await processMeeting(deps(), id);
      const { meeting } = await load(id);
      expect(meeting.speakersRefined).toBe(false);
      expect(meeting.speakerCheckedAt).toBeInstanceOf(Date);
    });

    it('keeps the corrections of a person through a re-run', async () => {
      const { id, alice, bob } = await twoSpeakers();
      await processMeeting(deps(), id);
      await test.db
        .update(transcriptSegments)
        .set({ participantId: bob.id, speakerSource: 'user' })
        .where(eq(transcriptSegments.text, 'Hello Bob.'));
      refiner = answering(() =>
        Promise.resolve(JSON.stringify({ changes: [{ index: 0, speaker: 'Alice' }] })),
      );
      await processMeeting(deps(), id);

      const { segments } = await load(id);
      expect(segments[0]).toMatchObject({
        text: 'Hello Bob.',
        participantId: bob.id,
        speakerSource: 'user',
        previousParticipantId: alice.id,
      });
    });
  });

  it('replaces the transcript on a re-run and merges the recording again', async () => {
    reset([{ startMs: 0, endMs: 1000, text: 'First run.' }]);
    const id = await insertMeeting('ended', ['000.opus']);
    await processMeeting(deps(), id);

    outcome = [{ startMs: 0, endMs: 1000, text: 'Second run.' }];
    await processMeeting(deps(), id);

    expect(merges).toHaveLength(2);
    const { meeting, segments } = await load(id);
    expect(meeting.status).toBe('transcribed');
    expect(segments.map((s) => s.text)).toEqual(['Second run.']);
  });

  it('records provider errors and keeps the previous transcript', async () => {
    reset([{ startMs: 0, endMs: 1000, text: 'Kept.' }]);
    const id = await insertMeeting('ended', ['000.opus']);
    await processMeeting(deps(), id);

    outcome = new Error('groq: bad key');
    await processMeeting(deps(), id);

    const { meeting, segments } = await load(id);
    expect(meeting).toMatchObject({
      status: 'failed',
      error: 'Transcription failed: groq: bad key',
    });
    expect(segments.map((s) => s.text)).toEqual(['Kept.']);
  });

  it('moves the audio to the bucket after transcribing and fetches it back for a re-run', async () => {
    const s3 = await startFakeS3({ bucket: 'openminutes', accessKeyId: 'AKIATEST' });
    try {
      const archive = new AudioStorage(
        storage,
        new S3Storage({
          endpoint: s3.endpoint,
          bucket: 'openminutes',
          region: 'us-east-1',
          accessKeyId: 'AKIATEST',
          secretAccessKey: 'shh',
        }),
      );
      reset([{ startMs: 0, endMs: 1000, text: 'Archived.' }]);
      const id = await insertMeeting('ended', ['000.opus']);
      await storage.write(`meetings/${id}/000.opus`, Buffer.from('segment'));
      const withBucket = { ...deps(), loadStorage: () => Promise.resolve(archive) };

      await processMeeting(withBucket, id);

      expect([...s3.objects.keys()].sort()).toEqual([
        `meetings/${id}/000.opus`,
        mergedAudioPath(id),
      ]);
      expect(await storage.exists(mergedAudioPath(id))).toBe(false);
      expect((await load(id)).meeting).toMatchObject({ status: 'transcribed', error: null });

      await processMeeting(withBucket, id);
      expect(merges).toHaveLength(2);
      expect(transcribed).toEqual([
        storage.absolutePath(originalAudioPath(id)),
        storage.absolutePath(originalAudioPath(id)),
      ]);
    } finally {
      await s3.close();
    }
  });

  describe('silence trimming', () => {
    const spoken: Segment[] = [
      { startMs: 90_000, endMs: 95_000, text: 'Hello.' },
      { startMs: 100_000, endMs: 104_000, text: 'See you next week.' },
    ];

    it('cuts the leading and trailing silence and stores times relative to the cut', async () => {
      reset(spoken);
      const id = await insertMeeting('ended', ['000.opus'], 330_000);
      await processMeeting(deps(), id);

      const range = { startMs: 88_000, endMs: 106_000 };
      expect(trims).toEqual([
        {
          input: storage.absolutePath(originalAudioPath(id)),
          output: storage.absolutePath(mergedAudioPath(id)),
          range,
        },
      ]);
      const { meeting, segments } = await load(id);
      expect(meeting).toMatchObject({ trimStartMs: 88_000, trimEndMs: 106_000 });
      expect(segments.map((s) => [s.startMs, s.endMs])).toEqual([
        [2000, 7000],
        [12_000, 16_000],
      ]);
      expect(await storage.exists(originalAudioPath(id))).toBe(false);
    });

    it('attributes speakers with the raw times before shifting', async () => {
      reset(spoken);
      const id = await insertMeeting('ended', ['000.opus'], 330_000);
      const [alice] = await test.db
        .insert(participants)
        .values({ meetingId: id, displayName: 'Alice' })
        .returning();
      if (!alice) throw new Error('insert failed');
      await test.db
        .insert(speakerEvents)
        .values({ meetingId: id, participantId: alice.id, startMs: 89_500, endMs: 95_500 });
      await processMeeting(deps(), id);

      const { segments } = await load(id);
      expect(segments.map((s) => s.participantId)).toEqual([alice.id, null]);
    });

    it('recomputes from the original recording instead of trimming twice', async () => {
      reset(spoken);
      const id = await insertMeeting('ended', ['000.opus'], 330_000);
      await processMeeting(deps(), id);
      await processMeeting(deps(), id);

      expect(merges).toHaveLength(2);
      expect(trims.map((t) => t.range)).toEqual([
        { startMs: 88_000, endMs: 106_000 },
        { startMs: 88_000, endMs: 106_000 },
      ]);
      const { meeting, segments } = await load(id);
      expect(meeting.trimStartMs).toBe(88_000);
      expect(segments.map((s) => s.startMs)).toEqual([2000, 12_000]);
    });

    it('clears an earlier trim when a re-run finds nothing to cut', async () => {
      reset(spoken);
      const id = await insertMeeting('ended', ['000.opus'], 330_000);
      await processMeeting(deps(), id);

      outcome = [{ startMs: 500, endMs: 329_000, text: 'All the way.' }];
      await processMeeting(deps(), id);

      const { meeting, segments } = await load(id);
      expect(meeting).toMatchObject({ trimStartMs: null, trimEndMs: null });
      expect(segments.map((s) => s.startMs)).toEqual([500]);
      expect(trims).toHaveLength(1);
    });

    it('drops speech invented in a silent stretch and trims to the real speech', async () => {
      reset([
        { startMs: 90_000, endMs: 96_000, text: 'Real words.' },
        { startMs: 230_100, endMs: 230_160, text: 'Thank you.' },
      ]);
      silences = [{ startMs: 100_000, endMs: 330_000 }];
      const id = await insertMeeting('ended', ['000.opus'], 330_000);
      await processMeeting(deps(), id);

      const { meeting, segments } = await load(id);
      expect(segments.map((s) => s.text)).toEqual(['Real words.']);
      expect(meeting).toMatchObject({ trimStartMs: 88_000, trimEndMs: 98_000 });
    });

    it('keeps all speech when silence detection fails', async () => {
      reset([{ startMs: 1000, endMs: 2000, text: 'Hello.' }]);
      const id = await insertMeeting('ended', ['000.opus'], 3000);
      await processMeeting(
        { ...deps(), detectSilence: () => Promise.reject(new Error('no ffmpeg')) },
        id,
      );

      expect((await load(id)).segments.map((s) => s.text)).toEqual(['Hello.']);
    });

    it('keeps the whole recording when nobody spoke', async () => {
      reset([]);
      const id = await insertMeeting('ended', ['000.opus'], 330_000);
      await processMeeting(deps(), id);

      expect(trims).toEqual([]);
      expect((await load(id)).meeting).toMatchObject({
        status: 'transcribed',
        trimStartMs: null,
        trimEndMs: null,
      });
      expect(await storage.exists(mergedAudioPath(id))).toBe(true);
    });
  });

  it('fails clearly when nothing was recorded', async () => {
    reset();
    const id = await insertMeeting('ended', []);
    await processMeeting(deps(), id);
    expect((await load(id)).meeting).toMatchObject({
      status: 'failed',
      error: 'Transcription failed: No audio was recorded',
    });
  });

  it('ignores meetings that are not finished or do not exist', async () => {
    reset();
    const id = await insertMeeting('recording', ['000.opus']);
    await processMeeting(deps(), id);
    await processMeeting(deps(), '00000000-0000-4000-8000-000000000000');
    expect(transcribed).toEqual([]);
    expect((await load(id)).meeting.status).toBe('recording');
  });

  describe('a made-up stretch in a good transcript', () => {
    const minute = 60_000;
    const talk = (fromMin: number, toMin: number) =>
      Array.from({ length: (toMin - fromMin) * 6 }, (_, i) => ({
        startMs: fromMin * minute + i * 10_000,
        endMs: fromMin * minute + i * 10_000 + 8000,
        text: `We talked about plan ${String(i)} and what comes next for us.`,
      }));
    const credits = Array.from({ length: 20 }, (_, i) => ({
      startMs: i * 30_000,
      endMs: i * 30_000 + 2000,
      text: 'Subtitles by Jan',
    }));

    it('is redone alone by the local service', async () => {
      reset([...credits, ...talk(10, 44)]);
      fallback = talk(0, 10);
      const id = await insertMeeting('ended', ['000.opus'], 44 * minute);
      await processMeeting(deps(), id);

      const { segments } = await load(id);
      expect(segments).toHaveLength(60 + 204);
      expect(segments.some((s) => s.text.startsWith('Subtitles'))).toBe(false);
    });

    it('is dropped without a local service', async () => {
      reset([...credits, ...talk(10, 44)]);
      const id = await insertMeeting('ended', ['000.opus'], 44 * minute);
      await processMeeting(deps(), id);

      expect((await load(id)).segments).toHaveLength(204);
    });
  });

  describe('language', () => {
    it('transcribes in the detected language and stores it', async () => {
      reset([{ startMs: 0, endMs: 1000, text: 'Hallo.' }]);
      detected = 'nl';
      const id = await insertMeeting('ended', ['000.opus']);
      await processMeeting(deps(), id);

      expect(languages).toEqual(['nl']);
      expect((await load(id)).meeting.language).toBe('nl');
    });

    it('lets a language chosen for the re-run win over detection', async () => {
      reset([{ startMs: 0, endMs: 1000, text: 'Hello.' }]);
      detected = 'nl';
      const id = await insertMeeting('ended', ['000.opus']);
      await processMeeting(deps(), id, 'en');

      expect(languages).toEqual(['en']);
      expect((await load(id)).meeting.language).toBe('en');
    });

    it('leaves it to the provider when nothing is certain', async () => {
      reset([{ startMs: 0, endMs: 1000, text: 'Hello.' }]);
      const id = await insertMeeting('ended', ['000.opus']);
      await processMeeting(deps(), id);

      expect(languages).toEqual([undefined]);
      expect((await load(id)).meeting.language).toBeNull();
    });
  });

  describe('a transcript the model made up', () => {
    const credits = Array.from({ length: 30 }, (_, i) => ({
      startMs: i * 30_000,
      endMs: i * 30_000 + 1500,
      text: i % 2 ? 'Subtitles by Jan' : 'Jan Jansen',
    }));
    const spoken = Array.from({ length: 12 }, (_, i) => ({
      startMs: i * 5000,
      endMs: i * 5000 + 4000,
      text: `Sentence number ${String(i)} of the talk.`,
    }));

    it('is redone by the local service', async () => {
      reset(credits);
      fallback = spoken;
      const id = await insertMeeting('ended', ['000.opus']);
      await processMeeting(deps(), id);

      expect((await load(id)).segments).toHaveLength(12);
      expect(summaryRequests).toEqual([id]);
    });

    it('is dropped when no local service can redo it, or it makes things up too', async () => {
      reset(credits);
      const alone = await insertMeeting('ended', ['000.opus']);
      await processMeeting(deps(), alone);
      fallback = credits;
      const again = await insertMeeting('ended', ['000.opus']);
      await processMeeting(deps(), again);

      for (const id of [alone, again]) {
        const { meeting, segments } = await load(id);
        expect(segments).toEqual([]);
        expect(meeting).toMatchObject({ status: 'transcribed', error: null });
      }
      expect(summaryRequests).toEqual([]);
    });
  });
});
