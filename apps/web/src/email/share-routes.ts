import { loadTimeZone, type LocalStorage, type SettingsStore } from '@openminutes/core';
import { and, asc, eq, meetingExports, shareEmails, type Database } from '@openminutes/db';
import { PLACEHOLDERS, renderShareEmail, type MailDeps } from '@openminutes/mail';
import { ProviderError } from '@openminutes/providers';
import type { ExporterRegistry } from '@openminutes/minutes';
import { Hono } from 'hono';
import { z } from 'zod';
import { publicOrigin } from '../accounts/origin.js';
import type {
  ShareEmailOptionsDto,
  ShareEmailPreviewDto,
  ShareEmailResultDto,
  ShareFormatDto,
} from '../dto.js';
import { assembleMinutes } from '../minutes/assemble.js';
import { loadDestinations } from '../minutes/destinations.js';
import { runExport } from '../minutes/run-export.js';
import { isReady, loadEmailConfig } from './config.js';
import { loadMailer } from './mailer.js';
import { SenderDomainError } from './sender-domain.js';
import { chooseRecipients, normalizeEmail, recipientCandidates } from './recipients.js';

interface ShareEmailDeps {
  db: Database;
  settings: SettingsStore;
  storage: LocalStorage;
  exporters: ExporterRegistry;
  mailDeps: Partial<MailDeps>;
  publicUrl?: string | undefined;
}

const MAX_RECIPIENTS = 50;
const uuid = z.uuid();
const email = z.email().max(254);

const request = z.object({
  recipients: z.array(email).max(MAX_RECIPIENTS),
  extra: z.array(email).max(MAX_RECIPIENTS),
  format: z.string().min(1).max(100),
  subject: z.string().trim().min(1).max(300),
  body: z.string().max(10_000),
  force: z.boolean().default(false),
  includeTranscript: z.boolean().optional(),
  includeChat: z.boolean().optional(),
  includeLinks: z.boolean().optional(),
});

type ShareRequest = z.infer<typeof request>;

class BadRequest extends Error {}

async function grantAccess(
  exporters: ExporterRegistry,
  format: string,
  meetingId: string,
  url: string,
  emails: string[],
): Promise<string[]> {
  const granting = exporters.grantAccess(format, { meetingId, url, emails });
  if (!granting) {
    return ['The permissions were not changed, people need existing access to open it.'];
  }
  try {
    const { failed } = await granting;
    return failed.length > 0 ? [`Could not give ${String(failed.length)} people access.`] : [];
  } catch {
    return ['Could not change the permissions, people need existing access to open it.'];
  }
}

