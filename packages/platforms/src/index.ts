import { meet } from './meet.js';
import { teams } from './teams.js';
import type { Platform } from './types.js';

export {
  type ChatMessage,
  JoinError,
  type JoinFailureReason,
  type JoinOptions,
  type MeetingState,
  type RoomSnapshot,
} from './types.js';
export type { Platform } from './types.js';
export { meet } from './meet.js';
export { teams } from './teams.js';
export { defaultMeetingTitle, parseMeetingLink, type MeetingLink } from './meeting-link.js';
export { teamsHosts, unwrapLink } from './unwrap-link.js';
export { fixturePage } from './fixture-pages.js';

const platforms: readonly Platform[] = [meet, teams];

export function detectPlatform(url: string): Platform | undefined {
  return platforms.find((p) => p.detect(url));
}

export function platformById(id: string): Platform | undefined {
  return platforms.find((p) => p.id === id);
}
