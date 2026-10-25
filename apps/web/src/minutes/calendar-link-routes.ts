import { CALENDAR_LINK_RETRY, type JobSender } from '@openminutes/core';
import { eq, meetingSources, type Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';

interface CalendarLinkDeps {
  db: Database;
  queue: JobSender;
}

const uuid = z.uuid();

export function calendarLinkActionRoutes({ db, queue }: CalendarLinkDeps): Hono {
  return new Hono().post('/:id/calendar-link', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Meeting not found' }, 404);
    const [source] = await db
      .select({ id: meetingSources.id })
      .from(meetingSources)
      .where(eq(meetingSources.meetingId, id.data))
      .limit(1);
    if (!source) return c.json({ error: 'This meeting has no calendar event' }, 409);
    await queue.send(
      'meeting.calendar-link',
      { meetingId: id.data, force: true },
      CALENDAR_LINK_RETRY,
    );
    return c.json({ ok: true }, 202);
  });
}
