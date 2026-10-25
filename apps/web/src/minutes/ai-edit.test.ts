import { createProviders } from '@openminutes/calendar';
import { LocalStorage, saveProviderSettings, SettingsStore } from '@openminutes/core';
import { eq, meetings, summaries, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { AccessVerifier } from '../auth/access.js';
import { makeKey, signToken, startFakeJwks, type FakeJwks } from '../auth/access-fixtures.js';
import type { MeetingDetailDto, SummaryAiEditDto } from '../dto.js';
import { createShareLink } from './share-routes.js';

const secret = 'a-long-enough-test-secret';
const ORIGINAL = `### Summary

The team agreed to ship the release on Friday.

### Open questions

- Who owns billing?
- When is the freeze?

### Decisions

- Ship it (the full reasoning is in the notes)
`;

interface Call {
  system: string;
  user: string;
}

const section = (text: string, tag: string) =>
  new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(text)?.[1] ?? '';

const model = (calls: Call[], fail: { status?: number }) => (input: string, init?: RequestInit) => {
  const body = JSON.parse(init?.body as string) as { messages: { content: string }[] };
  const [system = '', user = ''] = body.messages.map((message) => message.content);
  calls.push({ system, user });
  if (fail.status)
    return Promise.resolve(new Response('{"error":"boom"}', { status: fail.status }));
  const summary = section(user, 'summary');
  const instruction = section(user, 'instruction');
  const answers: Record<string, string> = {
    'Remove open questions': summary.replace(/### Open questions[\s\S]*?(?=### Decisions)/, ''),
    'Make it shorter': summary.replace(/ \(the full reasoning is in the notes\)/, ''),
    'Translate to Dutch': summary.replace('### Decisions', '### Besluiten'),
    'Add the budget': `${summary}\n\n### Budget\n\nThe budget is 5k.`,
    'Return nothing': '   ',
    'Change nothing': summary,
    'Delete it all': 'Gone.',
    'Fence it': `\`\`\`markdown\n${summary.replace('Friday', 'Monday')}\n\`\`\``,
  };
  return Promise.resolve(
    new Response(
      JSON.stringify({ choices: [{ message: { content: answers[instruction] ?? summary } }] }),
    ),
  );
};

describe('edit the summary with AI', () => {
  const key = makeKey('key-1');
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let jwks: FakeJwks;
  let app: Hono;
  let settings: SettingsStore;
  let meetingId = '';
  let firstId = '';
  const calls: Call[] = [];
  const fail: { status?: number } = {};

  beforeAll(async () => {
    test = await createTestDatabase();
    jwks = await startFakeJwks([key]);
    settings = new SettingsStore(test.db, secret);
    app = createApp({
      db: test.db,
      settings,
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-ai-edit-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      access: new AccessVerifier(jwks.config),
      publicUrl: 'https://minutes.example/',
      providerDeps: { fetch: model(calls, fail) },
    });
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Planning',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'transcribed',
      })
      .returning();
    if (!meeting) throw new Error('no meeting');
    meetingId = meeting.id;
    await test.db.insert(transcriptSegments).values({
      meetingId,
      startMs: 0,
      endMs: 1000,
      text: 'The budget is five thousand',
    });
    const [summary] = await test.db
      .insert(summaries)
      .values({ meetingId, provider: 'seed', model: 'seed', status: 'done', content: ORIGINAL })
      .returning();
    if (!summary) throw new Error('no summary');
    firstId = summary.id;
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
  const edit = (instruction: string, extra: object = {}) =>
    call('POST', `/api/meetings/${meetingId}/summary/ai-edit`, {
      instruction,
      useTranscript: false,
      ...extra,
    });
  const detail = async () =>
    (await (await call('GET', `/api/meetings/${meetingId}`)).json()) as MeetingDetailDto;
  const active = async () => {
    const found = (await detail()).summaries.find((summary) => summary.active);
    if (!found) throw new Error('no active summary');
    return found;
  };
  const restore = (id: string) =>
    call('POST', `/api/meetings/${meetingId}/summaries/${id}/restore`);

  it('is unavailable until a summary provider is configured', async () => {
    expect((await detail()).summaryOptions.editModel).toBeNull();
    const response = await edit('Remove open questions');
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
    await saveProviderSettings(settings, 'summary', 'openai-compatible', {
      baseUrl: 'http://llm.test/v1',
      model: 'test-model',
      apiKey: 'k',
    });
    expect((await detail()).summaryOptions.editModel).toBe('test-model');
  });

  it('removes the open questions into a new active ai-edit version', async () => {
    const response = await edit('Remove open questions');
    expect(response.status).toBe(201);
    const result = (await response.json()) as SummaryAiEditDto;
    expect(result.previousId).toBe(firstId);
    const now = await active();
    expect(now).toMatchObject({
      id: result.summaryId,
      origin: 'ai-edit',
      note: 'Remove open questions',
      author: 'AI edit (test-model)',
      version: 2,
    });
    expect(now.content).not.toContain('Open questions');
    expect(now.content).toContain('### Decisions');
    expect(now.content).toContain('ship the release on Friday');
    expect((await detail()).summaries.find((s) => s.id === firstId)?.content).toBe(ORIGINAL);
  });

  it('sends the contract and no transcript for a pure edit', () => {
    const sent = calls.at(-1);
    expect(sent?.system).toContain('Never invent facts');
    expect(sent?.system).toContain('Never use em dashes');
    expect(sent?.user).not.toContain('<transcript>');
    expect(sent?.user).not.toContain('<earlier>');
  });

  it('shows the new version on the share page straight away', async () => {
    const row = await createShareLink(test.db, meetingId, {
      includeTranscript: false,
      expiresInDays: null,
    });
    const html = await (await app.request(`/s/${row.token}`)).text();
    expect(html).toContain('Decisions');
    expect(html).not.toContain('Who owns billing');
  });

  it('keeps context for a follow-up instruction and can include the transcript', async () => {
    expect((await edit('Add the budget', { useTranscript: true })).status).toBe(201);
    const sent = calls.at(-1)?.user ?? '';
    expect(sent).toContain('- Remove open questions');
    expect(sent).toContain('The budget is five thousand');
    expect((await active()).content).toContain('The budget is 5k.');
  });

  it('undoes an edit by restoring the previous version as a new one', async () => {
    const before = await active();
    const response = await edit('Make it shorter');
    const { previousId } = (await response.json()) as SummaryAiEditDto;
    expect(previousId).toBe(before.id);
    expect((await restore(previousId)).status).toBe(201);
    const now = await active();
    expect(now.content).toBe(before.content);
    expect(now.origin).toBe('restore');
  });

  it('translates and strips a code fence the model added', async () => {
    expect((await edit('Translate to Dutch')).status).toBe(201);
    expect((await active()).content).toContain('### Besluiten');
    expect((await edit('Fence it')).status).toBe(201);
    const { content } = await active();
    expect(content).toContain('on Monday');
    expect(content).not.toContain('```');
  });

  it('rejects bad model output and saves nothing', async () => {
    const before = (await detail()).summaries.length;
    const empty = await edit('Return nothing');
    expect(empty.status).toBe(502);
    const unchanged = await edit('Change nothing');
    expect(unchanged.status).toBe(422);
    expect((await detail()).summaries).toHaveLength(before);
  });

  it('asks for confirmation before the summary shrinks below 15 percent', async () => {
    const before = (await detail()).summaries.length;
    const refused = await edit('Delete it all');
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe('shrunk');
    expect((await detail()).summaries).toHaveLength(before);
    expect((await edit('Delete it all', { confirmShrink: true })).status).toBe(201);
    expect((await active()).content).toBe('Gone.');
    await restore(firstId);
  });

  it('guards the size of the instruction and of the model input', async () => {
    expect((await edit('x'.repeat(1001))).status).toBe(400);
    expect((await edit('   ')).status).toBe(400);
    await saveProviderSettings(settings, 'summary', 'openai-compatible', {
      baseUrl: 'http://llm.test/v1',
      model: 'test-model',
      maxInputChars: 200,
    });
    const tooLarge = await edit('Make it shorter');
    expect(tooLarge.status).toBe(413);
    await saveProviderSettings(settings, 'summary', 'openai-compatible', {
      baseUrl: 'http://llm.test/v1',
      model: 'test-model',
    });
  });

  it('reports a provider error and saves nothing', async () => {
    const before = (await detail()).summaries.length;
    fail.status = 500;
    const response = await edit('Make it shorter');
    delete fail.status;
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toContain(
      'summary provider failed',
    );
    expect((await detail()).summaries).toHaveLength(before);
  });

  it('refuses while a summary is being generated and for unknown meetings', async () => {
    const [pending] = await test.db
      .insert(summaries)
      .values({ meetingId, provider: 'x', model: 'm' })
      .returning();
    expect((await edit('Make it shorter')).status).toBe(409);
    await test.db.delete(summaries).where(eq(summaries.id, pending?.id ?? ''));
    const missing = await call('POST', `/api/meetings/${crypto.randomUUID()}/summary/ai-edit`, {
      instruction: 'x',
    });
    expect(missing.status).toBe(404);
  });

  it('plans the edits to re-apply and stores them on a regenerated summary', async () => {
    await restore(firstId);
    await edit('Remove open questions');
    await edit('Make it shorter');
    expect((await detail()).summaryOptions.reapply).toEqual({
      instructions: ['Remove open questions', 'Make it shorter'],
      manualEdits: false,
    });
    await call('POST', `/api/meetings/${meetingId}/summaries/edit`, { content: 'By hand' });
    expect((await detail()).summaryOptions.reapply.manualEdits).toBe(true);
    const response = await call('POST', `/api/meetings/${meetingId}/summaries`, {
      reapplyEdits: true,
    });
    expect(response.status).toBe(202);
    const [pending] = await test.db.select().from(summaries).where(eq(summaries.status, 'pending'));
    expect(JSON.parse(pending?.replay ?? '[]')).toEqual([
      'Remove open questions',
      'Make it shorter',
    ]);
    await test.db.delete(summaries).where(eq(summaries.status, 'pending'));
  });

  it('limits how often a meeting can be edited', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 25; attempt++) {
      statuses.push((await edit('Change nothing')).status);
    }
    expect(statuses).toContain(429);
  });
});
