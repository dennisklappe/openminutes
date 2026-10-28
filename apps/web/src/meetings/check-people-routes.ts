import { ensurePerson, isTracked, type JobSender, type SettingsStore } from '@openminutes/core';
import { and, eq, meetings, participants, people, sql, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { CheckPeopleDto } from '../dto.js';
import { rememberEnabled } from '../voices/load.js';
import { nameVoice } from '../voices/rename.js';
import { learnableLines, loadCheckPeople, markChecked } from './check-people.js';

interface CheckRouteDeps {
  db: Database;
  queue: JobSender;
  settings: SettingsStore;
}

const uuid = z.uuid();
const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/\p{Cc}/u.test(value));
const confirmInput = z.object({
  voices: z
    .array(
      z
        .object({
          participantId: uuid,
          personId: uuid.optional(),
          name: name.optional(),
          email: z.email().max(254).optional(),
        })
        .refine((voice) => (voice.personId === undefined) !== (voice.name === undefined)),
    )
    .min(1)
    .max(12),
});

export function checkPeopleRoutes(deps: CheckRouteDeps): Hono {
  const routes = new Hono();

  const findMeeting = async (rawId: string) => {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, id.data));
    return meeting;
  };

  routes.get('/:id/check-people', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    return c.json<CheckPeopleDto>(await loadCheckPeople(deps, meeting));
  });

  routes.post('/:id/check-people/dismiss', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    await markChecked(deps.settings, meeting.id);
    return c.json<CheckPeopleDto>(await loadCheckPeople(deps, meeting));
  });

  /**
   * Gives the named voices their confirmed names, like naming a voice does. With Learn voices on,
   * the lines of each confirmed voice are queued for learning, the same job verifying a line
   * queues. A voice that is not in the request keeps its label and teaches nothing.
   */
  routes.post('/:id/check-people/confirm', async (c) => {
    const meeting = await findMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    const body = confirmInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Pick a person or type a name for each voice' }, 400);
    const seats = await deps.db
      .select()
      .from(participants)
      .where(eq(participants.meetingId, meeting.id));
    const chosen = [];
    for (const voice of body.data.voices) {
      const seat = seats.find((s) => s.id === voice.participantId);
      if (!seat) return c.json({ error: 'Voice not found' }, 404);
      let target = voice.name;
      if (voice.personId) {
        const [person] = await deps.db.select().from(people).where(eq(people.id, voice.personId));
        if (!person) return c.json({ error: 'Person not found' }, 404);
        target = person.name;
      }
      if (!target) return c.json({ error: 'Pick a person or type a name for each voice' }, 400);
      chosen.push({ seat, name: target, email: voice.email });
    }
    const names = chosen.map((voice) => voice.name.toLowerCase());
    if (
      new Set(names).size !== names.length ||
      new Set(chosen.map((v) => v.seat.id)).size !== names.length
    ) {
      return c.json({ error: 'Each voice needs a different person' }, 400);
    }
    const learn = await rememberEnabled(deps.settings);
    for (const voice of chosen) {
      const person = await ensurePerson(deps.db, voice.name, voice.email ?? null);
      await nameVoice(deps.db, voice.seat, person.name, false);
      if (!learn || !(await isTracked(deps.db, person.id))) continue;
      const [survivor] = await deps.db
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(
            eq(participants.meetingId, meeting.id),
            sql`lower(${participants.displayName}) = lower(${person.name})`,
          ),
        );
      const segmentIds = survivor ? await learnableLines(deps.db, survivor.id) : [];
      if (survivor && segmentIds.length > 0) {
        await deps.queue.send('meeting.learn-voice', {
          meetingId: meeting.id,
          participantId: survivor.id,
          segmentIds,
        });
      }
    }
    await markChecked(deps.settings, meeting.id);
    return c.json<CheckPeopleDto>(await loadCheckPeople(deps, meeting));
  });

  return routes;
}
