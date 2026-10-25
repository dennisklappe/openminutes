import { SettingsStore } from '@openminutes/core';
import {
  calendarAccounts,
  eq,
  meetings,
  transcriptSegments,
  type CalendarInvitee,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { SummaryProvider } from '@openminutes/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectCompany, parseCompanyReply } from './company.js';

describe('parseCompanyReply', () => {
  const evidence = 'We spoke with Hartmann Logistics about the rollout.';

  it('accepts a named company the model is sure about', () => {
    expect(
      parseCompanyReply('{"company":"Hartmann Logistics","confidence":"high"}', evidence),
    ).toBe('Hartmann Logistics');
    expect(
      parseCompanyReply('Sure: {"company":"hartmann logistics","confidence":"medium"}', evidence),
    ).toBe('hartmann logistics');
  });

  it.each([
    ['{"company":null,"confidence":"low"}'],
    ['{"company":"Hartmann Logistics","confidence":"low"}'],
    ['{"company":"Hartmann Logistics"}'],
    ['{"company":"Globex","confidence":"high"}'],
    ['{"company":"","confidence":"high"}'],
    [`{"company":"${'x'.repeat(90)}","confidence":"high"}`],
    ['{"company":["Hartmann Logistics"],"confidence":"high"}'],
  ])('rejects %s', (reply) => {
    expect(parseCompanyReply(reply, evidence)).toBeUndefined();
  });

  it('throws on a reply that is not JSON', () => {
    expect(() => parseCompanyReply('Hartmann', evidence)).toThrow(/JSON/);
    expect(() => parseCompanyReply('{nope}', evidence)).toThrow(/invalid JSON/);
  });
});

describe('detectCompany', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let settings: SettingsStore;
  let calls: string[];
  let reply: string | Error;

  const provider: SummaryProvider = {
    model: 'm',
    maxInputChars: 10_000,
    summarize: (input) => {
      calls.push(input);
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
    test: () => Promise.resolve({}),
  };

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
    await test.db.insert(calendarAccounts).values({
      provider: 'google',
      accountEmail: 'priya@northwind.example',
      encryptedTokens: 'x',
    });
  });
  afterAll(() => test.close());

  async function insert(values: Partial<typeof meetings.$inferInsert> = {}, text?: string) {
    calls = [];
    reply = '{"company":null,"confidence":"low"}';
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Sync', platform: 'meet', joinUrl: 'https://meet.google.com/x', ...values })
      .returning();
    if (!meeting) throw new Error('insert failed');
    if (text) {
      await test.db
        .insert(transcriptSegments)
        .values({ meetingId: meeting.id, startMs: 0, endMs: 1000, text });
    }
    return meeting.id;
  }
  const stored = async (id: string) => {
    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, id));
    return { company: row?.company, source: row?.companySource };
  };
  const run = (id: string, summary = 'Summary') =>
    detectCompany({ db: test.db, settings }, provider, id, summary);
  const invitees = (...emails: string[]): CalendarInvitee[] =>
    emails.map((email) => ({ email, name: null, declined: false }));

  it('takes the company from outside invitee domains without asking the model', async () => {
    const id = await insert({
      invitees: invitees('priya@northwind.example', 'lena@hartmann-logistics.de'),
    });
    await run(id);
    expect(await stored(id)).toEqual({ company: 'Hartmann Logistics', source: 'calendar' });
    expect(calls).toEqual([]);
  });

  it('asks the model when the calendar says nothing and keeps the spelling of a known company', async () => {
    await insert({ title: 'Globex seed', company: 'Globex B.V.', companySource: 'manual' });
    const id = await insert({}, 'Thanks for joining. This is Globex.');
    reply = '{"company":"Globex","confidence":"high"}';
    await run(id, 'A call with Globex.');
    expect(await stored(id)).toEqual({ company: 'Globex B.V.', source: 'ai' });
    expect(calls).toHaveLength(1);
  });

  it('leaves the company unknown when the model is unsure, invents a name or fails', async () => {
    const unsure = await insert();
    await run(unsure);
    expect(await stored(unsure)).toEqual({ company: null, source: null });

    const invented = await insert();
    reply = '{"company":"Initech","confidence":"high"}';
    await run(invented, 'Nothing named here.');
    expect((await stored(invented)).company).toBeNull();

    const broken = await insert();
    reply = new Error('model down');
    await run(broken);
    expect((await stored(broken)).company).toBeNull();
  });

  it('never replaces a company that is already set', async () => {
    const id = await insert(
      { company: 'Mine', companySource: 'manual', invitees: invitees('x@acme.com') },
      'Acme',
    );
    reply = '{"company":"Acme","confidence":"high"}';
    await run(id, 'Acme');
    expect(await stored(id)).toEqual({ company: 'Mine', source: 'manual' });
    expect(calls).toEqual([]);
  });

  it('does not overwrite a company set by hand while the model was answering', async () => {
    const id = await insert({}, 'Acme');
    const slow: SummaryProvider = {
      ...provider,
      summarize: async () => {
        await test.db
          .update(meetings)
          .set({ company: 'Chosen', companySource: 'manual' })
          .where(eq(meetings.id, id));
        return '{"company":"Acme","confidence":"high"}';
      },
    };
    await detectCompany({ db: test.db, settings }, slow, id, 'Acme');
    expect(await stored(id)).toEqual({ company: 'Chosen', source: 'manual' });
  });
});
