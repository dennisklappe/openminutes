import { eq, meetings, participants } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ParticipantsDto } from '../dto.js';
import { loadParticipants, type ParticipantDeps } from './load.js';
import { dismissInvitee, invitedEmail, linkInvitee, resolveLinks } from './invitee-links.js';
import { renameParticipant } from './rename.js';

const uuid = z.uuid();
const input = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((name) => !/\p{Cc}/u.test(name)),
  remember: z.boolean().optional(),
  /** Every invitee this person is. Left out keeps the links, [] removes them. */
  inviteeEmails: z.array(z.string()).max(20).optional(),
  /** The address of someone who is not on the invitation, empty or null to clear it. */
  email: z
    .union([z.email().max(254), z.literal('')])
    .nullable()
    .optional(),
});
const linkInput = z.object({ email: z.string().nullable() });
const dismissInput = z.object({ email: z.string() });

export function meetingParticipantRoutes(deps: ParticipantDeps): Hono {
  const routes = new Hono();

  const findMeeting = async (rawId: string) => {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, id.data));
    return meeting;
  };

  const read = async (meetingId: string, summaryUpdated: boolean): Promise<ParticipantsDto> => ({
    ...(await loadParticipants(deps, meetingId)),
    summaryUpdated,
  });

  const findParticipant = async (meetingId: string, rawId: string) => {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const [person] = await deps.db.select().from(participants).where(eq(participants.id, id.data));
    return person?.meetingId === meetingId ? person : undefined;
  };

  routes.get('/:id/participants', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    return c.json<ParticipantsDto>(await read(meeting.id, false));
  });

  routes.put('/:id/participants/:participantId', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    const person = meeting && (await findParticipant(meeting.id, c.req.param('participantId')));
    if (!meeting || !person) return c.json({ error: 'Participant not found' }, 404);
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'The name must be 1 to 80 characters' }, 400);
    const links = body.data.inviteeEmails && resolveLinks(meeting, body.data.inviteeEmails);
    if (links === false) return c.json({ error: 'That person was not invited' }, 400);
    const { summaryUpdated } = await renameParticipant(
      deps.db,
      person,
      body.data.name,
      body.data.remember === true,
      {
        ...(links && { inviteeEmails: links }),
        ...(body.data.email !== undefined && { email: body.data.email || null }),
      },
    );
    return c.json<ParticipantsDto>(await read(meeting.id, summaryUpdated));
  });

  routes.put('/:id/participants/:participantId/invitee', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    const person = meeting && (await findParticipant(meeting.id, c.req.param('participantId')));
    if (!meeting || !person) return c.json({ error: 'Participant not found' }, 404);
    const body = linkInput.safeParse(await c.req.json().catch(() => null));
    const link =
      body.success && body.data.email !== null ? resolveLinks(meeting, [body.data.email]) : [];
    if (!body.success || link === false) {
      return c.json({ error: 'That person was not invited' }, 400);
    }
    await linkInvitee(deps.db, person.id, link[0] ?? null);
    return c.json<ParticipantsDto>(await read(meeting.id, false));
  });

  routes.post('/:id/dismissed-invitees', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    const body = dismissInput.safeParse(await c.req.json().catch(() => null));
    const email = body.success && invitedEmail(meeting, body.data.email);
    if (!email) return c.json({ error: 'That person was not invited' }, 400);
    await dismissInvitee(deps.db, meeting, email);
    return c.json<ParticipantsDto>(await read(meeting.id, false));
  });

  return routes;
}
