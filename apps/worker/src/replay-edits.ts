import { editSummary, EARLIER_INSTRUCTIONS, SummaryEditError } from '@openminutes/core';
import type { SummaryProvider } from '@openminutes/providers';

export interface ReplayResult {
  steps: { instruction: string; content: string }[];
  failure?: string;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function replayEdits(
  provider: SummaryProvider,
  fresh: string,
  instructions: string[],
): Promise<ReplayResult> {
  const steps: ReplayResult['steps'] = [];
  let content = fresh;
  for (const [index, instruction] of instructions.entries()) {
    try {
      content = await editSummary(provider, {
        summary: content,
        instruction,
        earlier: instructions.slice(Math.max(0, index - EARLIER_INSTRUCTIONS), index),
      });
      steps.push({ instruction, content });
    } catch (error) {
      if (error instanceof SummaryEditError && error.reason === 'unchanged') continue;
      return { steps, failure: `Not re-applied: "${instruction}". ${reason(error)}` };
    }
  }
  return { steps };
}
