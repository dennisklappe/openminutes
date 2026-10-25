import { eq, meetings, participants } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { VoicesDto } from '../dto.js';
import { loadVoices, rememberEnabled, type VoiceDeps } from './load.js';
import { nameVoice } from './rename.js';

const uuid = z.uuid();
const input = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((name) => !/\p{Cc}/u.test(name)),
  remember: z.boolean().optional(),
});

export function meetingVoiceRoutes(deps: VoiceDeps): Hono {
  const routes = new Hono();

  const findMeeting = async (rawId: string) => {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, id.data));
    return meeting;
  };

  routes.get('/:id/voices', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    return c.json<VoicesDto>(await loadVoices(deps, meeting));
  });

  routes.put('/:id/voices/:participantId', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    const participantId = uuid.safeParse(c.req.param('participantId'));
    if (!meeting || !participantId.success) return c.json({ error: 'Voice not found' }, 404);
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'The name must be 1 to 80 characters' }, 400);
    const [voice] = await deps.db
      .select()
      .from(participants)
      .where(eq(participants.id, participantId.data));
    if (voice?.meetingId !== meeting.id) return c.json({ error: 'Voice not found' }, 404);
    const remember = body.data.remember === true && (await rememberEnabled(deps.settings));
    await nameVoice(deps.db, voice, body.data.name, remember);
    return c.json<VoicesDto>(await loadVoices(deps, meeting));
  });

  return routes;
}
