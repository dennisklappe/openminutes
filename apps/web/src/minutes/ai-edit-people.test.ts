import { createProviders } from '@openminutes/calendar';
import { LocalStorage, saveProviderSettings, SettingsStore } from '@openminutes/core';
import { eq, meetings, participants, summaries } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { AccessVerifier } from '../auth/access.js';
import { makeKey, signToken, startFakeJwks, type FakeJwks } from '../auth/access-fixtures.js';
import type { MeetingDetailDto, ParticipantsDto, SummaryAiEditDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const ORIGINAL =
  '### Summary\n\nThe team agreed to ship on Friday.\n\n### Open questions\n\n- Who?\n';

const section = (text: string, tag: string) =>
  new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(text)?.[1] ?? '';

const people = (instruction: string, user: string): unknown[] => {
  const id = /^(\S+) \| Dennis$/m.exec(section(user, 'people'))?.[1] ?? '';
  const answers: Record<string, unknown[]> = {
    'Remove dana': [{ type: 'dismiss', email: 'dana@example.com' }],
    'Jan was there': [{ type: 'link', email: 'dana@example.com', participantId: id }],
    'Remove a stranger': [{ type: 'dismiss', email: 'stranger@example.com' }],
    'Remove Anna and shorten': [{ type: 'dismiss', email: 'anna@example.com' }],
  };
  return answers[instruction] ?? [];
};

const model = () => (_input: string, init?: RequestInit) => {
  const body = JSON.parse(init?.body as string) as { messages: { content: string }[] };
  const [system = '', user = ''] = body.messages.map((message) => message.content);
  const instruction = section(user, 'instruction');
  const content = system.includes('people lists')
    ? JSON.stringify({ actions: people(instruction, user) })
    : instruction === 'Remove Anna and shorten'
      ? section(user, 'summary').replace('### Open questions\n\n- Who?', '')
      : section(user, 'summary');
  return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content } }] })));
};

describe('edit the people with AI', () => {
  const key = makeKey('key-1');
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let jwks: FakeJwks;
  let app: Hono;
  let meetingId = '';
  let personId = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    jwks = await startFakeJwks([key]);
    const settings = new SettingsStore(test.db, secret);
    await saveProviderSettings(settings, 'summary', 'openai-compatible', {
      baseUrl: 'http://llm.test/v1',
      model: 'test-model',
      apiKey: 'k',
    });
    app = createApp({
      db: test.db,
      settings,
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-ai-people-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      access: new AccessVerifier(jwks.config),
      publicUrl: 'https://minutes.example/',
      providerDeps: { fetch: model() },
    });
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Planning',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'transcribed',
        invitees: [
          { email: 'dana@example.com', name: null, declined: false },
          { email: 'anna@example.com', name: 'Anna', declined: false },
        ],
      })
      .returning();
    if (!meeting) throw new Error('no meeting');
    meetingId = meeting.id;
    const [person] = await test.db
      .insert(participants)
      .values({ meetingId, displayName: 'Jan' })
      .returning();
    personId = person?.id ?? '';
    await test.db
      .insert(summaries)
      .values({ meetingId, provider: 'seed', model: 'seed', status: 'done', content: ORIGINAL });
  });
  afterAll(async () => {
    await jwks.close();
    await test.close();
  });

  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        'cf-access-jwt-assertion': signToken(key),
        origin: 'http://localhost',
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const edit = (instruction: string) =>
    call('POST', `/api/meetings/${meetingId}/summary/ai-edit`, {
      instruction,
      useTranscript: false,
    });
  const absent = async () =>
    (
      (await (
        await call('GET', `/api/meetings/${meetingId}/participants`)
      ).json()) as ParticipantsDto
    ).absent.map((invitee) => invitee.email);
  const versions = async () =>
    ((await (await call('GET', `/api/meetings/${meetingId}`)).json()) as MeetingDetailDto).summaries
      .length;

  it('says people can be edited too when nothing changed', async () => {
    const response = await edit('Remove a stranger');
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toContain('Unable to attend');
    expect(await absent()).toEqual(['dana@example.com', 'anna@example.com']);
  });

  it('changes only the people without writing a summary version', async () => {
    const before = await versions();
    const response = await edit('Remove dana');
    expect(response.status).toBe(201);
    const result = (await response.json()) as SummaryAiEditDto;
    expect(result.summaryId).toBeUndefined();
    expect(result.people).toEqual(['Removed dana@example.com from Unable to attend']);
    expect(await absent()).toEqual(['anna@example.com']);
    expect(await versions()).toBe(before);
  });

  it('marks an invitee as present by linking them to a participant', async () => {
    await test.db
      .update(meetings)
      .set({ dismissedInvitees: null })
      .where(eq(meetings.id, meetingId));
    const response = await edit('Jan was there');
    expect(response.status).toBe(201);
    expect(((await response.json()) as SummaryAiEditDto).people).toHaveLength(1);
    const [person] = await test.db.select().from(participants).where(eq(participants.id, personId));
    expect(person?.inviteeEmail).toBe('dana@example.com');
    expect(await absent()).toEqual(['anna@example.com']);
  });

  it('does both when the instruction changes people and the summary', async () => {
    const before = await versions();
    const response = await edit('Remove Anna and shorten');
    expect(response.status).toBe(201);
    const result = (await response.json()) as SummaryAiEditDto;
    expect(result.summaryId).toBeDefined();
    expect(result.people).toHaveLength(1);
    expect(await absent()).toEqual([]);
    expect(await versions()).toBe(before + 1);
  });
});
