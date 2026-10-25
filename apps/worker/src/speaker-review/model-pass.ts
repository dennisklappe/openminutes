import { parseSpeakerChanges } from '@openminutes/core';
import type { SummaryProvider } from '@openminutes/providers';
import { planBatches } from './batches.js';
import type { Person, ReviewLine } from './lines.js';
import { INSTRUCTIONS, renderBatch } from './prompt.js';

export interface ModelPass {
  /** New participant id per line index. */
  changes: Map<number, string>;
  batches: number;
  failed: number;
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Asks the model about the uncertain lines, a few at a time. A batch whose answer is rejected or
 * whose request fails is logged and skipped; the other batches still count.
 */
export async function reviewWithModel(
  provider: SummaryProvider,
  lines: readonly ReviewLine[],
  uncertain: readonly number[],
  people: readonly Person[],
): Promise<ModelPass> {
  const names = new Map(people.map((person) => [person.id, person.name]));
  const idOf = new Map(people.toReversed().map((person) => [person.name, person.id]));
  const speakers = new Set(idOf.keys());
  const batches = planBatches(
    lines,
    uncertain,
    names,
    provider.maxInputChars - INSTRUCTIONS.length,
  );
  const pass: ModelPass = { changes: new Map(), batches: batches.length, failed: 0 };
  for (const batch of batches) {
    try {
      const reply = await provider.summarize(renderBatch(lines, batch, names), INSTRUCTIONS);
      const current = new Map(
        batch.uncertain.map((i) => [i, names.get(lines[i]?.participantId ?? '') ?? null]),
      );
      for (const { index, speaker } of parseSpeakerChanges(reply, { current, speakers })) {
        const id = idOf.get(speaker);
        if (id) pass.changes.set(index, id);
      }
    } catch (error) {
      pass.failed += 1;
      console.error(
        `speaker review skipped lines ${String(batch.uncertain[0])} to ${String(batch.uncertain.at(-1))}: ${errorMessage(error)}`,
      );
    }
  }
  return pass;
}
