import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { eq, meetings, participants, people, transcriptSegments } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { EmailConflictDto, SpeakerIdentityDto, SpeakerIdentityResultDto } from '../dto.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };

describe('speaker identity', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-identity-'))),
      secret,
      calendarProviders: createProviders(),
      version: '1.2.3',
      queue: { send: () => Promise.resolve() },
    });
    const created = await app.request('/api/setup', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ password: 'correct horse battery' }),
    });
    cookie = created.headers.get('set-cookie')?.split(';')[0] ?? '';
  });
  afterAll(() => test.close());
  beforeEach(async () => {
    await test.db.delete(people);
  });

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...json, cookie },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  async function meet(platform: 'meet' | 'recording' = 'meet') {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Sync',
        platform,
        joinUrl: platform === 'meet' ? 'https://meet.google.com/abc-defg-hij' : 'recording://sync',
        status: 'transcribed',
        startedAt: new Date('2026-10-20T10:00:00Z'),
        invitees: [
          { email: 'jo@parker.example', name: 'Jo Parker', declined: false },
          { email: 'ann@acme.example', name: 'Ann Lee', declined: false },
        ],
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const [tnf, ann] = await test.db
      .insert(participants)
      .values([
        { meetingId: meeting.id, displayName: 'Tnf' },
        { meetingId: meeting.id, displayName: 'Ann Lee' },
      ])
      .returning();
    if (!tnf || !ann) throw new Error('insert failed');
    await test.db.insert(transcriptSegments).values([
      { meetingId: meeting.id, participantId: tnf.id, startMs: 0, endMs: 4000, text: 'Hi' },
      { meetingId: meeting.id, participantId: ann.id, startMs: 4000, endMs: 6000, text: 'Yo' },
    ]);
    return { meeting, tnf, ann };
  }

  const url = (meetingId: string, participantId: string) =>
    `/meetings/${meetingId}/participants/${participantId}/identity`;

  it('reads a speaker without a person and marks invitees taken by someone else', async () => {
    const { meeting, tnf } = await meet();
    await test.db.insert(people).values({ name: 'Ann Lee', emails: ['ann@acme.example'] });
    const body = (await (await call('GET', url(meeting.id, tnf.id))).json()) as SpeakerIdentityDto;
    expect(body).toMatchObject({ personId: null, name: 'Tnf', emails: [], nameLocked: false });
    expect(body.invitees.map((i) => [i.email, i.takenBy])).toEqual([
      ['jo@parker.example', null],
      ['ann@acme.example', 'Ann Lee'],
    ]);
  });

  it('renames, creates the person and binds the emails in one request', async () => {
    const { meeting, tnf } = await meet();
    const response = await call('PUT', url(meeting.id, tnf.id), {
      name: 'Jo Parker',
      emails: ['Jo@Parker.example', 'jo@home.example'],
    });
    expect(response.status).toBe(200);
    const { identity } = (await response.json()) as SpeakerIdentityResultDto;
    expect(identity).toMatchObject({
      name: 'Jo Parker',
      originalName: 'Tnf',
      emails: ['jo@parker.example', 'jo@home.example'],
    });
    const [seat] = await test.db.select().from(participants).where(eq(participants.id, tnf.id));
    expect(seat).toMatchObject({
      nameConfirmed: true,
      inviteeEmails: ['jo@parker.example'],
      email: 'jo@home.example',
    });
    const owners = await test.db.select().from(people).where(eq(people.name, 'Jo Parker'));
    expect(owners).toHaveLength(1);
  });

  it('removes an address from the person and the seat', async () => {
    const { meeting, tnf } = await meet();
    await call('PUT', url(meeting.id, tnf.id), {
      name: 'Jo Parker',
      emails: ['jo@parker.example', 'jo@home.example'],
    });
    const { identity } = (await (
      await call('PUT', url(meeting.id, tnf.id), { name: 'Jo Parker', emails: ['jo@home.example'] })
    ).json()) as SpeakerIdentityResultDto;
    expect(identity.emails).toEqual(['jo@home.example']);
    const [seat] = await test.db.select().from(participants).where(eq(participants.id, tnf.id));
    expect(seat?.inviteeEmails).toEqual([]);
  });

  it('refuses an address that belongs to another person and changes nothing', async () => {
    const { meeting, tnf } = await meet();
    await test.db.insert(people).values({ name: 'Ann Lee', emails: ['ann@acme.example'] });
    const response = await call('PUT', url(meeting.id, tnf.id), {
      name: 'Jo Parker',
      emails: ['ann@acme.example'],
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain('Ann Lee');
    const [seat] = await test.db.select().from(participants).where(eq(participants.id, tnf.id));
    expect(seat?.displayName).toBe('Tnf');
  });

  it.each(['meet', 'recording'] as const)(
    'renames the person it already has and keeps their address (%s)',
    async (platform) => {
      const { meeting, tnf } = await meet(platform);
      const [person] = await test.db
        .insert(people)
        .values({ name: 'Tnf', emails: ['tnf@acme.example'] })
        .returning();
      await test.db
        .update(participants)
        .set({ personId: person?.id ?? null })
        .where(eq(participants.id, tnf.id));
      const response = await call('PUT', url(meeting.id, tnf.id), {
        name: 'Thomas Nijhof',
        emails: ['tnf@acme.example'],
      });
      expect(response.status).toBe(200);
      const all = await test.db.select().from(people);
      expect(all.map((p) => [p.name, p.emails])).toEqual([['Thomas Nijhof', ['tnf@acme.example']]]);
      const [seat] = await test.db.select().from(participants).where(eq(participants.id, tnf.id));
      expect(seat).toMatchObject({ displayName: 'Thomas Nijhof', personId: person?.id });
    },
  );

  it('joins the person of the same name without losing their addresses', async () => {
    const { meeting, tnf } = await meet();
    await test.db.insert(people).values({ name: 'Jo Parker', emails: ['jo@old.example'] });
    const preview = (await (
      await call('GET', `${url(meeting.id, tnf.id)}?name=jo%20parker`)
    ).json()) as SpeakerIdentityDto;
    expect(preview.match?.name).toBe('Jo Parker');
    const { identity } = (await (
      await call('PUT', url(meeting.id, tnf.id), {
        name: 'Jo Parker',
        emails: ['jo@parker.example'],
      })
    ).json()) as SpeakerIdentityResultDto;
    expect(identity.emails).toEqual(['jo@old.example', 'jo@parker.example']);
  });

  it('rejects emails for a speaker that stays generic, bad emails and other meetings', async () => {
    const { meeting, ann } = await meet();
    const other = await meet();
    expect(
      (await call('PUT', url(meeting.id, ann.id), { name: 'Ann Lee', emails: ['nope'] })).status,
    ).toBe(400);
    expect(
      (await call('PUT', url(other.meeting.id, ann.id), { name: 'Ann Lee', emails: [] })).status,
    ).toBe(404);
    await test.db
      .update(participants)
      .set({ displayName: 'Speaker 2' })
      .where(eq(participants.id, ann.id));
    expect(
      (await call('PUT', url(meeting.id, ann.id), { name: 'Speaker 2', emails: ['a@b.example'] }))
        .status,
    ).toBe(400);
  });

  it('merges two voices of a recording that get the same name', async () => {
    const { meeting, tnf, ann } = await meet('recording');
    const response = await call('PUT', url(meeting.id, tnf.id), {
      name: 'Ann Lee',
      emails: ['ann@acme.example'],
    });
    expect(response.status).toBe(200);
    const left = await test.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meeting.id));
    expect(left.map((p) => p.id)).toEqual([ann.id]);
    const { identity } = (await response.json()) as SpeakerIdentityResultDto;
    expect(identity.participantId).toBe(ann.id);
    expect(identity.emails).toEqual(['ann@acme.example']);
  });

  it('answers 409 with the conflict, and merges the holder in when asked', async () => {
    const { meeting, tnf } = await meet();
    await call('PUT', url(meeting.id, tnf.id), { name: 'Jo Parker', emails: [] });
    const [holder] = await test.db
      .insert(people)
      .values({ name: 'Jolie', emails: ['jo@parker.example'], source: 'invited' })
      .returning();
    const body = { name: 'Jo Parker', emails: ['jo@parker.example'] };
    const refused = await call('PUT', url(meeting.id, tnf.id), body);
    expect(refused.status).toBe(409);
    const refusal = (await refused.json()) as { code: string; conflict: EmailConflictDto };
    expect(refusal.code).toBe('email_taken');
    expect(refusal.conflict).toMatchObject({
      email: 'jo@parker.example',
      personId: holder?.id,
      name: 'Jolie',
      source: 'invited',
      into: { name: 'Jo Parker' },
    });
    const merged = await call('PUT', url(meeting.id, tnf.id), {
      ...body,
      mergeFrom: holder?.id,
    });
    expect(merged.status).toBe(200);
    const { identity } = (await merged.json()) as SpeakerIdentityResultDto;
    expect(identity.emails).toEqual(['jo@parker.example']);
    expect(await test.db.select().from(people).where(eq(people.name, 'Jolie'))).toEqual([]);
  });

  it('keeps the holder when the identity save fails after the merge', async () => {
    const { meeting, tnf } = await meet();
    await call('PUT', url(meeting.id, tnf.id), { name: 'Jo Parker', emails: [] });
    const [holder] = await test.db
      .insert(people)
      .values({ name: 'Jolie', emails: ['jo@parker.example'] })
      .returning();
    await test.db.insert(people).values({ name: 'Kim Roe', emails: ['kim@roe.example'] });
    const response = await call('PUT', url(meeting.id, tnf.id), {
      name: 'Jo Parker',
      emails: ['jo@parker.example', 'kim@roe.example'],
      mergeFrom: holder?.id,
    });
    expect(response.status).toBe(409);
    expect(await test.db.select().from(people).where(eq(people.name, 'Jolie'))).toHaveLength(1);
  });
});
