import { loadAutoSummary, loadTimeZone, type SettingsStore } from '@openminutes/core';
import { and, eq, meetings, shareEmails, type Database } from '@openminutes/db';
import { renderShareEmail, type MailDeps } from '@openminutes/mail';
import { markdownToHtml } from '@openminutes/minutes';
import { ProviderError } from '@openminutes/providers';
import { assembleMinutes } from '../minutes/assemble.js';
import { findDoneSummary } from '../minutes/summary-edit.js';
import { loadMailer } from './mailer.js';
import { normalizeEmail, recipientCandidates } from './recipients.js';

const INTRO = 'Hi,\n\nThe summary of {{title}} on {{date}} is ready. Here it is in full.';

export interface AutoOrganizerDeps {
  db: Database;
  settings: SettingsStore;
  mailDeps: Partial<MailDeps>;
}

export type AutoOrganizerOutcome =
  | 'sent'
  | 'off'
  | 'no-summary'
  | 'no-organizer'
  | 'no-recipients'
  | 'already-sent'
  | 'not-configured';

/**
 * Mails the finished summary once it is done, to the organiser of the calendar event or to
 * everyone (the people Share with attendees preselects: not those who declined), as the setting
 * says. Each recipient gets their own mail. The log row carries the summary id, so the same
 * version is never mailed twice to the same person (a queue retry, or a summary that finishes
 * again), while a new version (an edit, a rerun) is mailed again. A failed attempt is logged and
 * thrown after the others went out, so the queue retries only what is missing.
 */
export async function runEmailOrganizer(
  deps: AutoOrganizerDeps,
  meetingId: string,
): Promise<AutoOrganizerOutcome> {
  const { db, settings } = deps;
  const audience = await loadAutoSummary(settings);
  if (audience === 'off') return 'off';
  const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting || meeting.deletedAt) return 'no-summary';
  const summary = await findDoneSummary(db, meetingId);
  if (!summary?.content.trim()) return 'no-summary';

  let recipients: string[];
  if (audience === 'organizer') {
    const organizer = meeting.invitees?.find((invitee) => invitee.organizer)?.email;
    if (!organizer) return 'no-organizer';
    recipients = [organizer];
  } else {
    const minutes = await assembleMinutes(deps, meetingId);
    recipients = minutes
      ? recipientCandidates(minutes, new Map())
          .filter((person) => !person.declined)
          .map((person) => person.email)
      : [];
    if (recipients.length === 0) return 'no-recipients';
  }

  const marker = `auto-organizer:${summary.id}`;
  const logged = await db
    .select({ recipient: shareEmails.recipient, items: shareEmails.items })
    .from(shareEmails)
    .where(and(eq(shareEmails.meetingId, meetingId), eq(shareEmails.status, 'sent')));
  const done = new Set(
    logged.filter((row) => row.items.includes(marker)).map((row) => row.recipient),
  );
  const todo = recipients.filter((email) => !done.has(normalizeEmail(email)));
  if (todo.length === 0) return 'already-sent';

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
  const record = (recipient: string, status: 'sent' | 'failed', error?: string) =>
    db.insert(shareEmails).values({
      meetingId,
      recipient: normalizeEmail(recipient),
      items: [marker],
      subject: mail.subject,
      status,
      error: error ?? null,
    });
  let failure: Error | undefined;
  for (const email of todo) {
    try {
      await mailer.provider.send({ from: mailer.from, to: [email], ...mail });
    } catch (error) {
      if (error instanceof ProviderError) await record(email, 'failed', error.message);
      failure ??= error instanceof Error ? error : new Error(String(error));
      continue;
    }
    await record(email, 'sent');
  }
  if (failure) throw failure;
  return 'sent';
}
