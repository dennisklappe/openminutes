import {
  eq,
  meetings,
  participantAliases,
  participants,
  speakerEvents,
  type Database,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { expect, it } from 'vitest';
import { saveRoom } from './room-store.js';

async function createMeetingRow(db: Database): Promise<string> {
  const [meeting] = await db
    .insert(meetings)
    .values({ title: 'Sync', platform: 'meet', joinUrl: 'https://meet.google.com/abc-defg-hij' })
    .returning({ id: meetings.id });
  if (!meeting) throw new Error('meeting was not created');
  return meeting.id;
}

it('stores participants with absolute times and speaker events linked to them', async () => {
  const test = await createTestDatabase();
  const meetingId = await createMeetingRow(test.db);
  const startedAt = new Date('2026-10-20T10:00:00Z');

  await saveRoom(test.db, meetingId, startedAt, {
    participants: [
      { name: 'Alice', joinedMs: 0, leftMs: 60_000 },
      { name: 'Bob', joinedMs: 5_000, leftMs: 30_000 },
    ],
    speakerEvents: [
      { name: 'Bob', startMs: 6_000, endMs: 9_000 },
      { name: 'Alice', startMs: 10_000, endMs: 12_000 },
      { name: 'Ghost', startMs: 13_000, endMs: 14_000 },
    ],
  });

  const people = await test.db
    .select()
    .from(participants)
    .where(eq(participants.meetingId, meetingId));
  const bob = people.find((p) => p.displayName === 'Bob');
  expect(bob?.joinedAt?.toISOString()).toBe('2026-10-20T10:00:05.000Z');
  expect(bob?.leftAt?.toISOString()).toBe('2026-10-20T10:00:30.000Z');

  const events = await test.db.select().from(speakerEvents).orderBy(speakerEvents.startMs);
  expect(events.map((e) => [e.startMs, e.endMs])).toEqual([
    [6_000, 9_000],
    [10_000, 12_000],
  ]);
  expect(events[0]?.participantId).toBe(bob?.id);
  await test.close();
});

it('stores nothing for an empty room', async () => {
  const test = await createTestDatabase();
  const meetingId = await createMeetingRow(test.db);
  await saveRoom(test.db, meetingId, new Date(), { participants: [], speakerEvents: [] });
  expect(await test.db.select().from(participants)).toEqual([]);
  await test.close();
});

it('applies a remembered alias and keeps the name used in the meeting', async () => {
  const test = await createTestDatabase();
  const meetingId = await createMeetingRow(test.db);
  await test.db.insert(participantAliases).values({
    originalName: 'Marketing Acme',
    displayName: 'Carla',
    inviteeEmails: ['carla@acme.example'],
    email: 'carla.private@example.com',
  });

  await saveRoom(test.db, meetingId, new Date('2026-10-20T10:00:00Z'), {
    participants: [
      { name: 'marketing acme', joinedMs: 0, leftMs: 60_000 },
      { name: 'Bob', joinedMs: 5_000, leftMs: 30_000 },
    ],
    speakerEvents: [{ name: 'marketing acme', startMs: 6_000, endMs: 9_000 }],
  });

  const people = await test.db
    .select()
    .from(participants)
    .where(eq(participants.meetingId, meetingId))
    .orderBy(participants.displayName);
  expect(people.map((p) => [p.displayName, p.inviteeEmails])).toEqual([
    ['Bob', []],
    ['Carla', ['carla@acme.example']],
  ]);
  expect(people.map((p) => [p.displayName, p.originalName])).toEqual([
    ['Bob', 'Bob'],
    ['Carla', 'marketing acme'],
  ]);
  expect(people.map((p) => p.email)).toEqual([null, 'carla.private@example.com']);
  const events = await test.db.select().from(speakerEvents);
  expect(events.map((e) => e.participantId)).toEqual([people[1]?.id]);
  await test.close();
});

it('flags the notetaker itself, by the configured name too', async () => {
  const test = await createTestDatabase();
  const meetingId = await createMeetingRow(test.db);

  await saveRoom(
    test.db,
    meetingId,
    new Date('2026-10-20T10:00:00Z'),
    {
      participants: [
        { name: 'Alice', joinedMs: 0, leftMs: null },
        { name: 'Scribe Bot (Guest)', joinedMs: 0, leftMs: null },
        { name: 'openminutes notetaker', joinedMs: 0, leftMs: null },
      ],
      speakerEvents: [],
    },
    'Scribe Bot',
  );

  const people = await test.db
    .select()
    .from(participants)
    .where(eq(participants.meetingId, meetingId));
  expect(people.map((p) => [p.displayName, p.isBot]).sort()).toEqual([
    ['Alice', false],
    ['Scribe Bot (Guest)', true],
    ['openminutes notetaker', true],
  ]);
  await test.close();
});
