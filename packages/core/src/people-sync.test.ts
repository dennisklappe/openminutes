import {
  eq,
  meetingInvitees,
  meetings,
  participants,
  people,
  type CalendarInvitee,
} from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  backfillPeople,
  isPlaceholderName,
  linkMeetingPeople,
  looksLikeBot,
  personNameFor,
} from './people-sync.js';

describe('who counts as a person', () => {
  it('drops notetakers and recorders', () => {
    for (const name of [
      'Klappe Notetaker',
      'Fireflies.ai Notetaker Anna',
      'Read.ai',
      'Otter.ai',
      'Fathom',
      'Acme Note Taker',
      'Meeting Recorder',
    ]) {
      expect(looksLikeBot(name), name).toBe(true);
    }
    expect(looksLikeBot('Anna Synthetic')).toBe(false);
  });

  it('drops placeholders, phone numbers and meeting codes', () => {
    for (const name of ['Speaker 1', 'Guest', 'Unknown', '+31 6 1234 5678', 'abc-defg-hij']) {
      expect(isPlaceholderName(name), name).toBe(true);
    }
    expect(isPlaceholderName('Guest Synthetic')).toBe(false);
  });

  it('names a nameless person from the email unless it is a role address', () => {
    expect(personNameFor(null, ['anna.synthetic@example.com'])).toBe('Anna Synthetic');
    expect(personNameFor('Guest', ['bram@example.com'])).toBe('Bram');
    expect(personNameFor(null, ['info@example.com'])).toBeUndefined();
    expect(personNameFor('Speaker 2', [])).toBeUndefined();
  });
});

describe('people from meetings', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  // The backfill walks meetings by id, so ids that rise with creation keep the order stable.
  let sequence = 0;
  const meeting = async (invitees: CalendarInvitee[] | null = null, deleted = false) => {
    sequence += 1;
    const [row] = await test.db
      .insert(meetings)
      .values({
        id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        title: 'm',
        platform: 'meet',
        joinUrl: `https://meet.google.com/${crypto.randomUUID()}`,
        invitees,
        deletedAt: deleted ? new Date() : null,
      })
      .returning();
    if (!row) throw new Error('no meeting');
    return row.id;
  };
  const join = async (
    meetingId: string,
    displayName: string,
    extra: Partial<typeof participants.$inferInsert> = {},
  ) => {
    await test.db.insert(participants).values({ meetingId, displayName, ...extra });
  };
  const invitee = (email: string, name: string | null = null): CalendarInvitee => ({
    email,
    name,
    declined: false,
  });
  const byName = async (name: string) =>
    (await test.db.select().from(people)).find((p) => p.name === name);

  it('backfills once, links by email and name, skips bots, and is idempotent', async () => {
    const one = await meeting([
      invitee('Anna@Example.com', 'Anna Synthetic'),
      invitee('carla@example.com', 'Carla Fixture'),
      invitee('bot@fireflies.ai', 'Fireflies.ai Notetaker'),
      invitee('room@resource.calendar.google.com'),
      { email: 'declined@example.com', name: 'Dora Declined', declined: true },
    ]);
    await join(one, 'Anna Synthetic', { email: 'anna@example.com' });
    await join(one, 'Klappe Notetaker', { isBot: true });
    await join(one, 'Speaker 1');
    await join(one, 'Fireflies.ai Notetaker Dennis');
    const two = await meeting();
    await join(two, 'anna synthetic');
    await join(two, 'Eva Other', { email: 'EVA@example.com' });
    const three = await meeting();
    await join(three, 'A. Synthetic', { email: 'ANNA@example.com' });
    await join(three, 'Anna');
    const gone = await meeting([invitee('ghost@example.com', 'Gina Ghost')], true);
    await join(gone, 'Gina Ghost');

    const first = await backfillPeople(test.db);
    expect(first.createdJoined).toBe(3);
    expect(first.createdInvited).toBe(1);
    const all = await test.db.select().from(people);
    expect(all.map((p) => p.name).sort()).toEqual([
      'Anna',
      'Anna Synthetic',
      'Carla Fixture',
      'Eva Other',
    ]);

    const anna = await byName('Anna Synthetic');
    expect(anna?.source).toBe('joined');
    expect(anna?.emails).toEqual(['anna@example.com']);
    const carla = await byName('Carla Fixture');
    expect(carla?.source).toBe('invited');
    expect((await byName('Eva Other'))?.emails).toEqual(['eva@example.com']);

    const linked = await test.db
      .select()
      .from(participants)
      .where(eq(participants.personId, anna?.id ?? ''));
    expect(linked.map((p) => p.meetingId).sort()).toEqual([one, two, three].sort());
    const links = await test.db.select().from(meetingInvitees);
    expect(links).toEqual([{ meetingId: one, personId: carla?.id }]);

    const unlinked = await test.db.select().from(participants);
    expect(
      unlinked
        .filter((p) => p.personId === null)
        .map((p) => p.displayName)
        .sort(),
    ).toEqual(['Fireflies.ai Notetaker Dennis', 'Gina Ghost', 'Klappe Notetaker', 'Speaker 1']);

    const again = await backfillPeople(test.db);
    expect(again).toMatchObject({
      createdJoined: 0,
      createdInvited: 0,
      linked: 0,
      invitedLinks: 0,
    });
    expect(await test.db.select().from(people)).toHaveLength(4);
  });

  it('never merges two existing people and never merges on first name only', async () => {
    const [bob] = await test.db
      .insert(people)
      .values({ name: 'Bob Synthetic', emails: ['bob@example.com'] })
      .returning();
    const [rob] = await test.db
      .insert(people)
      .values({ name: 'Bob Other', emails: ['bob.other@example.com'] })
      .returning();
    const id = await meeting();
    await join(id, 'Bob', { email: 'bob@example.com' });
    await join(id, 'Bob Unknown');
    await linkMeetingPeople(test.db, id);
    const rows = await test.db.select().from(participants).where(eq(participants.meetingId, id));
    expect(rows.find((r) => r.displayName === 'Bob')?.personId).toBe(bob?.id);
    const stranger = rows.find((r) => r.displayName === 'Bob Unknown');
    expect(stranger?.personId).not.toBe(bob?.id);
    expect(stranger?.personId).not.toBe(rob?.id);
    expect(
      (
        await test.db
          .select()
          .from(people)
          .where(eq(people.id, rob?.id ?? ''))
      )[0]?.emails,
    ).toEqual(['bob.other@example.com']);
  });

  it('moves an invited person up to joined and adds a new email once they join', async () => {
    const first = await meeting([invitee('fay@example.com', 'Fay Invited')]);
    await linkMeetingPeople(test.db, first);
    expect((await byName('Fay Invited'))?.source).toBe('invited');
    const second = await meeting();
    await join(second, 'Fay Invited', { email: 'fay.work@example.com' });
    await linkMeetingPeople(test.db, second);
    const fay = await byName('Fay Invited');
    expect(fay?.source).toBe('joined');
    expect(fay?.emails.sort()).toEqual(['fay.work@example.com', 'fay@example.com']);
  });

  it('is safe on an empty database', async () => {
    const empty = await createTestDatabase();
    try {
      expect(await backfillPeople(empty.db)).toMatchObject({ meetings: 0, createdJoined: 0 });
    } finally {
      await empty.close();
    }
  });
});

