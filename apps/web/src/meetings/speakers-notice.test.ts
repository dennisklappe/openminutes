import { createProviders } from '@openminutes/calendar';
import { LocalStorage, saveProviderSettings, SettingsStore } from '@openminutes/core';
import { eq, meetings, participants, summaries, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { AccessVerifier } from '../auth/access.js';
import { makeKey, signToken, startFakeJwks, type FakeJwks } from '../auth/access-fixtures.js';
import type { MeetingDetailDto, PersonDetailDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';

describe('the notice that speakers changed after the summary', () => {
  const key = makeKey('key-1');
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let jwks: FakeJwks;
  let app: Hono;

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
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-notice-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
      access: new AccessVerifier(jwks.config),
      publicUrl: 'https://minutes.example/',
      providerDeps: {
        fetch: () => Promise.resolve(new Response('{"choices":[{"message":{"content":"x"}}]}')),
      },
    });
  });
  afterAll(async () => {
    await jwks.close();
    await test.close();
  });

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: {
        'cf-access-jwt-assertion': signToken(key),
        origin: 'http://localhost',
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  /** A meeting with two speakers, two lines and a summary written a minute ago. */
  async function fixture() {
    const [meeting] = await test.db
      .insert(meetings)
      .values({ title: 'Notice', platform: 'meet', joinUrl: 'u', status: 'transcribed' })
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
    const [line] = await test.db
      .insert(transcriptSegments)
      .values({ meetingId: meeting.id, participantId: one.id, startMs: 0, endMs: 3000, text: 'Hi' })
      .returning();
    if (!line) throw new Error('insert failed');
    await test.db.insert(summaries).values({
      meetingId: meeting.id,
      provider: 'seed',
      model: 'seed',
      status: 'done',
      content: 'Summary',
      createdAt: new Date(Date.now() - 60_000),
    });
    return { meeting, one, two, line };
  }
  const notice = async (id: string) =>
    ((await (await call('GET', `/meetings/${id}`)).json()) as MeetingDetailDto)
      .speakersChangedSinceSummary;
  const assign = (id: string, lineId: string, speakerId: string) =>
    call('POST', `/meetings/${id}/speaker-edits`, {
      kind: 'assign',
      segmentIds: [lineId],
      speaker: { id: speakerId },
    });

  it('shows after a person changes who said a line, not before', async () => {
    const { meeting, two, line } = await fixture();
    expect(await notice(meeting.id)).toBe(false);
    expect((await assign(meeting.id, line.id, two.id)).status).toBe(200);
    expect(await notice(meeting.id)).toBe(true);
  });

  it('does not show for automatic or AI changes', async () => {
    const { meeting, two, line } = await fixture();
    await test.db
      .update(transcriptSegments)
      .set({ participantId: two.id, speakerSource: 'ai' })
      .where(eq(transcriptSegments.id, line.id));
    expect(await notice(meeting.id)).toBe(false);
  });

  it('does not show without a summary, or when the summary is newer than the change', async () => {
    const { meeting, two, line } = await fixture();
    await assign(meeting.id, line.id, two.id);
    await test.db.insert(summaries).values({
      meetingId: meeting.id,
      provider: 'seed',
      model: 'seed',
      status: 'done',
      content: 'Newer',
    });
    expect(await notice(meeting.id)).toBe(false);
    await test.db.delete(summaries).where(eq(summaries.meetingId, meeting.id));
    expect(await notice(meeting.id)).toBe(false);
  });

  it('is hidden by Dismiss and comes back with the next change', async () => {
    const { meeting, one, two, line } = await fixture();
    await assign(meeting.id, line.id, two.id);
    expect((await call('POST', `/meetings/${meeting.id}/speakers-notice/dismiss`)).status).toBe(
      200,
    );
    expect(await notice(meeting.id)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await assign(meeting.id, line.id, one.id);
    expect(await notice(meeting.id)).toBe(true);
    expect((await call('POST', `/meetings/${missing()}/speakers-notice/dismiss`)).status).toBe(404);
  });

  it('is cleared when the summary is regenerated, which keeps the old version', async () => {
    const { meeting, two, line } = await fixture();
    await assign(meeting.id, line.id, two.id);
    expect(await notice(meeting.id)).toBe(true);
    const response = await call('POST', `/meetings/${meeting.id}/summaries`, {});
    expect(response.status).toBe(202);
    expect(await notice(meeting.id)).toBe(false);
    const rows = await test.db.select().from(summaries).where(eq(summaries.meetingId, meeting.id));
    expect(rows.filter((row) => row.content === 'Summary')).toHaveLength(1);
    expect(rows.length).toBeGreaterThan(1);
  });

  it('shows after a person verifies a line in the review, and after undoing it', async () => {
    const { meeting, one, line } = await fixture();
    const created = await call('POST', '/people', { name: `Reviewer ${meeting.id.slice(0, 6)}` });
    const person = ((await created.json()) as PersonDetailDto).person;
    await test.db
      .update(participants)
      .set({ displayName: person.name, personId: person.id, nameConfirmed: true })
      .where(eq(participants.id, one.id));
    expect(await notice(meeting.id)).toBe(false);
    await call('POST', `/people/${person.id}/lines/${line.id}/verify`, {});
    expect(await notice(meeting.id)).toBe(true);
    await call('POST', `/meetings/${meeting.id}/speakers-notice/dismiss`);
    expect(await notice(meeting.id)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await call('POST', '/people/review/undo', { segmentId: line.id });
    expect(await notice(meeting.id)).toBe(true);
  });

  it('shows after a person turns down the suggestion that made a line doubtful', async () => {
    const { meeting, one, two, line } = await fixture();
    const created = await call('POST', '/people', { name: `Rejector ${meeting.id.slice(0, 6)}` });
    const person = ((await created.json()) as PersonDetailDto).person;
    await test.db
      .update(participants)
      .set({ displayName: person.name, personId: person.id, nameConfirmed: true })
      .where(eq(participants.id, two.id));
    await test.db
      .update(transcriptSegments)
      .set({ suggestedParticipantId: two.id, speakerConfidence: 0.4 })
      .where(eq(transcriptSegments.id, line.id));
    expect(one.id).not.toBe(two.id);
    expect(await notice(meeting.id)).toBe(false);
    await call('POST', `/people/${person.id}/lines/${line.id}/reject`, {});
    expect(await notice(meeting.id)).toBe(true);
  });
});

const missing = () => '00000000-0000-4000-8000-000000000000';
