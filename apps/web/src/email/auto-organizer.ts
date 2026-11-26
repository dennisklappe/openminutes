import { loadTimeZone, type SettingsStore } from '@openminutes/core';
import { and, eq, meetings, shareEmails, type Database } from '@openminutes/db';
import { renderShareEmail, type MailDeps } from '@openminutes/mail';
import { markdownToHtml } from '@openminutes/minutes';
import { ProviderError } from '@openminutes/providers';
import { findDoneSummary } from '../minutes/summary-edit.js';
import { loadMailer } from './mailer.js';
import { normalizeEmail } from './recipients.js';

export const AUTO_ORGANIZER_KEY = 'email.auto_organizer';

const INTRO = 'Hi,\n\nThe summary of {{title}} on {{date}} is ready. Here it is in full.';

export interface AutoOrganizerDeps {
  db: Database;
  settings: SettingsStore;
  mailDeps: Partial<MailDeps>;
}

export type AutoOrganizerOutcome =
  'sent' | 'off' | 'no-summary' | 'no-organizer' | 'already-sent' | 'not-configured';

/**
 * Mails the finished summary to the organiser of the calendar event, and to nobody else. It runs
 * once a summary is done and only when the setting is on. The log row carries the summary id, so
 * the same version is never mailed twice (a queue retry, or a summary that finishes again), while
 * a new version (an edit, a rerun) is mailed again. A failed attempt is logged and thrown so the
 * queue retries it.
 */
export async function runEmailOrganizer(
  deps: AutoOrganizerDeps,
  meetingId: string,
): Promise<AutoOrganizerOutcome> {
  const { db, settings } = deps;
  if ((await settings.get(AUTO_ORGANIZER_KEY)) !== 'true') return 'off';
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting || meeting.deletedAt) return 'no-summary';
  const summary = await findDoneSummary(db, meetingId);
  if (!summary?.content.trim()) return 'no-summary';
  const organizer = meeting.invitees?.find((invitee) => invitee.organizer)?.email;
  if (!organizer) return 'no-organizer';

  const recipient = normalizeEmail(organizer);
  const marker = `auto-organizer:${summary.id}`;
  const logged = await db
    .select({ items: shareEmails.items })
    .from(shareEmails)
    .where(
      and(
        eq(shareEmails.meetingId, meetingId),
        eq(shareEmails.recipient, recipient),
        eq(shareEmails.status, 'sent'),
      ),
    );
  if (logged.some((row) => row.items.includes(marker))) return 'already-sent';

  const mailer = await loadMailer(settings, deps.mailDeps);
  if (!mailer) return 'not-configured';
  const timeZone = await loadTimeZone(settings);
  const mail = renderShareEmail({
    subject: mailer.config.subject,
    body: INTRO,
    title: meeting.title,
    date: new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone }).format(
      meeting.startedAt ?? meeting.scheduledStart ?? meeting.createdAt,
    ),
    content: { text: summary.content, html: markdownToHtml(summary.content) },
  });
  const record = (status: 'sent' | 'failed', error?: string) =>
    db.insert(shareEmails).values({
      meetingId,
      recipient,
      items: [marker],
      subject: mail.subject,
      status,
      error: error ?? null,
    });
  try {
    await mailer.provider.send({ from: mailer.from, to: [organizer], ...mail });
  } catch (error) {
    if (error instanceof ProviderError) await record('failed', error.message);
    throw error;
  }
  await record('sent');
  return 'sent';
}
