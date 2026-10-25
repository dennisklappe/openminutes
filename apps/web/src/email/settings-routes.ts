import { type SettingsStore } from '@openminutes/core';
import {
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  PLACEHOLDERS,
  renderShareEmail,
  type MailDeps,
} from '@openminutes/mail';
import { ProviderError } from '@openminutes/providers';
import { sendAccounts, type CalendarContext } from '@openminutes/calendar';
import { calendarAccounts, eq } from '@openminutes/db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { EmailSettingsDto, ProviderTestDto } from '../dto.js';
import { isReady, loadEmailConfig } from './config.js';
import { loadMailer } from './mailer.js';
import { resolveFromAddress, SenderDomainError, sendingDomain } from './sender-domain.js';

interface EmailSettingsDeps {
  settings: SettingsStore;
  calendar: CalendarContext;
  mailDeps: Partial<MailDeps>;
}

const optionalEmail = z.union([z.literal(''), z.email().max(254)]);
const input = z.object({
  fromName: z.string().trim().max(100),
  fromAddress: z.string().trim().max(254),
  ownerAddress: optionalEmail,
  subject: z.string().trim().max(300),
  body: z.string().max(10_000),
});

const keys = {
  fromName: 'email.from_name',
  fromAddress: 'email.from_address',
  ownerAddress: 'email.owner_address',
  subject: 'email.subject',
  body: 'email.body',
} as const;

export function emailSettingsRoutes(deps: EmailSettingsDeps): Hono {
  const { settings, calendar } = deps;
  const routes = new Hono();

  const read = async (): Promise<EmailSettingsDto> => {
    const config = await loadEmailConfig(settings);
    const [name, google] = await Promise.all([
      settings.get('email.from_name'),
      calendar.db
        .select({ id: calendarAccounts.id })
        .from(calendarAccounts)
        .where(eq(calendarAccounts.provider, 'google')),
    ]);
    return {
      fromName: name ?? '',
      fromAddress: config.from?.address ?? '',
      ownerAddress: config.ownerAddress ?? '',
      subject: config.subject,
      body: config.body,
      defaults: { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY },
      placeholders: [...PLACEHOLDERS],
      providerReady: isReady(config),
      sendingDomain: sendingDomain(config) ?? null,
      google: { connected: google.length > 0, sendAccounts: await sendAccounts(calendar) },
    };
  };

  routes.onError((error, c) => {
    if (error instanceof SenderDomainError) return c.json({ error: error.message }, 400);
    throw error;
  });

  routes.get('/', async (c) => c.json(await read()));

  routes.put('/', async (c) => {
    const body = input.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Check the email addresses and text' }, 400);
    const fromAddress = resolveFromAddress(
      body.data.fromAddress,
      sendingDomain(await loadEmailConfig(settings)),
    );
    for (const [field, key] of Object.entries(keys)) {
      const value = field === 'fromAddress' ? fromAddress : body.data[field as keyof typeof keys];
      if (value === '') await settings.delete(key);
      else await settings.set(key, value);
    }
    return c.json(await read());
  });

  routes.post('/send-test', async (c) => {
    const mailer = await loadMailer(settings, deps.mailDeps).catch((error: unknown) => {
      if (error instanceof SenderDomainError) return error;
      throw error;
    });
    if (mailer instanceof SenderDomainError) {
      return c.json<ProviderTestDto>({ ok: false, error: mailer.message });
    }
    if (!mailer) {
      return c.json<ProviderTestDto>({
        ok: false,
        error: 'Save a provider and a from address first',
      });
    }
    const owner = mailer.config.ownerAddress;
    if (!owner) {
      return c.json<ProviderTestDto>({
        ok: false,
        error: 'Set your own address first, test mails only go there',
      });
    }
    const mail = renderShareEmail({
      subject: 'OpenMinutes test mail',
      body: 'This is a test mail from your OpenMinutes instance. Sharing minutes by email works.',
      title: '',
      date: '',
    });
    try {
      await mailer.provider.send({ from: mailer.from, to: [owner], ...mail });
      return c.json<ProviderTestDto>({ ok: true, detail: `sent to ${owner}` });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      return c.json<ProviderTestDto>({ ok: false, error: error.message });
    }
  });

  return routes;
}
