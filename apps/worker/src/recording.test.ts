import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AudioStorage, LocalStorage, rememberVoice } from '@openminutes/core';
import {
  audioFiles,
  eq,
  people,
  meetings,
  participants,
  transcriptSegments,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Segment, SummaryProvider } from '@openminutes/providers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DiarizationResult, DiarizeOptions, Diarizer } from '@openminutes/providers';
import { processMeeting, type ProcessDeps } from './process.js';

const words = (text: string, startMs: number, stepMs = 400): Segment['words'] =>
  text.split(' ').map((word, i) => ({
    text: word,
    startMs: startMs + i * stepMs,
    endMs: startMs + (i + 1) * stepMs - 50,
  }));

const segment = (text: string, startMs: number, speaker?: string): Segment => {
  const parts = words(text, startMs) ?? [];
  return {
    startMs,
    endMs: parts.at(-1)?.endMs ?? startMs,
    text,
    words: parts,
    ...(speaker ? { speaker } : {}),
  };
};

const CONVERSATION = [
  segment('Hello everyone this is the weekly update.', 0),
  segment('Thanks Anna I have a question about the budget.', 6000),
  segment('Sure Mark go ahead and ask it.', 12_000),
];

const DIARIZATION: DiarizationResult = {
  speakers: [
    { id: 7, embedding: [0, 1, 0], durationMs: 5000 },
    { id: 3, embedding: [1, 0, 0], durationMs: 9000 },
  ],
  turns: [
    { startMs: 0, endMs: 5800, speaker: 3 },
    { startMs: 5900, endMs: 11_800, speaker: 7 },
    { startMs: 11_900, endMs: 16_000, speaker: 3 },
  ],
};

