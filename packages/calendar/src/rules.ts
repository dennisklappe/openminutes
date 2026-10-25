import type { JoinRule } from '@openminutes/db';
import type { CalendarEvent, MeetingLink, ScheduledEvent } from './types.js';

export type JoinableEvent = ScheduledEvent & { link: MeetingLink };

const CONSUMER_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'yahoo.com',
  'proton.me',
  'protonmail.com',
]);

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase();

function hasExternalGuest(guests: readonly string[], accountEmail: string): boolean {
  const own = domainOf(accountEmail);
  const sameOrganisation = (guest: string) => !CONSUMER_DOMAINS.has(own) && domainOf(guest) === own;
  return guests.some(
    (guest) => guest.toLowerCase() !== accountEmail.toLowerCase() && !sameOrganisation(guest),
  );
}

function allowedByRule(rule: JoinRule, event: ScheduledEvent, accountEmail: string): boolean {
  switch (rule) {
    case 'all':
      return true;
    case 'organizer':
      return event.isOrganizer;
    case 'external':
      return hasExternalGuest(event.guests, accountEmail);
    case 'never':
      return false;
  }
}

export function shouldJoin(
  rule: JoinRule,
  event: CalendarEvent,
  accountEmail: string,
  now: Date,
): event is JoinableEvent {
  if (event.cancelled || !event.link || event.declined || event.end <= now) return false;
  return allowedByRule(rule, event, accountEmail);
}
