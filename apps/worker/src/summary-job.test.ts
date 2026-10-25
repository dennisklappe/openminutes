import { CALENDAR_LINK_RETRY, SettingsStore } from '@openminutes/core';
import {
  chatMessages,
  eq,
  meetings,
  participants,
  summaries,
  transcriptSegments,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { SummaryProvider } from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TITLE_INSTRUCTIONS } from './auto-title.js';
import { COMPANY_INSTRUCTIONS } from './company.js';
import { runSummary } from './summary-job.js';

describe('runSummary', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  let received: { input: string; prompt: string }[];
  let failure: Error | undefined;
  let tableReply: string | undefined;

  const provider: SummaryProvider = {
    model: 'm',
    maxInputChars: 10_000,
    summarize: (input, prompt) => {
      received.push({ input, prompt });
      if (failure) return Promise.reject(failure);
      if (prompt === COMPANY_INSTRUCTIONS) {
        return Promise.resolve('{"company":null,"confidence":"low"}');
      }
      return Promise.resolve(
        prompt === TITLE_INSTRUCTIONS
          ? 'Summary \u2014 Done.'
          : (tableReply ?? '## Summary\n\nDone.'),
      );
    },
    test: () => Promise.resolve({}),
  };
  const deps = () => ({ db: test.db, settings, createSummarizer: () => Promise.resolve(provider) });

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
  });
  afterAll(() => test.close());

  async function insertSummary(
    withTranscript: boolean,
    promptId?: string,
    withChat = false,
    replay?: string[],
  ) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 't', platform: 'meet', joinUrl: 'https://meet.google.com/abc' })
      .returning();
    if (!meeting) throw new Error('insert failed');
    if (withTranscript) {
      const [alice] = await test.db
        .insert(participants)
        .values({ meetingId: meeting.id, displayName: 'Alice' })
        .returning();
      await test.db.insert(transcriptSegments).values([
        {
          meetingId: meeting.id,
          participantId: alice?.id ?? null,
          startMs: 0,
          endMs: 1000,
          text: 'Hi.',
        },
        { meetingId: meeting.id, startMs: 61_000, endMs: 62_000, text: 'Bye.' },
      ]);
    }
    if (withChat) {
      await test.db.insert(chatMessages).values({
        meetingId: meeting.id,
        dedupeKey: 'c1',
        sender: 'Alice',
        text: 'Docs https://docs.example/x',
        links: ['https://docs.example/x'],
        sentAt: new Date('2026-10-22T10:00:00Z'),
        offsetMs: 5000,
      });
    }
    const [summary] = await test.db
      .insert(summaries)
      .values({
        meetingId: meeting.id,
        provider: 'fake',
        model: 'm',
        promptId: promptId ?? null,
        replay: replay ? JSON.stringify(replay) : null,
      })
      .returning();
    if (!summary) throw new Error('insert failed');
    return summary.id;
  }

  const load = async (id: string) => {
    const [row] = await test.db.select().from(summaries).where(eq(summaries.id, id));
    return row;
  };

  it('summarises the speaker-labelled transcript and stores the result', async () => {
    received = [];
    failure = undefined;
    const id = await insertSummary(true);
    await runSummary(deps(), id);

    expect(received[0]?.input).toBe('[00:00:00] Alice: Hi.\n[00:01:01] Bye.');
    expect(received[0]?.prompt).toContain('## Decisions');
    expect(received[0]?.prompt).toContain('The participants were: Alice.');
    expect(await load(id)).toMatchObject({
      status: 'done',
      content: '## Summary\n\nDone.',
      error: null,
    });
  });

  it('gives the model the chat unless summary.include_chat is off', async () => {
    received = [];
    failure = undefined;
    await runSummary(deps(), await insertSummary(true, undefined, true));
    expect(received[0]?.input).toBe(
      '[00:00:00] Alice: Hi.\n[00:01:01] Bye.\n\n## Chat messages\n[00:00:05] Alice: Docs https://docs.example/x',
    );
    expect(received[0]?.prompt).toContain('## Resources');

    received = [];
    await settings.set('summary.include_chat', 'false');
    await runSummary(deps(), await insertSummary(true, undefined, true));
    expect(received[0]?.input).toBe('[00:00:00] Alice: Hi.\n[00:01:01] Bye.');
    expect(received[0]?.prompt).not.toContain('Resources');
    await settings.delete('summary.include_chat');
  });

  it('gives the model the meeting date and adds dates to relative due days', async () => {
    received = [];
    failure = undefined;
    const id = await insertSummary(true);
    await test.db
      .update(meetings)
      .set({ startedAt: new Date('2026-11-09T10:00:00Z') })
      .where(eq(meetings.id, (await load(id))?.meetingId ?? ''));
    tableReply = '| Owner | Action | Due |\n| --- | --- | --- |\n| Ann | Send | Wednesday |';
    await runSummary(deps(), id);
    tableReply = undefined;

    expect(received[0]?.prompt).toContain('Monday 9 Nov 2026');
    expect((await load(id))?.content).toContain('| Wednesday (11 Nov) |');
  });

  it('uses the chosen prompt template', async () => {
    received = [];
    await settings.set(
      'summary.prompts',
      JSON.stringify([{ id: 'p1', name: 'Short', content: 'One line only.' }]),
    );
    await runSummary(deps(), await insertSummary(true, 'p1'));
    expect(received[0]?.prompt).toMatch(/^One line only\.\n\nThe meeting took place on /);
  });

  it('queues an export after a finished summary only when automatic export is on', async () => {
    received = [];
    failure = undefined;
    const sent: { name: string; payload: unknown }[] = [];
    const queue = {
      send: (name: string, payload: unknown) => {
        sent.push({ name, payload });
        return Promise.resolve();
      },
    };
    const first = await insertSummary(true);
    await runSummary({ ...deps(), queue }, first);
    expect(sent).toEqual([]);

    await settings.set('export.auto', 'true');
    const second = await insertSummary(true);
    await runSummary({ ...deps(), queue }, second);
    const meetingId = (await load(second))?.meetingId;
    expect(sent).toEqual([{ name: 'meeting.export', payload: { meetingId } }]);
    await settings.delete('export.auto');
  });

  it('queues the calendar link, with retries, only when the setting is on', async () => {
    received = [];
    failure = undefined;
    const sent: { name: string; payload: unknown; options: unknown }[] = [];
    const queue = {
      send: (name: string, payload: unknown, options?: unknown) => {
        sent.push({ name, payload, options });
        return Promise.resolve();
      },
    };
    await runSummary({ ...deps(), queue }, await insertSummary(true));
    expect(sent).toEqual([]);

    await settings.set('minutes.calendar_link', 'true');
    const summaryId = await insertSummary(true);
    await runSummary({ ...deps(), queue }, summaryId);
    const meetingId = (await load(summaryId))?.meetingId;
    expect(sent).toEqual([
      { name: 'meeting.calendar-link', payload: { meetingId }, options: CALENDAR_LINK_RETRY },
    ]);
    await settings.delete('minutes.calendar_link');
  });

  it('titles a phone recording from its summary but not other meetings', async () => {
    received = [];
    failure = undefined;
    const recording = await insertSummary(true);
    const meetingId = (await load(recording))?.meetingId ?? '';
    await test.db.update(meetings).set({ platform: 'recording' }).where(eq(meetings.id, meetingId));
    await runSummary(deps(), recording);
    const [titled] = await test.db.select().from(meetings).where(eq(meetings.id, meetingId));
    expect(titled?.title).toBe('Summary, Done');
    expect(received.map((r) => r.prompt)).toContain(TITLE_INSTRUCTIONS);

    received = [];
    await runSummary(deps(), await insertSummary(true));
    expect(received.map((r) => r.prompt)).not.toContain(TITLE_INSTRUCTIONS);
  });

  it('records provider errors on the summary', async () => {
    failure = new Error('openai-compatible: 401');
    const id = await insertSummary(true);
    await runSummary(deps(), id);
    expect(await load(id)).toMatchObject({
      status: 'failed',
      error: 'openai-compatible: 401',
      content: '',
    });
  });

  it('fails clearly without a transcript and skips finished summaries', async () => {
    const empty = await insertSummary(false);
    await runSummary(deps(), empty);
    expect(await load(empty)).toMatchObject({ status: 'failed', error: 'The transcript is empty' });

    received = [];
    failure = undefined;
    await runSummary(deps(), empty);
    expect(received).toEqual([]);
  });

  describe('re-applying earlier AI edits', () => {
    const editor = (outputs: Record<string, string>): SummaryProvider => ({
      ...provider,
      summarize: (input, prompt) => {
        if (!prompt.startsWith('You edit a meeting summary'))
          return provider.summarize(input, prompt);
        const instruction = /<instruction>\n([\s\S]*?)\n<\/instruction>/.exec(input)?.[1] ?? '';
        const summary = /<summary>\n([\s\S]*?)\n<\/summary>/.exec(input)?.[1] ?? '';
        return Promise.resolve(outputs[instruction] ?? `${summary}\n\n- ${instruction}`);
      },
    });
    const run = async (id: string, outputs: Record<string, string> = {}) => {
      failure = undefined;
      await runSummary({ ...deps(), createSummarizer: () => Promise.resolve(editor(outputs)) }, id);
      const [row] = await test.db.select().from(summaries).where(eq(summaries.id, id));
      return test.db
        .select()
        .from(summaries)
        .where(eq(summaries.meetingId, row?.meetingId ?? ''))
        .orderBy(summaries.createdAt);
    };

    it('replays the instructions in order on the fresh summary, one version each', async () => {
      const rows = await run(await insertSummary(true, undefined, false, ['Add A', 'Add B']));
      expect(rows.map((r) => [r.origin, r.note, r.status])).toEqual([
        ['ai', null, 'done'],
        ['ai-edit', 'Add A', 'done'],
        ['ai-edit', 'Add B', 'done'],
      ]);
      expect(rows[0]?.content).toBe('## Summary\n\nDone.');
      expect(rows[2]?.content).toBe('## Summary\n\nDone.\n\n- Add A\n\n- Add B');
      expect(rows.every((r) => r.error === null)).toBe(true);
    });

    it('skips an instruction that changes nothing and stops at one that fails', async () => {
      const rows = await run(
        await insertSummary(true, undefined, false, ['Noop', 'Add C', 'Bad', 'Add D']),
        {
          Noop: '## Summary\n\nDone.',
          Bad: ' ',
        },
      );
      expect(rows.map((r) => r.note)).toEqual([null, 'Add C']);
      expect(rows[1]?.error).toContain('Not re-applied: "Bad"');
      expect(rows.map((r) => r.status)).toEqual(['done', 'done']);
    });
  });
});