describe('people marked do not track', () => {
  let test: Awaited<ReturnType<typeof createTestDatabase>>;
  beforeAll(async () => {
    test = await createTestDatabase();
  });
  afterAll(() => test.close());

  it('backfill and the meeting hook neither link, invite nor recreate them', async () => {
    const [muted] = await test.db
      .insert(people)
      .values({ name: 'Mute Person', emails: ['mute@example.com'], tracking: 'off' })
      .returning();
    const [row] = await test.db
      .insert(meetings)
      .values({
        title: 'm',
        platform: 'meet',
        joinUrl: `https://meet.google.com/${crypto.randomUUID()}`,
        invitees: [
          { email: 'mute@example.com', name: 'Mute Person', declined: false },
          { email: 'other@example.com', name: 'Other Person', declined: false },
        ],
      })
      .returning();
    if (!row || !muted) throw new Error('insert failed');
    await test.db.insert(participants).values([
      { meetingId: row.id, displayName: 'Mute Person' },
      { meetingId: row.id, displayName: 'Other Person' },
    ]);

    await backfillPeople(test.db);
    await linkMeetingPeople(test.db, row.id);

    const seats = await test.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, row.id));
    expect(seats.find((p) => p.displayName === 'Mute Person')?.personId).toBeNull();
    expect(seats.find((p) => p.displayName === 'Other Person')?.personId).not.toBeNull();
    expect(
      await test.db.select().from(meetingInvitees).where(eq(meetingInvitees.personId, muted.id)),
    ).toEqual([]);
    const everyone = await test.db.select().from(people);
    expect(everyone.filter((p) => p.name === 'Mute Person')).toHaveLength(1);
    expect(everyone.find((p) => p.name === 'Mute Person')?.tracking).toBe('off');
  });
});
