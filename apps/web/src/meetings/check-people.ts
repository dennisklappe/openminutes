import {
  assignVoices,
  companyHint,
  domainOf,
  fillFromCalendar,
  normalizeEmail,
  type Attendee,
  type CheckPerson,
  type SettingsStore,
} from '@openminutes/core';
import {
  and,
  calendarAccounts,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  meetings,
  ne,
  participants,
  people,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import type { CheckMatchDto, CheckOptionDto, CheckPeopleDto, CheckVoiceDto } from '../dto.js';
import { isFiller, MIN_LINE_MS } from '../people/useful.js';
import { isGenericName } from '../voices/names.js';

type Meeting = typeof meetings.$inferSelect;
type Person = typeof people.$inferSelect;

export interface CheckDeps {
  db: Database;
  settings: SettingsStore;
}

const CHECKED_KEY = 'people.checked';
const CHECKED_KEEP = 2000;
const OWNER_SETTINGS = ['export.owner_email', 'email.owner_address', 'email.from_address'] as const;
const KNOWN_OPTIONS = 50;
const LEARN_LINES = 20;
/** The event of the calendar starts at most this long after the recording began... */
const EVENT_AFTER_MS = 15 * 60_000;
/** ...and at most this long before it. Events have no end stored, so this is the longest we look back. */
const EVENT_BEFORE_MS = 2 * 60 * 60_000;

const hidden: CheckPeopleDto = {
  show: false,
  count: 0,
  voices: [],
  options: [],
  rememberEnabled: false,
  speakerCount: null,
};

export async function checkedMeetings(settings: SettingsStore): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await settings.get(CHECKED_KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** The card is done for this meeting: it was confirmed or dismissed. */
export async function markChecked(settings: SettingsStore, meetingId: string): Promise<void> {
  const current = await checkedMeetings(settings);
  if (current.includes(meetingId)) return;
  await settings.set(CHECKED_KEY, JSON.stringify([...current, meetingId].slice(-CHECKED_KEEP)));
}

async function ownAddresses(
  deps: CheckDeps,
): Promise<{ emails: Set<string>; domains: Set<string> }> {
  const accounts = await deps.db
    .select({ email: calendarAccounts.accountEmail })
    .from(calendarAccounts);
  const configured = await Promise.all(OWNER_SETTINGS.map((key) => deps.settings.get(key)));
  const emails = [...accounts.map((a) => a.email), ...configured]
    .map((email) => normalizeEmail(email ?? ''))
    .filter((email) => email !== '');
  return {
    emails: new Set(emails),
    domains: new Set(emails.flatMap((email) => domainOf(email) ?? [])),
  };
}

/** The attendees of the meeting's own invitation, else of the calendar event it was recorded at. */
async function attendeesOf(deps: CheckDeps, meeting: Meeting, ownEmails: Set<string>) {
  let invitees = meeting.invitees ?? [];
  if (invitees.length === 0) {
    const at = (meeting.startedAt ?? meeting.createdAt).getTime();
    const events = await deps.db
      .select()
      .from(meetings)
      .where(
        and(
          ne(meetings.id, meeting.id),
          isNull(meetings.deletedAt),
          isNotNull(meetings.scheduledStart),
          isNotNull(meetings.invitees),
          ne(meetings.status, 'cancelled'),
        ),
      );
    const closest = events
      .filter((event) => event.scheduledStart && event.invitees && event.invitees.length > 0)
      .map((event) => ({ event, start: event.scheduledStart?.getTime() ?? 0 }))
      .filter(({ start }) => start - at <= EVENT_AFTER_MS && at - start <= EVENT_BEFORE_MS)
      .sort((a, b) => Math.abs(a.start - at) - Math.abs(b.start - at))[0];
    invitees = closest?.event.invitees ?? [];
  }
  return invitees
    .filter((invitee) => !invitee.declined && !ownEmails.has(normalizeEmail(invitee.email)))
    .filter((invitee) => !domainOf(invitee.email)?.endsWith('calendar.google.com'))
    .map((invitee): Attendee => ({ name: invitee.name, email: invitee.email }));
}

const isEligible = (meeting: Meeting) =>
  (meeting.platform === 'recording' || meeting.platform === 'imported') &&
  meeting.status === 'transcribed' &&
  meeting.deletedAt === null;

/**
 * Who the voices of a phone recording or import probably are, for the "Check the people" card.
 * Nothing here is saved: names come from the voice profiles, the calendar and earlier meetings,
 * and only Confirm turns them into labels.
 */
export async function loadCheckPeople(deps: CheckDeps, meeting: Meeting): Promise<CheckPeopleDto> {
  if (!isEligible(meeting)) return hidden;
  if ((await checkedMeetings(deps.settings)).includes(meeting.id)) return hidden;
  const [seats, lines, everyone] = await Promise.all([
    deps.db.select().from(participants).where(eq(participants.meetingId, meeting.id)),
    deps.db
      .select({
        participantId: transcriptSegments.participantId,
        startMs: transcriptSegments.startMs,
        endMs: transcriptSegments.endMs,
      })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meeting.id)),
    deps.db.select().from(people).orderBy(desc(people.updatedAt)),
  ]);
  const talk = new Map<string, number>();
  for (const line of lines) {
    if (line.participantId) {
      talk.set(line.participantId, (talk.get(line.participantId) ?? 0) + line.endMs - line.startMs);
    }
  }
  const voices = seats
    .filter((seat) => !seat.isBot && talk.has(seat.id))
    .sort((a, b) => (talk.get(b.id) ?? 0) - (talk.get(a.id) ?? 0));
  if (voices.length === 0 || voices.every((voice) => voice.nameConfirmed)) return hidden;

  const own = await ownAddresses(deps);
  const attendees = await attendeesOf(deps, meeting, own.emails);
  const tracked: CheckPerson[] = everyone
    .filter((person) => person.tracking === 'on')
    .map((person) => ({
      id: person.id,
      name: person.name,
      emails: person.emails,
      prototypes: person.voicePrototypes,
    }));
  const byId = new Map(everyone.map((person) => [person.id, person]));
  const byName = new Map(everyone.map((person) => [person.name.toLowerCase(), person]));
  const byEmail = new Map(
    everyone.flatMap((person) => person.emails.map((email) => [email, person] as const)),
  );
  const attendeeOf = (person: Person | undefined, name: string) =>
    attendees.find(
      (attendee) =>
        (person?.emails ?? []).includes(normalizeEmail(attendee.email)) ||
        attendee.name?.toLowerCase() === name.toLowerCase(),
    );

  const fits = assignVoices(
    voices.map((voice) => ({ id: voice.id, embedding: voice.voiceEmbedding })),
    tracked,
    meeting.language,
  );
  const calendar = fillFromCalendar(
    voices.map((voice) => voice.id),
    fits,
    attendees,
    tracked,
  );

  const personIds = [...fits.values()].map((fit) => fit.personId);
  const earlier = personIds.length
    ? await deps.db
        .select({ personId: participants.personId, company: meetings.company })
        .from(participants)
        .innerJoin(meetings, eq(meetings.id, participants.meetingId))
        .where(
          and(
            inArray(participants.personId, personIds),
            ne(participants.meetingId, meeting.id),
            isNull(meetings.deletedAt),
          ),
        )
    : [];
  const hintFor = (person: Person | undefined, attendee: Attendee | undefined) =>
    companyHint({
      emails: [...(person?.emails ?? []), ...(attendee ? [attendee.email] : [])],
      earlier: earlier.filter((row) => row.personId === person?.id).map((row) => row.company),
      ownDomains: own.domains,
    }) ?? null;

  const taken = new Set<string>();
  const cards = voices.map((voice): CheckVoiceDto => {
    let match: CheckMatchDto | null = null;
    const fit = fits.get(voice.id);
    const filled = calendar.get(voice.id);
    if (fit) {
      const person = byId.get(fit.personId);
      const attendee = attendeeOf(person, fit.name);
      if (attendee) taken.add(normalizeEmail(attendee.email));
      match = {
        name: fit.name,
        personId: fit.personId,
        email: attendee?.email ?? null,
        certainty: fit.certainty,
        source: 'voice',
        onCalendar: attendee !== undefined,
        company: hintFor(person, attendee),
      };
    } else if (filled) {
      const person =
        byEmail.get(normalizeEmail(filled.email)) ?? byName.get(filled.name.toLowerCase());
      taken.add(normalizeEmail(filled.email));
      match = {
        name: person?.name ?? filled.name,
        personId: person?.id ?? null,
        email: filled.email,
        certainty: 'probable',
        source: 'calendar',
        onCalendar: true,
        company: hintFor(person, filled),
      };
    } else if (!isGenericName(voice.displayName)) {
      const person = byName.get(voice.displayName.toLowerCase());
      const attendee = attendeeOf(person, voice.displayName);
      match = {
        name: voice.displayName,
        personId: person?.id ?? null,
        email: attendee?.email ?? null,
        certainty: 'probable',
        source: 'label',
        onCalendar: attendee !== undefined,
        company: hintFor(person, attendee),
      };
    }
    return {
      id: voice.id,
      label: voice.displayName,
      durationMs: talk.get(voice.id) ?? 0,
      match,
      attendees: [],
    };
  });

  const toOption = (attendee: Attendee): CheckOptionDto => {
    const person = byEmail.get(normalizeEmail(attendee.email));
    return {
      name: person?.name ?? attendee.name ?? attendee.email,
      email: attendee.email,
      personId: person?.id ?? null,
      source: 'calendar',
    };
  };
  const free = attendees.filter((attendee) => !taken.has(normalizeEmail(attendee.email)));
  for (const card of cards) if (!card.match) card.attendees = free.map(toOption);

  const calendarOptions = attendees.map(toOption);
  const options: CheckOptionDto[] = [
    ...calendarOptions,
    ...everyone
      .filter((person) => !calendarOptions.some((option) => option.personId === person.id))
      .slice(0, KNOWN_OPTIONS)
      .map((person) => ({
        name: person.name,
        email: person.emails[0] ?? null,
        personId: person.id,
        source: 'known' as const,
      })),
  ];

  return {
    show: true,
    count: cards.length,
    voices: cards,
    options,
    rememberEnabled: (await deps.settings.get('voices.remember')) === 'true',
    speakerCount: meeting.speakerCount,
  };
}

/** The lines of a voice worth learning from: long enough, single speaker, not just filler. */
export async function learnableLines(db: Database, participantId: string): Promise<string[]> {
  const rows = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.participantId, participantId));
  return rows
    .filter((row) => !row.mixed && row.endMs - row.startMs >= MIN_LINE_MS && !isFiller(row.text))
    .sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))
    .slice(0, LEARN_LINES)
    .map((row) => row.id);
}
