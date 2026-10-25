import {
  findSuspects,
  guessSpeakers,
  isUncertain,
  SUSPECT_CONFIDENCE_CAP,
} from '@openminutes/core';
import type { SpeakerSource } from '@openminutes/db';
import type { SummaryProvider } from '@openminutes/providers';
import { toGuessLine, type Person, type ReviewLine } from './lines.js';
import { reviewWithModel } from './model-pass.js';

export interface Review<T extends ReviewLine> {
  lines: T[];
  /** The model was asked and gave at least one usable answer, or had nothing to do. */
  refined: boolean;
  error: string | null;
}

function capSuspects<T extends ReviewLine>(
  lines: readonly T[],
  people: ReadonlyMap<string, string>,
): T[] {
  const suspects = findSuspects(lines.map((line) => toGuessLine(line, people)));
  return lines.map((line, i) =>
    suspects.has(i) && line.speakerSource !== 'user'
      ? {
          ...line,
          speakerConfidence: Math.min(line.speakerConfidence ?? 1, SUSPECT_CONFIDENCE_CAP),
        }
      : line,
  );
}

function reassign<T extends ReviewLine>(
  lines: readonly T[],
  changes: ReadonlyMap<number, string>,
  source: SpeakerSource,
): T[] {
  return lines.map((line, i) => {
    const participantId = changes.get(i);
    if (!participantId || participantId === line.participantId || line.speakerSource === 'user') {
      return line;
    }
    return {
      ...line,
      participantId,
      speakerSource: source,
      previousParticipantId: line.participantId,
    };
  });
}

/**
 * The second pass over the speakers of a transcript. Lines whose turn-taking looks wrong lose
 * confidence, then the uncertain lines go to the model, or to the plain dialog heuristic when
 * there is no model. Lines a person has corrected are never touched.
 */
export async function reviewLines<T extends ReviewLine>(
  provider: SummaryProvider | undefined,
  input: readonly T[],
  people: readonly Person[],
): Promise<Review<T>> {
  const names = new Map(people.map((person) => [person.id, person.name]));
  const lines = capSuspects(input, names);
  if (people.length < 2) {
    return { lines, refined: false, error: null };
  }
  if (!provider) {
    const guesses = guessSpeakers(
      lines.map((line) => toGuessLine(line, names)),
      people.map((person) => person.id),
    );
    return { lines: reassign(lines, guesses, 'guess'), refined: false, error: null };
  }
  const uncertain = lines.flatMap((line, i) => (isUncertain(line) ? [i] : []));
  const pass = await reviewWithModel(provider, lines, uncertain, people);
  const failedAll = pass.batches > 0 && pass.failed === pass.batches;
  return {
    lines: reassign(lines, pass.changes, 'ai'),
    refined: !failedAll,
    error: failedAll ? 'The model gave no usable answer' : null,
  };
}
