import { isTracked, type JobSender, type SettingsStore } from '@openminutes/core';
import { eq, meetings, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { RoomChangePreviewDto, RoomReviewDto } from '../dto.js';
import { PeopleError } from '../people/edit.js';
import { rememberEnabled } from '../voices/load.js';
import { changeRoomVoice, previewVoiceChange } from './room-change.js';
import { dismissRoom, loadRoomReview, nameRoomVoice, setRoomCount } from './room-voices.js';

interface RoomDeps {
  db: Database;
  queue: JobSender;
  settings: SettingsStore;
}

const uuid = z.uuid();
const countInput = z.union([
  z.strictObject({ count: z.number().int().min(1).max(4) }),
  z.strictObject({ unsure: z.literal(true) }),
]);
const newName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/\p{Cc}/u.test(value));
const removeEmails = z.array(z.string().max(254)).max(20).optional();
const emailFields = {
  inviteeEmails: z.array(z.string().max(254)).max(20).optional(),
  email: z
    .union([z.email().max(254), z.literal('')])
    .nullable()
    .optional(),
  move: z.boolean().optional(),
};
const nameInput = z.union([
  z.strictObject({ personId: uuid, ...emailFields }),
  z.strictObject({ newName, ...emailFields }),
]);
const changeInput = z.union([
  z.strictObject({ personId: uuid, ...emailFields, removeEmails: removeEmails }),
  z.strictObject({ newName, ...emailFields, removeEmails: removeEmails }),
  z.strictObject({ unnamed: z.literal(true), removeEmails: removeEmails }),
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
      const { learn, personId } = await nameRoomVoice(deps.db, meeting.id, voiceId.data, {
        ...body.data,
        ...('email' in body.data && { email: body.data.email || null }),
      });
      if (learn && (await isTracked(deps.db, personId)) && (await rememberEnabled(deps.settings))) {
        await deps.queue.send('meeting.learn-voice', learn);
      }
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof PeopleError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  routes.get('/:id/room-voices/:voiceId/change', async (c) => {
    const meeting = await found(c.req.param('id'));
    const voiceId = uuid.safeParse(c.req.param('voiceId'));
    if (!meeting || !voiceId.success) return c.json({ error: 'Voice not found' }, 404);
    try {
      return c.json<RoomChangePreviewDto>(
        await previewVoiceChange(deps.db, meeting.id, voiceId.data),
      );
    } catch (error) {
      if (error instanceof PeopleError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  routes.post('/:id/room-voices/:voiceId/change', async (c) => {
    const meeting = await found(c.req.param('id'));
    const voiceId = uuid.safeParse(c.req.param('voiceId'));
    if (!meeting || !voiceId.success) return c.json({ error: 'Voice not found' }, 404);
    const body = changeInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Pick a person, type a name or unname it' }, 400);
    try {
      const { learn, personId } = await changeRoomVoice(deps.db, meeting.id, voiceId.data, {
        ...body.data,
        ...('email' in body.data && { email: body.data.email || null }),
      });
      if (learn && (await isTracked(deps.db, personId)) && (await rememberEnabled(deps.settings))) {
        await deps.queue.send('meeting.learn-voice', learn);
      }
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof PeopleError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });

  routes.post('/:id/room/:participantId/count', async (c) => {
    const meeting = await found(c.req.param('id'));
    const participantId = uuid.safeParse(c.req.param('participantId'));
    if (!meeting || !participantId.success) return c.json({ error: 'Meeting not found' }, 404);
    const body = countInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Pick a number from 1 to 4, or not sure' }, 400);
    try {
      const { splitting } = await setRoomCount(
        deps.db,
        deps.queue,
        meeting.id,
        participantId.data,
        body.data,
      );
      return c.json({ ok: true, splitting });
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
