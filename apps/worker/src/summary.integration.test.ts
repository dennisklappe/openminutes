import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createConfiguredSummarizer,
  requestSummary,
  saveProviderSettings,
  SettingsStore,
} from '@openminutes/core';
import { eq, meetings, summaries, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COMPANY_INSTRUCTIONS } from './company.js';
import { runSummary } from './summary-job.js';

interface ChatRequest {
  authorization: string | undefined;
  system: string;
  user: string;
}

describe('summaries against an OpenAI-compatible HTTP server', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  let server: Server;
  let requests: ChatRequest[];

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const parsed = JSON.parse(body) as { messages: { role: string; content: string }[] };
        const content = (role: string) =>
          parsed.messages.find((m) => m.role === role)?.content ?? '';
        const asksCompany = content('system') === COMPANY_INSTRUCTIONS;
        if (!asksCompany) {
          requests.push({
            authorization: req.headers.authorization,
            system: content('system'),
            user: content('user'),
          });
        }
        const reply = asksCompany
          ? '{"company":null,"confidence":"low"}'
          : content('system').startsWith('You are given excerpt')
            ? 'note'
            : 'The summary.';
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await saveProviderSettings(settings, 'summary', 'openai-compatible', {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'stub',
      apiKey: 'sk-stub',
      maxInputChars: 200,
    });
  });
  afterAll(async () => {
    server.close();
    await test.close();
  });

  async function meetingWithLines(count: number) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 't', platform: 'meet', joinUrl: 'https://meet.google.com/abc' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    await test.db.insert(transcriptSegments).values(
      Array.from({ length: count }, (_, i) => ({
        meetingId: meeting.id,
        startMs: i * 1000,
        endMs: i * 1000 + 900,
        text: `Sentence number ${i} of the meeting.`,
      })),
    );
    return meeting.id;
  }

  async function summarise(meetingId: string) {
    const summary = await requestSummary(
      {
        db: test.db,
        settings,
        queue: { send: () => Promise.resolve() },
      },
      meetingId,
    );
    await runSummary(
      {
        db: test.db,
        settings,
        createSummarizer: async (id) => (await createConfiguredSummarizer(settings, id)).provider,
      },
      summary.id,
    );
    const [row] = await test.db.select().from(summaries).where(eq(summaries.id, summary.id));
    return row;
  }

  it('summarises a short meeting in one authenticated request', async () => {
    requests = [];
    const row = await summarise(await meetingWithLines(2));
    expect(row).toMatchObject({ status: 'done', content: 'The summary.', model: 'stub' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.authorization).toBe('Bearer sk-stub');
    expect(requests[0]?.system).toContain('## Action items');
    expect(requests[0]?.user).toBe(
      '[00:00:00] Sentence number 0 of the meeting.\n[00:00:01] Sentence number 1 of the meeting.',
    );
  });

  it('map-reduces a transcript that exceeds the input limit', async () => {
    requests = [];
    const row = await summarise(await meetingWithLines(20));
    expect(row).toMatchObject({ status: 'done', content: 'The summary.' });

    const parts = requests.filter((r) => r.system.startsWith('You are given excerpt'));
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((r) => r.user.length <= 200)).toBe(true);
    const final = requests.at(-1);
    expect(final?.system).toContain('## Decisions');
    expect(final?.system).toContain('set of notes');
    expect(final?.user).toContain('### Excerpt 1');
    expect(requests).toHaveLength(parts.length + 1);
  });

  it('records an unreachable server as a failed summary', async () => {
    await saveProviderSettings(settings, 'summary', 'openai-compatible', {
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'stub',
    });
    const row = await summarise(await meetingWithLines(1));
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('openai-compatible');
  });
});
