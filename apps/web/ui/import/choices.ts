import type { ImportMeetingDto, LinkableEventDto } from '../../src/dto.js';
import { nearestFirst, suggestEvent } from '../../src/meetings/link-pick.js';

/**
 * Only a meeting with a recording can be imported. Imported (or being imported) meetings cannot be
 * picked again, failed ones can be retried.
 */
export const isSelectable = (meeting: ImportMeetingDto) =>
  meeting.hasAudio && (meeting.meeting === null || meeting.meeting.status === 'failed');

export const selectableKeys = (meetings: readonly ImportMeetingDto[]) =>
  meetings.filter(isSelectable).map((meeting) => meeting.key);

/** Calendar meetings this close to an imported meeting are offered to link it to. */
export const EVENT_NEAR_MS = 36 * 3_600_000;

export function eventsNear(
  events: readonly LinkableEventDto[],
  meeting: Pick<ImportMeetingDto, 'startedAt'>,
): LinkableEventDto[] {
  const at = new Date(meeting.startedAt);
  return nearestFirst(
    events.filter(
      (event) => Math.abs(new Date(event.scheduledStart).getTime() - at.getTime()) <= EVENT_NEAR_MS,
    ),
    at,
  );
}

/**
 * The calendar meeting each new meeting is linked to: the one the user chose (null: none), else
 * the one closest to the recording when it is near enough to be it. A calendar meeting is
 * offered to one import at a time, the closest wins.
 */
export function eventLinks(
  meetings: readonly ImportMeetingDto[],
  events: readonly LinkableEventDto[],
  chosen: Readonly<Record<string, string | null>>,
): Record<string, string> {
  const links: Record<string, string> = {};
  const taken = new Set<string>();
  const open = meetings.filter((meeting) => meeting.meeting === null && meeting.hasAudio);
  for (const meeting of open) {
    const pick = chosen[meeting.key];
    if (pick) {
      links[meeting.key] = pick;
      taken.add(pick);
    }
  }
  for (const meeting of open) {
    if (meeting.key in chosen) continue;
    const free = eventsNear(events, meeting).filter((event) => !taken.has(event.id));
    const suggested = suggestEvent(free, new Date(meeting.startedAt));
    if (suggested) {
      links[meeting.key] = suggested.id;
      taken.add(suggested.id);
    }
  }
  return links;
}
