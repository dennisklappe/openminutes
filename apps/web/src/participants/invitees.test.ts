import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import { eq, knownVoices, meetings, participantAliases, participants } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { ParticipantsDto } from '../dto.js';
import { assembleMinutes } from '../minutes/assemble.js';
import { createShareLink } from '../minutes/share-routes.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const CARLA = 'carla.gonzalez@acme.example';
const OTHER = 'carla.smith@elsewhere.com';

describe('linking calendar invitees to participants', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let settings: SettingsStore;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    settings = new SettingsStore(test.db, secret);
    app = createApp({
      db: test.db,
      settings,
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-invitees-'))),
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

  const call = (method: string, path: string, body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { ...json, cookie },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  const read = async (response: Response) => (await response.json()) as ParticipantsDto;

  async function meet(names: string[]) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Acme sync',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'transcribed',
        startedAt: new Date('2026-10-20T10:00:00Z'),
        invitees: [
          { email: CARLA, name: 'Carla Gonzalez', declined: false },
          { email: OTHER, name: 'Carla Smith', declined: false },
          { email: 'dana@example.com', name: 'Dana Keller', declined: false },
        ],
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const people = await test.db
      .insert(participants)
      .values(names.map((displayName) => ({ meetingId: meeting.id, displayName })))
      .returning();
    return { meeting, people };
  }
  const minutesOf = (id: string) => assembleMinutes({ db: test.db, settings }, id);

  it('lists only the invitees nobody was matched to', async () => {
    const { meeting } = await meet(['Dana Keller', 'Marketing Acme']);
    const body = await read(await call('GET', `/meetings/${meeting.id}/participants`));
    expect(body.invitees).toHaveLength(3);
    expect(body.absent.map((invitee) => invitee.email)).toEqual([CARLA, OTHER]);
  });

  it('counts a shared account renamed to the invitee as present', async () => {
    const { meeting } = await meet(['Dana Keller', 'Carla Gonzalez']);
    const body = await read(await call('GET', `/meetings/${meeting.id}/participants`));
    expect(body.absent.map((invitee) => invitee.email)).toEqual([OTHER]);
  });

  it('saves the invitee with the rename and remembers it for the shared account', async () => {
    const { meeting, people } = await meet(['Marketing Acme']);
    const [shared] = people;
    const body = await read(
      await call('PUT', `/meetings/${meeting.id}/participants/${shared?.id}`, {
        name: 'Carla',
        remember: true,
        inviteeEmails: [CARLA.toUpperCase()],
      }),
    );
    expect(body.participants[0]?.inviteeEmails).toEqual([CARLA]);
    expect(body.absent.map((invitee) => invitee.email)).toEqual([OTHER, 'dana@example.com']);
    const [alias] = await test.db
      .select()
      .from(participantAliases)
      .where(eq(participantAliases.originalName, 'Marketing Acme'));
    expect(alias).toMatchObject({ displayName: 'Carla', inviteeEmails: [CARLA] });
    expect((await minutesOf(meeting.id))?.attendees[0]).toMatchObject({ email: CARLA });
  });

  it('keeps the link when a later rename leaves it out, and removes it with null', async () => {
    const { meeting, people } = await meet(['Marketing Acme']);
    const path = `/meetings/${meeting.id}/participants/${people[0]?.id}`;
    await call('PUT', path, { name: 'Carla', inviteeEmails: [CARLA] });
    const kept = await read(await call('PUT', path, { name: 'Carla G' }));
    expect(kept.participants[0]?.inviteeEmails).toEqual([CARLA]);
    const cleared = await read(await call('PUT', path, { name: 'Carla G', inviteeEmails: [] }));
    expect(cleared.participants[0]?.inviteeEmails).toEqual([]);
  });

  it('rejects a link to someone who was not invited', async () => {
    const { meeting, people } = await meet(['Marketing Acme']);
    const path = `/meetings/${meeting.id}/participants/${people[0]?.id}`;
    expect((await call('PUT', path, { name: 'Carla', inviteeEmails: ['x@y.com'] })).status).toBe(
      400,
    );
    expect((await call('PUT', `${path}/invitee`, { email: 'x@y.com' })).status).toBe(400);
    expect((await call('PUT', `${path}/invitee`, { nope: true })).status).toBe(400);
  });

  it('links an absent invitee to a participant with "They were there"', async () => {
    const { meeting, people } = await meet(['Marketing Acme']);
    const body = await read(
      await call('PUT', `/meetings/${meeting.id}/participants/${people[0]?.id}/invitee`, {
        email: CARLA,
      }),
    );
    expect(body.absent.map((invitee) => invitee.email)).not.toContain(CARLA);
    expect((await minutesOf(meeting.id))?.absent.map((p) => p.email)).not.toContain(CARLA);
  });

  it('lets one participant be several invitees and adds instead of replacing', async () => {
    const { meeting, people } = await meet(['Marketing Acme']);
    const path = `/meetings/${meeting.id}/participants/${people[0]?.id}`;
    await call('PUT', `${path}/invitee`, { email: CARLA });
    const both = await read(await call('PUT', `${path}/invitee`, { email: OTHER }));
    expect(both.participants[0]?.inviteeEmails).toEqual([CARLA, OTHER]);
    expect(both.absent.map((invitee) => invitee.email)).toEqual(['dana@example.com']);
    const again = await read(await call('PUT', `${path}/invitee`, { email: CARLA.toUpperCase() }));
    expect(again.participants[0]?.inviteeEmails).toEqual([CARLA, OTHER]);
    const renamed = await read(
      await call('PUT', path, { name: 'Carla', inviteeEmails: [OTHER, CARLA], remember: true }),
    );
    expect(renamed.participants[0]?.inviteeEmails).toEqual([OTHER, CARLA]);
    const [alias] = await test.db
      .select()
      .from(participantAliases)
      .where(eq(participantAliases.originalName, 'Marketing Acme'));
    expect(alias?.inviteeEmails).toEqual([OTHER, CARLA]);
    const cleared = await read(await call('PUT', `${path}/invitee`, { email: null }));
    expect(cleared.participants[0]?.inviteeEmails).toEqual([]);
  });

  it('stores a typed email for someone not invited and remembers it with their voice', async () => {
    const { meeting, people } = await meet(['JP']);
    const [jp] = people;
    await test.db
      .update(participants)
      .set({ voiceEmbedding: [0.1, 0.2, 0.3] })
      .where(eq(participants.id, jp?.id ?? ''));
    const path = `/meetings/${meeting.id}/participants/${jp?.id}`;
    const bad = await call('PUT', path, { name: 'Jo Parker', email: 'not-an-email' });
    expect(bad.status).toBe(400);
    const body = await read(
      await call('PUT', path, { name: 'Jo Parker', email: 'jo@parker.example', remember: true }),
    );
    expect(body.participants[0]).toMatchObject({ email: 'jo@parker.example', inviteeEmails: [] });
    const [alias] = await test.db
      .select()
      .from(participantAliases)
      .where(eq(participantAliases.originalName, 'JP'));
    expect(alias).toMatchObject({ displayName: 'Jo Parker', email: 'jo@parker.example' });
    const [voice] = await test.db
      .select()
      .from(knownVoices)
      .where(eq(knownVoices.name, 'Jo Parker'));
    expect(voice?.email).toBe('jo@parker.example');
    const people2 = (await minutesOf(meeting.id))?.attendees ?? [];
    expect(people2.find((p) => p.name === 'Jo Parker')?.email).toBe('jo@parker.example');
    const cleared = await read(await call('PUT', path, { name: 'Jo Parker', email: '' }));
    expect(cleared.participants[0]?.email).toBeNull();
  });

  it('removes an invitee from the list for this meeting only', async () => {
    const { meeting } = await meet(['Marketing Acme']);
    const body = await read(
      await call('POST', `/meetings/${meeting.id}/dismissed-invitees`, { email: OTHER }),
    );
    expect(body.absent.map((invitee) => invitee.email)).toEqual([CARLA, 'dana@example.com']);
    await call('POST', `/meetings/${meeting.id}/dismissed-invitees`, { email: OTHER });
    const [row] = await test.db.select().from(meetings).where(eq(meetings.id, meeting.id));
    expect(row?.dismissedInvitees).toEqual([OTHER]);
    expect((await minutesOf(meeting.id))?.absent.map((p) => p.email)).not.toContain(OTHER);
    const other = await meet(['Marketing Acme']);
    expect((await minutesOf(other.meeting.id))?.absent.map((p) => p.email)).toContain(OTHER);
    const refused = await call('POST', `/meetings/${meeting.id}/dismissed-invitees`, {
      email: 'x@y.com',
    });
    expect(refused.status).toBe(400);
  });

  it('keeps invitee emails off the public share page', async () => {
    const { meeting } = await meet(['Marketing Acme']);
    const share = await createShareLink(test.db, meeting.id, {
      includeTranscript: false,
      expiresInDays: null,
    });
    const html = await (await app.request(`/s/${share.token}`)).text();
    expect(html).toContain('Carla Gonzalez');
    expect(html).not.toMatch(/[\w.-]+@[\w-]+\.\w+/);
  });
});
