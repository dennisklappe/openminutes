import type { ImportMeetingDto } from '../../src/dto.js';

/**
 * Only a meeting with a recording can be imported. Imported (or being imported) meetings cannot be
 * picked again, failed ones can be retried.
 */
export const isSelectable = (meeting: ImportMeetingDto) =>
  meeting.hasAudio && (meeting.meeting === null || meeting.meeting.status === 'failed');

export const selectableKeys = (meetings: readonly ImportMeetingDto[]) =>
  meetings.filter(isSelectable).map((meeting) => meeting.key);
