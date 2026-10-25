import {
  disconnectAccount,
  canExport,
  canWriteCalendar,
  setJoinRule,
  type CalendarContext,
} from '@openminutes/calendar';
import {
  calendarAccounts,
  calendarProviders,
  calendars,
  desc,
  joinRules,
  type CalendarProviderId,
} from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AccountsDto, CalendarAccountDto, ProviderSettingsDto } from '../dto.js';
import { publicOrigin, redirectPath } from './origin.js';

interface AccountDeps {
  calendar: CalendarContext;
  publicUrl: string | undefined;
}

const uuid = z.uuid();
const providerParam = z.enum(calendarProviders);
const providerBody = z.object({
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().min(1).max(2048).optional(),
  tenant: z
    .string()
    .trim()
    .regex(/^[\w.-]{1,128}$/)
    .optional(),
});
const ruleBody = z.object({ joinRule: z.enum(joinRules) });

export function accountRoutes(deps: AccountDeps): Hono {
  const { db, settings, queue } = deps.calendar;
  const routes = new Hono();

  async function providerSettings(
    provider: CalendarProviderId,
    origin: string,
  ): Promise<ProviderSettingsDto> {
    const [clientId, clientSecret, tenant] = await Promise.all([
      settings.get(`${provider}.client_id`),
      settings.get(`${provider}.client_secret`),
      provider === 'microsoft' ? settings.get('microsoft.tenant') : undefined,
    ]);
    return {
      redirectUri: `${origin}${redirectPath(provider)}`,
      clientId: clientId ?? null,
      hasClientSecret: clientSecret !== undefined,
      ...(tenant && { tenant }),
    };
  }

  routes.get('/', async (c) => {
    const origin = publicOrigin(c, deps.publicUrl);
    const [accountRows, calendarRows] = await Promise.all([
      db.select().from(calendarAccounts).orderBy(desc(calendarAccounts.createdAt)),
      db.select().from(calendars).orderBy(desc(calendars.isPrimary), calendars.name),
    ]);
    const accounts = accountRows.map((account): CalendarAccountDto => ({
      id: account.id,
      provider: account.provider,
      email: account.accountEmail,
      canExport: canExport(account, deps.calendar.secret),
      canWriteCalendar: canWriteCalendar(account, deps.calendar.secret),
      error: account.lastError,
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
      calendars: calendarRows
        .filter((calendar) => calendar.accountId === account.id)
        .map((calendar) => ({
          id: calendar.id,
          name: calendar.name,
          isPrimary: calendar.isPrimary,
          joinRule: calendar.joinRule,
        })),
    }));
    return c.json<AccountsDto>({
      providers: {
        google: await providerSettings('google', origin),
        microsoft: await providerSettings('microsoft', origin),
      },
      accounts,
    });
  });

  routes.put('/providers/:provider', async (c) => {
    const provider = providerParam.safeParse(c.req.param('provider'));
    const body = providerBody.safeParse(await c.req.json().catch(() => null));
    if (!provider.success) return c.json({ error: 'Unknown provider' }, 404);
    if (!body.success) return c.json({ error: 'A client ID is required' }, 400);
    await settings.set(`${provider.data}.client_id`, body.data.clientId);
    if (body.data.clientSecret)
      await settings.set(`${provider.data}.client_secret`, body.data.clientSecret);
    if (provider.data === 'microsoft' && body.data.tenant) {
      await settings.set('microsoft.tenant', body.data.tenant);
    }
    return c.json({ ok: true });
  });

  routes.put('/calendars/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    const body = ruleBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Unknown join rule' }, 400);
    if (!id.success || !(await setJoinRule(deps.calendar, id.data, body.data.joinRule))) {
      return c.json({ error: 'Calendar not found' }, 404);
    }
    return c.json({ ok: true });
  });

  routes.post('/:id/sync', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Account not found' }, 404);
    await queue.send('calendar.sync', { accountId: id.data });
    return c.json({ ok: true });
  });

  routes.delete('/:id', async (c) => {
    const id = uuid.safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'Account not found' }, 404);
    await disconnectAccount(deps.calendar, id.data);
    return c.json({ ok: true });
  });

  return routes;
}
