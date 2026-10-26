import { and, eq, notInArray, participants, type Database } from '@openminutes/db';
import type { SummaryProvider } from '@openminutes/providers';
import type { TranscriptRow } from '../transcript-store.js';
import type { Person, ReviewLine } from './lines.js';
import { reviewLines } from './review.js';

export interface ReviewDeps {
  db: Database;
  createRefiner: () => Promise<SummaryProvider | undefined>;
}

export interface SpeakerCheck {
  speakersRefined: boolean;
  speakerCheckedAt: Date;
  speakerCheckError: string | null;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function loadPeople(
  db: Database,
  meetingId: string,
  staleIds: readonly string[] = [],
): Promise<Person[]> {
  return db
    .select({ id: participants.id, name: participants.displayName })
    .from(participants)
    .where(
      and(
        eq(participants.meetingId, meetingId),
        staleIds.length > 0 ? notInArray(participants.id, [...staleIds]) : undefined,
      ),
    );
}

const toLine = (row: TranscriptRow): ReviewLine => ({
  startMs: row.startMs,
  endMs: row.endMs,
  text: row.text,
  participantId: row.participantId ?? null,
  speakerConfidence: row.speakerConfidence ?? null,
  speakerSource: row.speakerSource ?? null,
  speakerCandidates: row.speakerCandidates ?? null,
  previousParticipantId: row.previousParticipantId ?? null,
  suggestedParticipantId: row.suggestedParticipantId ?? null,
  rejectedSuggestions: row.rejectedSuggestions ?? [],
});

/**
 * The speaker review of a freshly built transcript, before it is saved. It never fails the
 * meeting: a problem leaves the aligned speakers as they are and is reported in the check.
 */
export async function reviewTranscript(
  deps: ReviewDeps,
  meetingId: string,
  rows: TranscriptRow[],
  staleIds: readonly string[],
): Promise<{ rows: TranscriptRow[]; check: SpeakerCheck }> {
  const checkedAt = new Date();
  try {
    const provider = await deps.createRefiner();
    const people = await loadPeople(deps.db, meetingId, staleIds);
    const review = await reviewLines(provider, rows.map(toLine), people);
    return {
      rows: rows.map((row, i) => ({ ...row, ...review.lines[i] })),
      check: {
        speakersRefined: review.refined && provider !== undefined,
        speakerCheckedAt: checkedAt,
        speakerCheckError: review.error,
      },
    };
  } catch (error) {
    console.error(`speaker review of meeting ${meetingId} failed, keeping the labels`, error);
    return {
      rows,
      check: {
        speakersRefined: false,
        speakerCheckedAt: checkedAt,
        speakerCheckError: errorMessage(error),
      },
    };
  }
}
