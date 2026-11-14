import { expect, it } from 'vitest';
import { webhookDeliveries, webhookEndpoints } from './schema.js';
import { createTestDatabase } from './testing/index.js';

it('creates the webhook endpoints and the delivery outbox with their defaults', async () => {
  const test = await createTestDatabase();
  const [endpoint] = await test.db
    .insert(webhookEndpoints)
    .values({
      name: 'Receiver',
      url: 'https://hooks.example.test/in',
      secretEncrypted: 'v1:x',
      secretPrefix: 'whsec_abcd',
      events: ['meeting.transcribed', 'meeting.deleted'],
    })
    .returning();
  expect(endpoint).toMatchObject({
    events: ['meeting.transcribed', 'meeting.deleted'],
    active: true,
    allowPrivate: false,
    filter: {},
    consecutiveFailures: 0,
    disabledReason: null,
  });
  const [delivery] = await test.db
    .insert(webhookDeliveries)
    .values({
      endpointId: endpoint?.id ?? '',
      event: 'meeting.transcribed',
      eventId: '00000000-0000-4000-8000-000000000000',
      payload: { id: 'x' },
    })
    .returning();
  expect(delivery).toMatchObject({
    status: 'pending',
    kind: 'event',
    attempts: 0,
    meetingId: null,
  });
  // Deleting the endpoint removes its log.
  await test.db.delete(webhookEndpoints);
  expect(await test.db.select().from(webhookDeliveries)).toEqual([]);
  await test.close();
});
