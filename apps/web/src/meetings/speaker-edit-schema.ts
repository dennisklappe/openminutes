import { mixedStates, speakerSources } from '@openminutes/db';
import { z } from 'zod';
import type { SpeakerEditInput } from '../dto.js';

const MAX_IDS = 500;
const uuid = z.uuid();
const ids = z.array(uuid).min(1).max(MAX_IDS);

const speakerName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((name) => !/\p{Cc}/u.test(name));

const target = z.union([
  z.strictObject({ id: uuid }),
  z.strictObject({ name: speakerName }),
  z.strictObject({ create: z.literal(true) }),
]);

const snapshot = z.strictObject({
  id: uuid,
  speakerId: uuid.nullable(),
  startMs: z.int().min(0),
  endMs: z.int().min(0),
  text: z.string().max(100_000),
  confidence: z.number().nullable(),
  speakerConfidence: z.number().nullable(),
  speakerSource: z.enum(speakerSources).nullable(),
  speakerCandidates: z
    .array(z.strictObject({ participantId: uuid, score: z.number() }))
    .max(50)
    .nullable(),
  previousSpeakerId: uuid.nullable(),
  suggestedSpeakerId: uuid.nullable(),
  rejectedSuggestions: z.array(uuid).max(50),
  mixed: z.enum(mixedStates).nullable().optional(),
});

export const speakerEditInput = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('assign'), segmentIds: ids, speaker: target }),
  z.strictObject({
    kind: z.literal('split'),
    segmentId: uuid,
    wordIndex: z.int().min(1),
    speaker: target.optional(),
  }),
  z.strictObject({ kind: z.literal('merge'), segmentIds: z.array(uuid).min(2).max(MAX_IDS) }),
  z.strictObject({ kind: z.literal('revert'), segmentIds: ids }),
  z.strictObject({ kind: z.literal('clear-mixed'), segmentIds: ids }),
  z.strictObject({ kind: z.literal('reject-suggestion'), segmentIds: ids }),
  z.strictObject({
    kind: z.literal('restore'),
    rows: z.array(snapshot).max(MAX_IDS),
    removeIds: z.array(uuid).max(MAX_IDS),
    removeSpeakerIds: z.array(uuid).max(MAX_IDS),
  }),
]) satisfies z.ZodType<SpeakerEditInput>;
