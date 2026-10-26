import { matchInvitees, unmatchedInvitees } from './match.js';
import { dedupePeople, displayNameOf, sameParticipant } from './people.js';
import type {
  Minutes,
  MinutesAbsentee,
  MinutesChatMessage,
  MinutesPerson,
  MinutesSegment,
} from './types.js';

export interface MinutesInvitee {
  email: string;
  name: string | null;
  declined: boolean;
}

export interface MinutesSource {
  meeting: {
    title: string;
    platform: 'meet' | 'teams' | 'recording' | 'imported';
    joinUrl: string;
    scheduledStart: Date | null;
    startedAt: Date | null;
    endedAt: Date | null;
    location: string | null;
    invitees: readonly MinutesInvitee[] | null;
    /** Invitees the owner removed from the absent list, by email. */
    dismissedInvitees?: readonly string[] | null;
  };
  participants: readonly {
    displayName: string;
    originalName?: string | null;
    email: string | null;
    inviteeEmail?: string | null;
  }[];
  botName: string;
  summary: string | null;
  segments: readonly MinutesSegment[];
  chat?: readonly MinutesChatMessage[];
}

function locationOf(location: string | null, joinUrl: string): string | null {
  const trimmed = location?.trim();
  if (!trimmed || trimmed.includes(joinUrl)) return null;
  return trimmed;
}

const presentParticipants = (source: MinutesSource) =>
  source.participants.filter(
    (participant) => !sameParticipant(participant.displayName, source.botName),
  );

function presentPeople(source: MinutesSource, invitees: readonly MinutesInvitee[]) {
  const present = presentParticipants(source);
  const matches = matchInvitees(invitees, present);
  return dedupePeople(
    present.map((participant, index): MinutesPerson => {
      const joinedAs =
        participant.originalName &&
        !sameParticipant(participant.originalName, participant.displayName)
          ? participant.originalName
          : undefined;
      return {
        name: participant.displayName,
        email: participant.email ?? matches[index]?.email ?? null,
        ...(joinedAs && { joinedAs }),
      };
    }),
  );
}

const toPerson = (invitee: MinutesInvitee): MinutesPerson => ({
  name: displayNameOf(invitee),
  email: invitee.email,
});

const toAbsentee = (invitee: MinutesInvitee): MinutesAbsentee => ({
  ...toPerson(invitee),
  declined: invitee.declined,
});

function absentees(
  source: MinutesSource,
  invitees: readonly MinutesInvitee[],
  nobodySeen: boolean,
) {
  const dismissed = new Set(
    (source.meeting.dismissedInvitees ?? []).map((email) => email.toLowerCase()),
  );
  const absent = nobodySeen
    ? invitees.filter((invitee) => invitee.declined)
    : unmatchedInvitees(invitees, presentParticipants(source));
  return absent.filter((invitee) => !dismissed.has(invitee.email.toLowerCase())).map(toAbsentee);
}

/** The renderers add their own Summary heading, so a model that opens with one would repeat it. */
function withoutSummaryHeading(summary: string | null): string | null {
  const text = summary
    ?.trim()
    .replace(/^#{1,6}[ \t]+(?:summary|samenvatting)[ \t]*#*[ \t]*(?:\r?\n|$)/i, '');
  return text?.trim() || null;
}

const RECORDED_ON_PHONE = 'Recorded on phone';

function buildPhoneMinutes(source: MinutesSource): Minutes {
  const { meeting } = source;
  return {
    title: meeting.title,
    startedAt: (meeting.startedAt ?? meeting.scheduledStart)?.toISOString() ?? null,
    endedAt: meeting.endedAt?.toISOString() ?? null,
    platform: 'recording',
    joinUrl: '',
    location: RECORDED_ON_PHONE,
    attendees: [],
    absent: [],
    summary: withoutSummaryHeading(source.summary),
    transcript: [...source.segments],
    chat: [],
  };
}

export function buildMinutes(source: MinutesSource): Minutes {
  if (source.meeting.platform === 'recording') return buildPhoneMinutes(source);
  const { meeting } = source;
  const joinUrl = meeting.platform === 'imported' ? '' : meeting.joinUrl;
  const invitees = meeting.invitees ?? [];
  const present = presentPeople(source, invitees);
  const nobodySeen = present.length === 0;
  const iso = (date: Date | null) => date?.toISOString() ?? null;

  return {
    title: meeting.title,
    startedAt: iso(meeting.startedAt ?? meeting.scheduledStart),
    endedAt: iso(meeting.endedAt),
    platform: meeting.platform,
    joinUrl,
    location: locationOf(meeting.location, joinUrl),
    attendees: nobodySeen ? invitees.filter((invitee) => !invitee.declined).map(toPerson) : present,
    absent: absentees(source, invitees, nobodySeen),
    summary: withoutSummaryHeading(source.summary),
    transcript: [...source.segments],
    chat: [...(source.chat ?? [])],
  };
}
