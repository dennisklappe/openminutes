import { z } from 'zod';

export class ReviewReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewReplyError';
  }
}

/** A batch may change at most this share of its uncertain lines, and never fewer than two. */
export const MAX_CHANGE_SHARE = 0.6;
const MIN_CHANGES_ALLOWED = 2;

const replySchema = z.object({
  changes: z.array(z.object({ index: z.number().int(), speaker: z.string() })),
});

export interface ReplyLimits {
  /** The lines the model may change, with the speaker they carry now. */
  current: ReadonlyMap<number, string | null>;
  speakers: ReadonlySet<string>;
}

export interface SpeakerChange {
  index: number;
  speaker: string;
}

function parseJson(reply: string): unknown {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end < start) throw new ReviewReplyError('The model did not return JSON');
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new ReviewReplyError('The model returned invalid JSON');
  }
}

/**
 * Reads and checks the reply of the model to one batch of uncertain lines. The reply carries
 * indexes and speaker names only, so the text can never change. It is rejected as a whole when
 * a line is not one of the uncertain lines, a speaker is not in the meeting, a line comes twice
 * or too many lines change. Changes to the speaker a line already has are dropped.
 */
export function parseSpeakerChanges(reply: string, limits: ReplyLimits): SpeakerChange[] {
  const parsed = replySchema.safeParse(parseJson(reply));
  if (!parsed.success) throw new ReviewReplyError('The model reply has no changes list');
  const seen = new Set<number>();
  const changes: SpeakerChange[] = [];
  for (const { index, speaker } of parsed.data.changes) {
    if (!limits.current.has(index)) throw new ReviewReplyError('The model named an unknown line');
    if (!limits.speakers.has(speaker)) {
      throw new ReviewReplyError('The model named a speaker that is not in the meeting');
    }
    if (seen.has(index)) throw new ReviewReplyError('The model changed a line twice');
    seen.add(index);
    if (limits.current.get(index) !== speaker) changes.push({ index, speaker });
  }
  const allowed = Math.max(MIN_CHANGES_ALLOWED, Math.ceil(limits.current.size * MAX_CHANGE_SHARE));
  if (changes.length > allowed) throw new ReviewReplyError('The model changed too many lines');
  return changes;
}
