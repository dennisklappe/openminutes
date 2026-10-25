import { z } from 'zod';
import type { Segment } from '../types.js';
import { wordsBySegment } from './words.js';

export const verboseResponse = z.object({
  text: z.string(),
  segments: z
    .array(
      z.object({
        start: z.number(),
        end: z.number(),
        text: z.string(),
        avg_logprob: z.number().optional(),
        no_speech_prob: z.number().optional(),
        compression_ratio: z.number().optional(),
      }),
    )
    .optional(),
  words: z.array(z.object({ word: z.string(), start: z.number(), end: z.number() })).optional(),
});

type Verbose = z.infer<typeof verboseResponse>;
type VerboseSegment = NonNullable<Verbose['segments']>[number];

const CERTAIN_SILENCE = 0.9;
const LIKELY_SILENCE = 0.6;
const LOW_LOGPROB = -1;
const REPETITION_RATIO = 2.4;

/**
 * Whisper's own signals for a segment that was invented: the model says there is no speech, says
 * so with low confidence in the words it wrote anyway, or is stuck repeating itself.
 */
function isInvented(segment: VerboseSegment): boolean {
  const silent = segment.no_speech_prob ?? 0;
  const logprob = segment.avg_logprob ?? 0;
  return (
    silent > CERTAIN_SILENCE ||
    (silent > LIKELY_SILENCE && logprob < LOW_LOGPROB) ||
    (segment.compression_ratio ?? 0) > REPETITION_RATIO
  );
}

const toMs = (seconds: number) => Math.round(seconds * 1000);

export function segmentsFromVerbose(data: Verbose & { segments: VerboseSegment[] }): Segment[] {
  const timed = data.segments.map((s) => ({
    startMs: toMs(s.start),
    endMs: toMs(s.end),
    text: s.text.trim(),
  }));
  const grouped = wordsBySegment(
    (data.words ?? []).map((w) => ({
      startMs: toMs(w.start),
      endMs: toMs(w.end),
      text: w.word.trim(),
    })),
    timed,
  );
  return data.segments.flatMap((s, i): Segment[] => {
    const segment = timed[i];
    if (!segment || segment.text === '' || isInvented(s)) return [];
    const words = grouped[i];
    return [
      {
        ...segment,
        ...(words?.length ? { words } : {}),
        ...(s.avg_logprob === undefined
          ? {}
          : { confidence: Math.min(1, Math.exp(s.avg_logprob)) }),
      },
    ];
  });
}
