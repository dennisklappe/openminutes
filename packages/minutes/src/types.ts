export interface MinutesPerson {
  name: string;
  email: string | null;
  joinedAs?: string;
}

export interface MinutesAbsentee extends MinutesPerson {
  declined: boolean;
}

export interface MinutesSegment {
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
}

export interface MinutesChatMessage {
  sender: string;
  text: string;
  links: string[];
  offsetMs: number;
}

export interface Minutes {
  title: string;
  startedAt: string | null;
  endedAt: string | null;
  platform: 'meet' | 'teams' | 'recording';
  joinUrl: string;
  location: string | null;
  attendees: MinutesPerson[];
  absent: MinutesAbsentee[];
  summary: string | null;
  transcript: MinutesSegment[];
  chat: MinutesChatMessage[];
}
