import type { ReviewLine } from './lines.js';
import { renderBatch, type Batch } from './prompt.js';

const BATCH_SIZE = 10;
const CONTEXT_LINES = 4;
const PROMPT_OVERHEAD_CHARS = 1500;

/**
 * Groups the uncertain lines, in order, into batches of at most `BATCH_SIZE`, each with the
 * lines around it as context, so that a batch always fits the input limit of the model.
 */
export function planBatches(
  lines: readonly ReviewLine[],
  uncertain: readonly number[],
  names: ReadonlyMap<string, string>,
  budget: number,
): Batch[] {
  const window = (indexes: number[]): Batch => ({
    uncertain: indexes,
    from: Math.max(0, (indexes[0] ?? 0) - CONTEXT_LINES),
    to: Math.min(lines.length, (indexes.at(-1) ?? 0) + CONTEXT_LINES + 1),
  });
  const fits = (batch: Batch) =>
    batch.uncertain.length <= BATCH_SIZE &&
    renderBatch(lines, batch, names).length <= budget - PROMPT_OVERHEAD_CHARS;
  const batches: Batch[] = [];
  let current: number[] = [];
  for (const index of uncertain) {
    if (current.length > 0 && !fits(window([...current, index]))) {
      batches.push(window(current));
      current = [];
    }
    current.push(index);
  }
  if (current.length > 0) batches.push(window(current));
  return batches;
}
