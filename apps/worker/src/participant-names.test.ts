import { SettingsStore } from '@openminutes/core';
import { meetings, participants } from '@openminutes/db';
import { createTestDatabase } from '@openminutes/db/testing';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { participantInstructions } from './participant-names.js';

let test: Awaited<ReturnType<typeof createTestDatabase>>;
let settings: SettingsStore;

beforeAll(async () => {
  test = await createTestDatabase();
  settings = new SettingsStore(test.db, 'a-long-enough-test-secret');
});
afterAll(() => test.close());

async function meetingWith(...people: Omit<typeof participants.$inferInsert, 'meetingId'>[]) {
  const [meeting] = await test.db
    .insert(meetings)
    .values({ title: 't', platform: 'meet', joinUrl: 'https://meet.google.com/abc' })
    .returning();
  if (!meeting) throw new Error('insert failed');
  if (people.length > 0) {
    await test.db.insert(participants).values(people.map((p) => ({ ...p, meetingId: meeting.id })));
  }
  return meeting.id;
}

it('lists the display names with the name they joined as, without the bot or generic labels', async () => {
  const id = await meetingWith(
    { displayName: 'Carla', originalName: 'Marketing Acme' },
    { displayName: 'Dana', originalName: 'Dana' },
    { displayName: 'Speaker 1' },
    { displayName: 'OpenMinutes Notetaker' },
  );
  const text = await participantInstructions(test.db, settings, id);
  expect(text).toContain('Carla (joined as Marketing Acme), Dana.');
  expect(text).not.toContain('Speaker 1');
  expect(text).not.toContain('Notetaker');
});

it('adds nothing when nobody is named', async () => {
  expect(await participantInstructions(test.db, settings, await meetingWith())).toBe('');
});
