import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviders } from '@openminutes/calendar';
import { LocalStorage, SettingsStore } from '@openminutes/core';
import {
  eq,
  meetings,
  participantAliases,
  participants,
  summaries,
  transcriptSegments,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import type { MeetingDetailDto, ParticipantAliasesDto, ParticipantsDto } from '../dto.js';
import { assembleMinutes } from '../minutes/assemble.js';

const secret = 'a-long-enough-test-secret';
const json = { 'content-type': 'application/json' };
const SUMMARY = 'Marketing Acme proposed a launch. Marketing will follow up. Acme pays.';

describe('participant names', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  let app: Hono;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDatabase();
    app = createApp({
      db: test.db,
      settings: new SettingsStore(test.db, secret),
      storage: new LocalStorage(await mkdtemp(join(tmpdir(), 'openminutes-people-'))),
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

  async function meet(summary: { content: string; origin?: 'ai' | 'edit' } = { content: SUMMARY }) {
    const [meeting] = await test.db
      .insert(meetings)
      .values({
        title: 'Sync',
        platform: 'meet',
        joinUrl: 'https://meet.google.com/abc-defg-hij',
        status: 'transcribed',
        startedAt: new Date('2026-10-20T10:00:00Z'),
      })
      .returning();
    if (!meeting) throw new Error('insert failed');
    const people = await test.db
      .insert(participants)
      .values([
        {
          meetingId: meeting.id,
          displayName: 'Marketing Acme',
          joinedAt: new Date('2026-10-20T10:00:00Z'),
          leftAt: new Date('2026-10-20T10:30:00Z'),
        },
        { meetingId: meeting.id, displayName: 'Dana Keller', email: 'd@example.com' },
      ])
      .returning();
    const [carla, dana] = people;
    if (!carla || !dana) throw new Error('insert failed');
    await test.db.insert(transcriptSegments).values([
      { meetingId: meeting.id, participantId: carla.id, startMs: 0, endMs: 4000, text: 'Hi' },
      { meetingId: meeting.id, participantId: dana.id, startMs: 4000, endMs: 6000, text: 'Yo' },
    ]);
    await test.db.insert(summaries).values({
      meetingId: meeting.id,
      provider: 'fake',
      model: 'm',
      status: 'done',
      content: summary.content,
      origin: summary.origin ?? 'ai',
    });
    return { meeting, carla, dana };
  }

  it('lists participants with talk time, hiding the bot', async () => {
    const { meeting } = await meet();
    await test.db.insert(participants).values({
      meetingId: meeting.id,
      displayName: 'OpenMinutes Notetaker',
      isBot: true,
    });
    const body = (await (
      await call('GET', `/meetings/${meeting.id}/participants`)
    ).json()) as ParticipantsDto;
    expect(body.participants.map((p) => [p.name, p.originalName, p.talkMs])).toEqual([
      ['Marketing Acme', null, 4000],
      ['Dana Keller', null, 2000],
    ]);
  });

  it('leaves the notetaker out of counts, attendees and the people card', async () => {
    const { meeting } = await meet();
    await test.db.insert(participants).values({
      meetingId: meeting.id,
      displayName: 'Scribe',
      isBot: true,
    });
    const list = (await (await call('GET', '/meetings')).json()) as {
      id: string;
      participantCount: number;
    }[];
    expect(list.find((m) => m.id === meeting.id)?.participantCount).toBe(2);
    const minutes = await assembleMinutes(
      { db: test.db, settings: new SettingsStore(test.db, secret) },
      meeting.id,
    );
    expect(minutes?.attendees.map((p) => p.name)).not.toContain('Scribe');
    const library = (await (await call('GET', '/library')).json()) as {
      meetings: { id: string; people: string[] }[];
    };
    expect(library.meetings.find((m) => m.id === meeting.id)?.people).not.toContain('Scribe');
    const body = (await (
      await call('GET', `/meetings/${meeting.id}/participants`)
    ).json()) as ParticipantsDto;
    expect(body.participants.map((p) => p.name)).not.toContain('Scribe');
  });

  it('renames a participant, keeps the original name and writes a new summary version', async () => {
    const { meeting, carla } = await meet();
    const response = await call('PUT', `/meetings/${meeting.id}/participants/${carla.id}`, {
      name: 'Carla',
    });
    const body = (await response.json()) as ParticipantsDto;
    expect(body.summaryUpdated).toBe(true);
    expect(body.participants[0]).toMatchObject({
      name: 'Carla',
      originalName: 'Marketing Acme',
      confirmed: true,
    });

    const rows = await test.db.select().from(summaries).where(eq(summaries.meetingId, meeting.id));
    expect(rows).toHaveLength(2);
    const detail = (await (
      await call('GET', `/meetings/${meeting.id}`)
    ).json()) as MeetingDetailDto;
    const active = detail.summaries.filter((s) => s.active);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      origin: 'rename',
      author: 'renamed participants',
      content: 'Carla proposed a launch. Carla will follow up. Acme pays.',
    });
    expect(detail.summaries.find((s) => s.version === 1)?.content).toBe(SUMMARY);
  });

  it('builds a new version from a manually edited summary without losing the edit', async () => {
    const { meeting, carla } = await meet({
      content: 'Edited: Marketing Acme ok',
      origin: 'edit',
    });
    await call('PUT', `/meetings/${meeting.id}/participants/${carla.id}`, { name: 'Carla' });
    const detail = (await (
      await call('GET', `/meetings/${meeting.id}`)
    ).json()) as MeetingDetailDto;
    expect(detail.summaries.find((s) => s.active)?.content).toBe('Edited: Carla ok');
    expect(
      detail.summaries.some((s) => s.origin === 'edit' && s.content.includes('Marketing')),
    ).toBe(true);
  });

  it('adds no version when the summary does not mention the name', async () => {
    const { meeting, dana } = await meet({ content: 'Nothing about names' });
    const body = (await (
      await call('PUT', `/meetings/${meeting.id}/participants/${dana.id}`, { name: 'Dana' })
    ).json()) as ParticipantsDto;
    expect(body.summaryUpdated).toBe(false);
    expect(
      await test.db.select().from(summaries).where(eq(summaries.meetingId, meeting.id)),
    ).toHaveLength(1);
  });

  it('uses the display name in the transcript and shows the meeting name in the attendees', async () => {
    const { meeting, carla } = await meet();
    await call('PUT', `/meetings/${meeting.id}/participants/${carla.id}`, { name: 'Carla' });
    const detail = (await (
      await call('GET', `/meetings/${meeting.id}`)
    ).json()) as MeetingDetailDto;
    expect(detail.segments[0]?.speaker).toBe('Carla');
    const minutes = await assembleMinutes(
      { db: test.db, settings: new SettingsStore(test.db, secret) },
      meeting.id,
    );
    expect(minutes?.attendees).toContainEqual({
      name: 'Carla',
      email: null,
      joinedAs: 'Marketing Acme',
    });
    expect(minutes?.transcript[0]?.speaker).toBe('Carla');
  });

  it('remembers the name only when asked, and resetting it forgets it', async () => {
    const { meeting, carla } = await meet();
    const path = `/meetings/${meeting.id}/participants/${carla.id}`;
    await call('PUT', path, { name: 'Carla' });
    expect(await test.db.select().from(participantAliases)).toHaveLength(0);

    await call('PUT', path, { name: 'Carla', remember: true });
    await call('PUT', path, { name: 'Carla B', remember: true });
    expect(await test.db.select().from(participantAliases)).toMatchObject([
      { originalName: 'Marketing Acme', displayName: 'Carla B' },
    ]);

    await call('PUT', path, { name: 'Marketing Acme', remember: true });
    expect(await test.db.select().from(participantAliases)).toHaveLength(0);
  });

  it('rejects bad names and unknown participants', async () => {
    const { meeting, carla } = await meet();
    const other = await meet();
    const path = `/meetings/${meeting.id}/participants/${carla.id}`;
    expect((await call('PUT', path, { name: '  ' })).status).toBe(400);
    expect((await call('PUT', path, { name: 'x'.repeat(81) })).status).toBe(400);
    expect((await call('PUT', path, { name: 'Bo\u0007' })).status).toBe(400);
    expect(
      (await call('PUT', `/meetings/${other.meeting.id}/participants/${carla.id}`, { name: 'Bo' }))
        .status,
    ).toBe(404);
    expect(
      (await call('PUT', `/meetings/${meeting.id}/participants/nope`, { name: 'Bo' })).status,
    ).toBe(404);
    expect((await call('GET', '/meetings/nope/participants')).status).toBe(404);
  });

  it('lists, edits and deletes remembered names in the settings', async () => {
    await test.db.delete(participantAliases);
    const [alias] = await test.db
      .insert(participantAliases)
      .values({ originalName: 'Dana Keller', displayName: 'Dana' })
      .returning();
    if (!alias) throw new Error('insert failed');

    const listed = (await (
      await call('GET', '/settings/participant-aliases')
    ).json()) as ParticipantAliasesDto;
    expect(listed.aliases).toEqual([
      { id: alias.id, originalName: 'Dana Keller', displayName: 'Dana' },
    ]);
    const edited = (await (
      await call('PUT', `/settings/participant-aliases/${alias.id}`, { displayName: 'Den' })
    ).json()) as ParticipantAliasesDto;
    expect(edited.aliases[0]?.displayName).toBe('Den');
    expect(
      (await call('PUT', `/settings/participant-aliases/${alias.id}`, { displayName: '' })).status,
    ).toBe(400);
    const removed = (await (
      await call('DELETE', `/settings/participant-aliases/${alias.id}`)
    ).json()) as ParticipantAliasesDto;
    expect(removed.aliases).toEqual([]);
    expect((await call('DELETE', `/settings/participant-aliases/${alias.id}`)).status).toBe(404);
  });
});