export function shareEmailRoutes(deps: ShareEmailDeps): Hono {
  const { db } = deps;
  const routes = new Hono();

  routes.onError((error, c) => {
    if (error instanceof BadRequest) return c.json({ error: error.message }, 400);
    throw error;
  });

  async function loadMeeting(rawId: string) {
    const id = uuid.safeParse(rawId);
    if (!id.success) return undefined;
    const minutes = await assembleMinutes(deps, id.data);
    return minutes && { id: id.data, minutes };
  }

  async function sentMap(meetingId: string): Promise<Map<string, Date>> {
    const rows = await db
      .select({ recipient: shareEmails.recipient, sentAt: shareEmails.sentAt })
      .from(shareEmails)
      .where(and(eq(shareEmails.meetingId, meetingId), eq(shareEmails.status, 'sent')))
      .orderBy(asc(shareEmails.sentAt));
    return new Map(rows.map((row) => [row.recipient, row.sentAt]));
  }

  async function parse(raw: Request): Promise<ShareRequest> {
    const body = request.safeParse(await raw.json().catch(() => null));
    if (!body.success) throw new BadRequest('Check the recipients, subject and format');
    const { recipients, extra, format } = body.data;
    if (recipients.length + extra.length === 0) throw new BadRequest('Pick at least one person');
    if (!deps.exporters.get(format)?.shareLabel) throw new BadRequest('Pick how to share');
    return body.data;
  }

  function content(
    body: ShareRequest,
    minutes: { title: string; startedAt: string | null },
    url: string,
    timeZone: string,
  ) {
    return renderShareEmail({
      subject: body.subject,
      body: body.body,
      title: minutes.title,
      date: new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone }).format(
        new Date(minutes.startedAt ?? Date.now()),
      ),
      item: { label: 'Read the minutes', url },
    });
  }

  async function savedExport(meetingId: string, exporterId: string) {
    const [record] = await db
      .select()
      .from(meetingExports)
      .where(
        and(eq(meetingExports.meetingId, meetingId), eq(meetingExports.exporterId, exporterId)),
      );
    return record;
  }

  routes.get('/:id/share-email', async (c) => {
    const meeting = await loadMeeting(c.req.param('id'));
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404);
    const [config, sent, enabled, saved] = await Promise.all([
      loadEmailConfig(deps.settings),
      sentMap(meeting.id),
      loadDestinations(deps.settings),
      db.select().from(meetingExports).where(eq(meetingExports.meetingId, meeting.id)),
    ]);
    const formats = deps.exporters
      .list()
      .filter((exporter) => exporter.shareLabel && enabled.includes(exporter.id))
      .map((exporter): ShareFormatDto => {
        const record = saved.find((row) => row.exporterId === exporter.id);
        return {
          id: exporter.id,
          label: exporter.shareLabel ?? exporter.label,
          url: record?.url ?? null,
          updatedAt: record?.updatedAt.toISOString() ?? null,
        };
      });
    return c.json<ShareEmailOptionsDto>({
      configured: isReady(config),
      fromAddress: config.from?.address ?? '',
      subject: config.subject,
      body: config.body,
      placeholders: [...PLACEHOLDERS],
      recipients: recipientCandidates(meeting.minutes, sent),
      formats,
    });
  });

  async function plan(c: { req: { param(name: string): string; raw: Request } }) {
    const meeting = await loadMeeting(c.req.param('id'));
    if (!meeting) return undefined;
    const body = await parse(c.req.raw);
    const sent = await sentMap(meeting.id);
    const { willSend, alreadySent } = chooseRecipients(
      body.recipients,
      body.extra,
      sent,
      body.force,
    );
    if (willSend.length + alreadySent.length > MAX_RECIPIENTS) {
      throw new BadRequest(`At most ${String(MAX_RECIPIENTS)} people at once`);
    }
    return { meeting, body, willSend, alreadySent };
  }

  routes.post('/:id/share-email/preview', async (c) => {
    const planned = await plan(c);
    if (!planned) return c.json({ error: 'Meeting not found' }, 404);
    const { meeting, body, willSend, alreadySent } = planned;
    const url =
      (await savedExport(meeting.id, body.format))?.url ??
      `${publicOrigin(c, deps.publicUrl)}/link-created-when-you-share`;
    return c.json<ShareEmailPreviewDto>({
      ...content(body, meeting.minutes, url, await loadTimeZone(deps.settings)),
      willSend,
      alreadySent,
    });
  });

  routes.post('/:id/share-email', async (c) => {
    const planned = await plan(c);
    if (!planned) return c.json({ error: 'Meeting not found' }, 404);
    const { meeting, body, willSend, alreadySent } = planned;
    if (willSend.length === 0) {
      return c.json<ShareEmailResultDto>({
        sent: [],
        skipped: alreadySent,
        failed: [],
        warnings: ['Everyone already received this. Use "Send again" to resend.'],
      });
    }
    const mailer = await loadMailer(deps.settings, deps.mailDeps).catch((error: unknown) => {
      if (error instanceof SenderDomainError) throw new BadRequest(error.message);
      throw error;
    });
    if (!mailer) throw new BadRequest('Set up an email provider in Settings, Email first');

    const shared = await runExport(deps, {
      meetingId: meeting.id,
      exporterId: body.format,
      origin: publicOrigin(c, deps.publicUrl),
      overrides: {
        ...(body.includeTranscript !== undefined && { includeTranscript: body.includeTranscript }),
        ...(body.includeChat !== undefined && { includeChat: body.includeChat }),
        ...(body.includeLinks !== undefined && { linksTab: body.includeLinks }),
      },
    });
    if (!shared.ok) throw new BadRequest(shared.error);
    if (shared.outcome.kind !== 'link')
      throw new BadRequest('That format cannot be shared by link');
    const { url, ref } = shared.outcome;
    const warnings = await grantAccess(deps.exporters, body.format, meeting.id, url, willSend);

    const mail = content(body, meeting.minutes, url, await loadTimeZone(deps.settings));
    const result: ShareEmailResultDto = { sent: [], skipped: alreadySent, failed: [], warnings };
    for (const recipient of willSend) {
      const record = (status: 'sent' | 'failed', error?: string) =>
        db.insert(shareEmails).values({
          meetingId: meeting.id,
          recipient: normalizeEmail(recipient),
          items: [body.format],
          shareLinkId: body.format === 'share-link' ? (ref ?? null) : null,
          subject: mail.subject,
          status,
          error: error ?? null,
        });
      try {
        await mailer.provider.send({ from: mailer.from, to: [recipient], ...mail });
        await record('sent');
        result.sent.push(recipient);
      } catch (error) {
        if (!(error instanceof ProviderError)) throw error;
        await record('failed', error.message);
        result.failed.push({ email: recipient, error: error.message });
      }
    }
    return c.json(result);
  });

  return routes;
}
