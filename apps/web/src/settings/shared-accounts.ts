import {
  forgetAccount,
  listRememberedAccounts,
  waitMinutes,
  type SettingsStore,
} from '@openminutes/core';
import type { Database } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { SharedAccountsDto } from '../dto.js';

const input = z.strictObject({ waitMinutes: z.number().int().min(0).max(1440) });

/** How long the summary waits for "how many people?", and the accounts the owner answered for. */
export function sharedAccountsSettingsRoutes({
  db,
  settings,
}: {
  db: Database;
  settings: SettingsStore;
}): Hono {
  const routes = new Hono();

  const read = async (): Promise<SharedAccountsDto> => ({
    waitMinutes: waitMinutes(await settings.get('summary.shared_wait_minutes')),
    accounts: await listRememberedAccounts(db),
  });

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: 'Minutes must be a whole number from 0 to 1440' }, 400);
    await settings.set('summary.shared_wait_minutes', String(body.data.waitMinutes));
    return c.json(await read());
  });

  /** Forgets the count: the next meeting from this account asks again. The people stay. */
  routes.delete('/:id', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success || !(await forgetAccount(db, id.data))) {
      return c.json({ error: 'Account not found' }, 404);
    }
    return c.json(await read());
  });

  return routes;
}
