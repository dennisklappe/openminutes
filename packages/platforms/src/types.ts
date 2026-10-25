import type { MeetingPlatform } from '@openminutes/db';
import type { Page } from 'playwright-core';

export interface JoinOptions {
  displayName: string;
  cameraOn: boolean;
  lobbyTimeoutMs: number;
  signedIn?: boolean;
  onLobby: () => void | Promise<void>;
}

export type JoinFailureReason =
  | 'blocked'
  | 'anonymous_blocked'
  | 'denied'
  | 'lobby_timeout'
  | 'meeting_ended'
  | 'session_expired';

export class JoinError extends Error {
  constructor(
    readonly reason: JoinFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'JoinError';
  }
}

export type MeetingState = 'active' | 'ended';

export interface RoomSnapshot {
  participants: string[];
  speaking: string[];
  /** People in the room when it can differ from the number of distinct names, for example two people with one name. */
  headcount?: number;
}

export interface ChatMessage {
  sender: string;
  text: string;
  time: string | null;
  links: string[];
}

export interface Platform {
  readonly id: MeetingPlatform;
  readonly label: string;
  detect(url: string): boolean;
  join(page: Page, url: string, options: JoinOptions): Promise<void>;
  sendChatMessage(page: Page, text: string): Promise<void>;
  muteMicrophone(page: Page): Promise<boolean>;
  leave(page: Page): Promise<void>;
  state(page: Page): Promise<MeetingState>;
  scrapeRoom(page: Page, selfName: string): Promise<RoomSnapshot>;
  scrapeChat(page: Page, selfName: string): Promise<ChatMessage[]>;
}
