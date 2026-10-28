import { isTracked, type JobSender, type SettingsStore } from '@openminutes/core';
import { eq, meetings, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { RoomReviewDto } from '../dto.js';
import { PeopleError } from '../people/edit.js';
import { rememberEnabled } from '../voices/load.js';
import { dismissRoom, loadRoomReview, nameRoomVoice } from './room-voices.js';

interface RoomDeps {
  db: Database;
  queue: JobSender;
  settings: SettingsStore;
}

const uuid = z.uuid();
const nameInput = z.union([
  z.strictObject({ personId: uuid }),
  z.strictObject({
    newName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((value) => !/\p{Cc}/u.test(value)),
  }),
]);

/** Meeting rooms: several people in one participant tile, named by the owner. */
export function roomRoutes(deps: RoomDeps): Hono {
  const routes = new Hono();

  const found = async (rawId: string) => {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, id.data));
    return meeting;
  };

  routes.get('/:id/room/:participantId', async (c) => {
    const meeting = await found(c.req.param('id'));
    const participantId = uuid.safeParse(c.req.param('participantId'));
    if (!meeting || !participantId.success) return c.json({ error: 'Meeting not found' }, 404);
    const review = await loadRoomReview(
      deps.db,
      await rememberEnabled(deps.settings),
      meeting.id,
      participantId.data,
    );
    return review
      ? c.json<RoomReviewDto>(review)
      : c.json({ error: 'No shared voices in this participant' }, 404);
  });

  routes.post('/:id/room-voices/:voiceId/name', async (c) => {
    const meeting = await found(c.req.param('id'));
    const voiceId = uuid.safeParse(c.req.param('voiceId'));
    if (!meeting || !voiceId.success) return c.json({ error: 'Voice not found' }, 404);
    const body = nameInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Pick a person or type a name' }, 400);
    try {
      const { learn, personId } = await nameRoomVoice(deps.db, meeting.id, voiceId.data, body.data);
      if (learn && (await isTracked(deps.db, personId)) && (await rememberEnabled(deps.settings))) {
        await deps.queue.send('meeting.learn-voice', learn);
      }
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof PeopleError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  routes.post('/:id/room/:participantId/dismiss', async (c) => {
    const meeting = await found(c.req.param('id'));
    const participantId = uuid.safeParse(c.req.param('participantId'));
    if (!meeting || !participantId.success) return c.json({ error: 'Meeting not found' }, 404);
    try {
      await dismissRoom(deps.db, meeting.id, participantId.data);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof PeopleError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  return routes;
}
