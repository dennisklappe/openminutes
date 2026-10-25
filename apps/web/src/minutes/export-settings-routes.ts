import { canExport, canWriteCalendar } from '@openminutes/calendar';
import type { SettingsStore } from '@openminutes/core';
import { calendarAccounts, type Database } from '@openminutes/db';
import type { ExporterRegistry } from '@openminutes/minutes';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ExportSettingsDto } from '../dto.js';
import { AUTO_EXPORT_TARGETS } from './auto-export.js';
import { CALENDAR_LINK_SETTING } from './calendar-link.js';
import { loadExportConfig, saveExportConfig } from './export-settings.js';

interface ExportSettingsDeps {
  db: Database;
  settings: SettingsStore;
  exporters: ExporterRegistry;
  secret: string;
}

const input = z.object({
  target: z.string().min(1).nullable(),
  googleAccountId: z.uuid().nullable(),
  microsoftAccountId: z.uuid().nullable(),
  ownerEmail: z.union([z.email(), z.literal('')]),
  auto: z.boolean(),
  calendarLink: z.boolean().optional(),
});

export function exportSettingsRoutes({
  db,
  settings,
  exporters,
  secret,
}: ExportSettingsDeps): Hono {
  const routes = new Hono();

  const read = async (): Promise<ExportSettingsDto> => {
    const [config, calendarLink, accounts] = await Promise.all([
      loadExportConfig(settings),
      settings.get(CALENDAR_LINK_SETTING),
      db.select().from(calendarAccounts).orderBy(calendarAccounts.accountEmail),
    ]);
    return {
      target: config.target ?? null,
      googleAccountId: config.googleAccountId ?? null,
      microsoftAccountId: config.microsoftAccountId ?? null,
      ownerEmail: config.ownerEmail ?? '',
      auto: config.auto,
      calendarLink: calendarLink === 'true',
      targets: exporters.list().map(({ id, label }) => ({
        id,
        label,
        automatic: (AUTO_EXPORT_TARGETS as readonly string[]).includes(id),
      })),
      accounts: accounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        email: account.accountEmail,
        canExport: canExport(account, secret),
        canWrite: canWriteCalendar(account, secret),
      })),
    };
  };

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid export settings' }, 400);
    const { target, googleAccountId, microsoftAccountId, ownerEmail, calendarLink, ...rest } =
      body.data;
    if (target && !exporters.get(target)) return c.json({ error: 'Unknown export target' }, 400);
    await saveExportConfig(settings, {
      ...rest,
      target: target ?? undefined,
      googleAccountId: googleAccountId ?? undefined,
      microsoftAccountId: microsoftAccountId ?? undefined,
      ownerEmail: ownerEmail || undefined,
    });
    if (calendarLink !== undefined) await settings.set(CALENDAR_LINK_SETTING, String(calendarLink));
    return c.json(await read());
  });

  return routes;
}
