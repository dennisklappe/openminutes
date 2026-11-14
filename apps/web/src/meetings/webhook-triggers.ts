import { emitWebhookEvent, emitWebhookEvents, type WebhookEventName } from '@openminutes/core';
import { eq, participants, type Database } from '@openminutes/db';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

const uuid = z.uuid();
const succeeded = (c: Context, methods: readonly string[]) =>
  methods.includes(c.req.method) && c.res.status < 300;

/**
 * Sends a webhook event for the meeting in the path after an edit succeeded. The edits that fire
 * `meeting.updated` and `meeting.participants_updated` come in bursts: the emit folds them into one
 * waiting delivery, and only transcribed meetings send them.
 */
export function emitAfter(db: Database, event: WebhookEventName, methods: readonly string[]) {
  return createMiddleware(async (c, next) => {
    await next();
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success || !succeeded(c, methods)) return;
    await emitWebhookEvent(db, event, id.data);
  });
}

const meetingsOf = async (db: Database, personId: string) =>
  (
    await db
      .select({ meetingId: participants.meetingId })
      .from(participants)
      .where(eq(participants.personId, personId))
  ).map((row) => row.meetingId);

/**
 * Renaming, merging or removing a person changes the participants of every meeting the person was
 * in, before and after the edit (a merge moves the seats to another person).
 */
export function emitForPersonMeetings(db: Database, methods: readonly string[]) {
  return createMiddleware(async (c, next) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success || !methods.includes(c.req.method)) return next();
    const before = await meetingsOf(db, id.data);
    await next();
    if (!succeeded(c, methods)) return;
    const after = await meetingsOf(db, id.data);
    await emitWebhookEvents(db, 'meeting.participants_updated', [
      ...new Set([...before, ...after]),
    ]);
  });
}
