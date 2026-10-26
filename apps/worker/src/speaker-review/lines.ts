import type { GuessLine } from '@openminutes/core';
import type { SpeakerCandidate, SpeakerSource } from '@openminutes/db';

export interface ReviewLine {
  startMs: number;
  endMs: number;
  text: string;
  participantId: string | null;
  speakerConfidence: number | null;
  speakerSource: SpeakerSource | null;
  speakerCandidates: SpeakerCandidate[] | null;
  previousParticipantId: string | null;
  suggestedParticipantId: string | null;
  rejectedSuggestions: string[];
  voiceDoubt: boolean;
}

export interface Person {
  id: string;
  name: string;
}

export const toGuessLine = (line: ReviewLine, people: ReadonlyMap<string, string>): GuessLine => ({
  startMs: line.startMs,
  endMs: line.endMs,
  text: line.text,
  speaker: line.participantId,
  name: line.participantId ? people.get(line.participantId) : null,
  speakerConfidence: line.speakerConfidence,
  speakerSource: line.speakerSource,
});
