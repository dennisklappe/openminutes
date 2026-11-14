import { eq, webhookDeliveries, webhookEndpoints, type Database } from '@openminutes/db';

/** An endpoint that listens to the worker's events. Nothing is sent: no dispatcher runs. */
export const listen = (db: Database) =>
  db.insert(webhookEndpoints).values({
    name: 'Receiver',
    url: 'https://hooks.example.test/in',
    secretEncrypted: 'unused',
    secretPrefix: 'whsec_test',
    events: ['meeting.transcribed', 'meeting.summarized', 'meeting.updated'],
  });

/** The events queued for a meeting. */
export async function webhookEvents(db: Database, meetingId: string) {
  const rows = await db
    .select({ event: webhookDeliveries.event })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.meetingId, meetingId));
  return rows.map((row) => row.event);
}
