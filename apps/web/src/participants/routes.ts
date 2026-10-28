import { and, eq, meetings, participants } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ParticipantsDto, SpeakerIdentityDto, SpeakerIdentityResultDto } from '../dto.js';
import { loadParticipants, type ParticipantDeps } from './load.js';
import {
  dismissInvitee,
  invitedEmail,
  linkInvitee,
  linkInviteeToPerson,
  resolveLinks,
} from './invitee-links.js';
import { PeopleError, peopleErrorBody } from '../people/edit.js';
import { loadIdentity, saveIdentity, saveIdentityMerging } from './identity.js';
import { rememberEnabled } from '../voices/load.js';
import { renameParticipant } from './rename.js';
import { assertSharedLinksFree, isSubSeat } from './shared-rules.js';

const uuid = z.uuid();
const input = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((name) => !/\p{Cc}/u.test(name)),
  remember: z.boolean().optional(),
  /** Take the addresses from the person of the same shared account who has them. */
  move: z.boolean().optional(),
  /** Every invitee this person is. Left out keeps the links, [] removes them. */
  inviteeEmails: z.array(z.string()).max(20).optional(),
  /** The address of someone who is not on the invitation, empty or null to clear it. */
  email: z
    .union([z.email().max(254), z.literal('')])
    .nullable()
    .optional(),
});
const identityInput = z.object({
  name: input.shape.name,
  emails: z.array(z.string().trim().max(254).pipe(z.email())).max(20),
  remember: z.boolean().optional(),
  move: z.boolean().optional(),
  mergeFrom: z.uuid().optional(),
});
const linkInput = z.object({ email: z.string().nullable(), move: z.boolean().optional() });
const personLinkInput = z.object({ email: z.string(), move: z.boolean().optional() });
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
    try {
      if ((await isSubSeat(deps.db, person)) && body.data.name !== person.displayName) {
        return c.json({ error: 'Use Name to give this voice a name' }, 409);
      }
      await assertSharedLinksFree(
        deps.db,
        person,
        { inviteeEmails: links || undefined, email: body.data.email },
        body.data.move === true,
      );
    } catch (error) {
      if (error instanceof PeopleError) return c.json(peopleErrorBody(error), error.status);
      throw error;
    }
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

  routes.get('/:id/participants/:participantId/identity', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    const person = meeting && (await findParticipant(meeting.id, c.req.param('participantId')));
    if (!meeting || !person) return c.json({ error: 'Participant not found' }, 404);
    const typed = c.req.query('name');
    return c.json<SpeakerIdentityDto>(await loadIdentity(deps.db, meeting, person, typed));
  });

  /** Renames a speaker and sets the addresses of its person in one go. */
  routes.put('/:id/participants/:participantId/identity', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    const person = meeting && (await findParticipant(meeting.id, c.req.param('participantId')));
    if (!meeting || !person) return c.json({ error: 'Participant not found' }, 404);
    const body = identityInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Check the name and the email addresses' }, 400);
    try {
      const change = {
        name: body.data.name,
        emails: body.data.emails,
        remember: body.data.remember === true && (await rememberEnabled(deps.settings)),
        move: body.data.move === true,
      };
      const { seatId, summaryUpdated } = body.data.mergeFrom
        ? await saveIdentityMerging(deps.db, meeting, person, change, body.data.mergeFrom)
        : await saveIdentity(deps.db, meeting, person, change);
      const [seat] = await deps.db.select().from(participants).where(eq(participants.id, seatId));
      if (!seat) return c.json({ error: 'Participant not found' }, 404);
      return c.json<SpeakerIdentityResultDto>({
        identity: await loadIdentity(deps.db, meeting, seat),
        summaryUpdated,
      });
    } catch (error) {
      if (error instanceof PeopleError) return c.json(peopleErrorBody(error), error.status);
      throw error;
    }
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
    try {
      await assertSharedLinksFree(
        deps.db,
        person,
        { inviteeEmails: link },
        body.data.move === true,
      );
    } catch (error) {
      if (error instanceof PeopleError) return c.json(peopleErrorBody(error), error.status);
      throw error;
    }
    await linkInvitee(deps.db, person.id, link[0] ?? null);
    return c.json<ParticipantsDto>(await read(meeting.id, false));
  });

  /** "They were there" for someone from People who has no seat in this meeting yet. */
  routes.put('/:id/people/:personId/invitee', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    const personId = uuid.safeParse(c.req.param('personId'));
    if (!meeting || !personId.success) return c.json({ error: 'Meeting not found' }, 404);
    const body = personLinkInput.safeParse(await c.req.json().catch(() => null));
    const link = body.success ? resolveLinks(meeting, [body.data.email]) : false;
    if (!body.success || link === false) {
      return c.json({ error: 'That person was not invited' }, 400);
    }
    try {
      const [seat] = await deps.db
        .select()
        .from(participants)
        .where(
          and(eq(participants.meetingId, meeting.id), eq(participants.personId, personId.data)),
        );
      await assertSharedLinksFree(
        deps.db,
        seat ?? { id: '', meetingId: meeting.id, personId: personId.data },
        { inviteeEmails: link },
        body.data.move === true,
      );
      await linkInviteeToPerson(deps.db, meeting.id, personId.data, link[0] ?? '');
    } catch (error) {
      if (error instanceof PeopleError) return c.json(peopleErrorBody(error), error.status);
      throw error;
    }
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