describe('processMeeting for phone recordings', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: LocalStorage;
  let segments: Segment[];
  let diarizerCalls: string[];
  let diarizerOptions: DiarizeOptions[];
  let diarizerOutcome: DiarizationResult | undefined | Error;
  let remember: boolean;
  let suggester: SummaryProvider | undefined;
  let suggesterRequests: string[];
  let suggesterReply: string | Error;

  const diarizer: Diarizer = {
    diarize: ({ path }, options = {}) => {
      diarizerCalls.push(path);
      diarizerOptions.push(options);
      return diarizerOutcome instanceof Error
        ? Promise.reject(diarizerOutcome)
        : Promise.resolve(diarizerOutcome);
    },
    embed: () => Promise.resolve(undefined),
    embedEach: () => Promise.resolve(undefined),
  };

  const deps = (withRecording = true): ProcessDeps => ({
    db: test.db,
    loadStorage: () => Promise.resolve(new AudioStorage(storage)),
    mergeAudio: (_inputs, output) => writeFile(output, 'merged'),
    trimAudio: (_input, output) => writeFile(output, 'trimmed'),
    detectSilence: () => Promise.resolve([]),
    requestSummary: () => Promise.resolve(),
    createRefiner: () => Promise.resolve(undefined),
    createTranscriber: () =>
      Promise.resolve({
        transcribe: () => Promise.resolve(segments),
        test: () => Promise.resolve({}),
      }),
    ...(withRecording
      ? {
          recording: {
            createDiarizer: () => Promise.resolve(diarizer),
            voicesRemembered: () => Promise.resolve(remember),
            voicesChecked: () => Promise.resolve(false),
            createSuggester: () => Promise.resolve(suggester),
          },
        }
      : {}),
  });

  beforeAll(async () => {
    test = await createTestDatabase();
    storage = new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-recording-')));
  });
  afterAll(() => test.close());

  beforeEach(async () => {
    segments = CONVERSATION;
    diarizerCalls = [];
    diarizerOptions = [];
    diarizerOutcome = DIARIZATION;
    remember = false;
    suggesterRequests = [];
    suggesterReply = '{"names":[]}';
    suggester = {
      model: 'm',
      maxInputChars: 10_000,
      summarize: (input) => {
        suggesterRequests.push(input);
        return suggesterReply instanceof Error
          ? Promise.reject(suggesterReply)
          : Promise.resolve(suggesterReply);
      },
      test: () => Promise.resolve({}),
    };
    await test.db.delete(people);
  });

  async function insertMeeting(
    platform: 'recording' | 'meet' = 'recording',
    speakerCount: number | null = null,
  ) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 't', platform, joinUrl: 'x', status: 'ended', speakerCount })
      .returning();
    if (!meeting) throw new Error('insert failed');
    await storage.ensureDirectory(`meetings/${meeting.id}`);
    await test.db.insert(audioFiles).values({
      meetingId: meeting.id,
      path: `meetings/${meeting.id}/000.opus`,
      durationMs: 20_000,
      codec: 'opus',
      size: 1,
    });
    return meeting.id;
  }

  const load = async (id: string) => {
    const people = await test.db.select().from(participants).where(eq(participants.meetingId, id));
    const rows = await test.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, id))
      .orderBy(transcriptSegments.startMs);
    const nameOf = new Map(people.map((p) => [p.id, p.displayName]));
    return {
      people,
      rows,
      speakers: rows.map((row) => (row.participantId && nameOf.get(row.participantId)) || null),
    };
  };

  const status = async (id: string) =>
    (await test.db.select().from(meetings).where(eq(meetings.id, id)))[0]?.status;

  it('creates speakers by speaking time with embeddings and labels the transcript', async () => {
    const id = await insertMeeting();
    await processMeeting(deps(), id);

    const { people, speakers } = await load(id);
    expect(await status(id)).toBe('transcribed');
    expect(diarizerCalls).toHaveLength(1);
    expect(people.map((p) => p.displayName).sort()).toEqual(['Speaker 1', 'Speaker 2']);
    const first = people.find((p) => p.displayName === 'Speaker 1');
    expect(first?.voiceEmbedding).toEqual([1, 0, 0]);
    expect(first?.nameConfirmed).toBe(false);
    expect(speakers).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1']);
  });

  it('tells the diarizer how many people talk when the meeting says so', async () => {
    await processMeeting(deps(), await insertMeeting('recording', 3));
    expect(diarizerOptions).toEqual([{ numSpeakers: 3 }]);
  });

  it('lets the diarizer find the number of people on its own by default', async () => {
    await processMeeting(deps(), await insertMeeting());
    expect(diarizerOptions).toEqual([{}]);
  });

  it('prefers speaker labels from the transcription provider over the diarizer', async () => {
    segments = [
      segment('Hello everyone this is the weekly update.', 0, 'Speaker 2'),
      segment('Thanks Anna I have a question about the budget.', 6000, 'Speaker 1'),
      segment('Sure Mark go ahead and ask it.', 12_000, 'Speaker 2'),
    ];
    const id = await insertMeeting();
    await processMeeting(deps(), id);

    const { people, speakers } = await load(id);
    expect(diarizerCalls).toHaveLength(0);
    expect(people.every((p) => p.voiceEmbedding === null)).toBe(true);
    expect(speakers).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1']);
  });

  it.each([
    ['fails', new Error('service down')],
    ['has no result', undefined],
  ])('keeps the transcript unlabelled when the diarizer %s', async (_name, outcome) => {
    diarizerOutcome = outcome;
    const id = await insertMeeting();
    await processMeeting(deps(), id);

    const { people, rows } = await load(id);
    expect(await status(id)).toBe('transcribed');
    expect(people).toHaveLength(0);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.participantId === null)).toBe(true);
  });

  it('keeps the transcript unlabelled without a diarizer configured', async () => {
    const id = await insertMeeting();
    await processMeeting(deps(false), id);
    expect((await load(id)).people).toHaveLength(0);
    expect(await status(id)).toBe('transcribed');
  });

  it('does nothing for meetings that are not recordings', async () => {
    const id = await insertMeeting('meet');
    await processMeeting(deps(), id);
    expect(diarizerCalls).toHaveLength(0);
    expect((await load(id)).people).toHaveLength(0);
  });

  it('replaces the speakers of an earlier run when reprocessing', async () => {
    const id = await insertMeeting();
    await processMeeting(deps(), id);
    const before = (await load(id)).people.map((p) => p.id);
    await test.db.update(meetings).set({ status: 'transcribed' }).where(eq(meetings.id, id));
    await processMeeting(deps(), id);

    const { people, speakers } = await load(id);
    expect(people).toHaveLength(2);
    expect(people.some((p) => before.includes(p.id))).toBe(false);
    expect(speakers).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1']);
  });

  describe('names entered before a re-run', () => {
    async function nameBoth(id: string, embeddings: boolean) {
      const { people } = await load(id);
      for (const [displayName, name] of [
        ['Speaker 1', 'Marcus'],
        ['Speaker 2', 'Dana'],
      ] as const) {
        const person = people.find((p) => p.displayName === displayName);
        if (!person) throw new Error('speaker missing');
        await test.db
          .update(participants)
          .set({
            displayName: name,
            nameConfirmed: true,
            ...(embeddings ? {} : { voiceEmbedding: null }),
          })
          .where(eq(participants.id, person.id));
      }
      await test.db.update(meetings).set({ status: 'transcribed' }).where(eq(meetings.id, id));
    }

    it('keeps the names of voices that sound the same', async () => {
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      await nameBoth(id, true);
      await processMeeting(deps(), id);

      const { people, speakers } = await load(id);
      expect(speakers).toEqual(['Marcus', 'Dana', 'Marcus']);
      expect(people.map((p) => p.nameConfirmed)).toEqual([true, true]);
    });

    it('falls back to who spoke at the same moments', async () => {
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      await nameBoth(id, false);
      await processMeeting(deps(), id);

      expect((await load(id)).speakers).toEqual(['Marcus', 'Dana', 'Marcus']);
    });

    const swapped = (embeddings: [number[], number[]]): DiarizationResult => ({
      speakers: [
        { id: 7, embedding: embeddings[0], durationMs: 9000 },
        { id: 3, embedding: embeddings[1], durationMs: 5000 },
      ],
      turns: [
        { startMs: 0, endMs: 5800, speaker: 7 },
        { startMs: 5900, endMs: 11_800, speaker: 3 },
        { startMs: 11_900, endMs: 16_000, speaker: 7 },
      ],
    });

    it('follows the people when the clusters come back renumbered', async () => {
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      await nameBoth(id, true);
      diarizerOutcome = swapped([
        [1, 0, 0],
        [0, 1, 0],
      ]);
      await processMeeting(deps(), id);

      expect((await load(id)).speakers).toEqual(['Marcus', 'Dana', 'Marcus']);
    });

    it('trusts who spoke when over embeddings that moved', async () => {
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      await nameBoth(id, true);
      diarizerOutcome = swapped([
        [0, 0, 1],
        [0, 0, -1],
      ]);
      await processMeeting(deps(), id);

      const { people, speakers } = await load(id);
      expect(speakers).toEqual(['Marcus', 'Dana', 'Marcus']);
      expect(people.every((p) => p.nameConfirmed)).toBe(true);
    });

    it('never drops a confirmed name: it stays on the closest voice, unconfirmed', async () => {
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      await nameBoth(id, true);
      diarizerOutcome = {
        speakers: [
          { id: 1, embedding: [0, 0, 1], durationMs: 9000 },
          { id: 2, embedding: [0, 0, -1], durationMs: 5000 },
        ],
        turns: [
          { startMs: 40_000, endMs: 45_000, speaker: 1 },
          { startMs: 50_000, endMs: 55_000, speaker: 2 },
        ],
      };
      await processMeeting(deps(), id);

      const { people } = await load(id);
      expect(people.map((p) => p.displayName).toSorted()).toEqual(['Dana', 'Marcus']);
      expect(people.every((p) => !p.nameConfirmed)).toBe(true);
    });

    it('leaves a voice nobody named as a numbered speaker', async () => {
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      const { people } = await load(id);
      const first = people.find((p) => p.displayName === 'Speaker 1');
      await test.db
        .update(participants)
        .set({ displayName: 'Marcus', nameConfirmed: true })
        .where(eq(participants.id, first?.id ?? ''));
      await test.db.update(meetings).set({ status: 'transcribed' }).where(eq(meetings.id, id));
      await processMeeting(deps(), id);

      const after = await load(id);
      expect(after.speakers).toEqual(['Marcus', 'Speaker 2', 'Marcus']);
      expect(after.people.map((p) => p.nameConfirmed).toSorted()).toEqual([false, true]);
    });
  });

  describe('name suggestions', () => {
    const suggestionsOf = async (id: string) =>
      Object.fromEntries((await load(id)).people.map((p) => [p.displayName, p.nameSuggestions]));

    it('suggests known voices only when voices are remembered', async () => {
      await rememberVoice(test.db, 'Anna', [0.9, 0.1, 0]);
      await rememberVoice(test.db, 'Bram', [0, 0, 1]);
      const without = await insertMeeting();
      await processMeeting(deps(), without);
      expect((await suggestionsOf(without))['Speaker 1']).toBeNull();

      remember = true;
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      const suggestions = await suggestionsOf(id);
      expect(suggestions['Speaker 1']).toEqual([{ name: 'Anna', source: 'voice' }]);
      expect(suggestions['Speaker 2']).toBeNull();
      const { people } = await load(id);
      expect(people.every((p) => p.displayName.startsWith('Speaker'))).toBe(true);
    });

    it('suggests names spoken in the conversation', async () => {
      suggesterReply =
        'Here: {"names":[{"speaker":"Speaker 2","name":"Anna"},{"speaker":"Speaker 1","name":"Mark"}]}';
      const id = await insertMeeting();
      await processMeeting(deps(), id);

      const suggestions = await suggestionsOf(id);
      expect(suggestions['Speaker 2']).toEqual([{ name: 'Anna', source: 'conversation' }]);
      expect(suggestions['Speaker 1']).toEqual([{ name: 'Mark', source: 'conversation' }]);
      expect(suggesterRequests[0]).toContain('Speaker 1: Hello everyone');
    });

    it('limits conversation suggestions to two per speaker', async () => {
      suggesterReply = JSON.stringify({
        names: ['Anna', 'Mark', 'Anna'].map((name) => ({ speaker: 'Speaker 1', name })),
      });
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      const names = (await suggestionsOf(id))['Speaker 1']?.map((s) => s.name);
      expect(names).toEqual(['Anna', 'Mark']);
    });

    it('puts a voice match before the same name from the conversation', async () => {
      remember = true;
      await rememberVoice(test.db, 'anna', [1, 0, 0]);
      suggesterReply = '{"names":[{"speaker":"Speaker 1","name":"Anna"}]}';
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      expect((await suggestionsOf(id))['Speaker 1']).toEqual([{ name: 'anna', source: 'voice' }]);
    });

    it.each([
      ['not JSON', 'I think Anna is Speaker 1'],
      ['an unknown speaker', '{"names":[{"speaker":"Speaker 9","name":"Anna"}]}'],
      [
        'a name that is not in the transcript',
        '{"names":[{"speaker":"Speaker 1","name":"Peter"}]}',
      ],
      [
        'one bad entry among good ones',
        '{"names":[{"speaker":"Speaker 1","name":"Anna"},{"speaker":"Speaker 2","name":"Peter"}]}',
      ],
      ['no names list', '{"people":[]}'],
    ])('stores none for %s', async (_name, reply) => {
      suggesterReply = reply;
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      expect(await status(id)).toBe('transcribed');
      expect(Object.values(await suggestionsOf(id)).every((s) => s === null)).toBe(true);
    });

    it('keeps voice suggestions when the conversation call fails', async () => {
      remember = true;
      await rememberVoice(test.db, 'Anna', [1, 0, 0]);
      suggesterReply = new Error('quota');
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      expect((await suggestionsOf(id))['Speaker 1']).toEqual([{ name: 'Anna', source: 'voice' }]);
    });

    it('does not call the model without a summary provider', async () => {
      suggester = undefined;
      const id = await insertMeeting();
      await processMeeting(deps(), id);
      expect(suggesterRequests).toHaveLength(0);
      expect((await load(id)).people).toHaveLength(2);
    });
  });
});
