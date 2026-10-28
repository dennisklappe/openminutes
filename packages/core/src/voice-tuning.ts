import { inArray, settings, type Database } from '@openminutes/db';

/**
 * The numbers that decide when a voice profile is ready, when a voice agrees with it and when a
 * new sample is a new way of sounding. All are settings (Settings, Summaries, Voices) so they can
 * be tuned on a real instance without a release. The defaults are starting values, not optima.
 */
export interface VoiceTuning {
  /** Seconds of clean speech for a full Length bar. */
  readySeconds: number;
  /** Meetings for a full Variety bar. */
  readyMeetings: number;
  /** Ways of sounding for a full Variety bar. */
  readyWays: number;
  /** A line scoring at least this against a profile sounds like the person. */
  agreeScore: number;
  /** A sample joins a way of sounding at this cosine or more, else it starts a new one. */
  mergeSimilarity: number;
}

export const VOICE_TUNING_DEFAULTS: VoiceTuning = {
  readySeconds: 120,
  readyMeetings: 5,
  readyWays: 5,
  agreeScore: 0.6,
  mergeSimilarity: 0.6,
};

export const VOICE_TUNING_KEYS = {
  readySeconds: 'voices.ready_seconds',
  readyMeetings: 'voices.ready_meetings',
  readyWays: 'voices.ready_ways',
  agreeScore: 'voices.agree_score',
  mergeSimilarity: 'voices.merge_similarity',
} as const satisfies Record<keyof VoiceTuning, string>;

/** Sensible bounds, so a typo cannot make every profile ready or none. */
export const VOICE_TUNING_RANGE: Record<keyof VoiceTuning, readonly [number, number]> = {
  readySeconds: [10, 3600],
  readyMeetings: [1, 50],
  readyWays: [1, 30],
  agreeScore: [0.2, 0.95],
  mergeSimilarity: [0.2, 0.95],
};

/** Reads the tuning from raw setting values, falling back to the default for a missing or bad one. */
export function parseVoiceTuning(raw: Partial<Record<string, string | undefined>>): VoiceTuning {
  const tuning = { ...VOICE_TUNING_DEFAULTS };
  for (const name of Object.keys(VOICE_TUNING_KEYS) as (keyof VoiceTuning)[]) {
    const text = raw[VOICE_TUNING_KEYS[name]];
    const value = text === undefined || text.trim() === '' ? Number.NaN : Number(text);
    const [low, high] = VOICE_TUNING_RANGE[name];
    if (Number.isFinite(value) && value >= low && value <= high) tuning[name] = value;
  }
  return tuning;
}

export async function loadVoiceTuning(db: Pick<Database, 'select'>): Promise<VoiceTuning> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, Object.values(VOICE_TUNING_KEYS)));
  return parseVoiceTuning(Object.fromEntries(rows.map((row) => [row.key, row.value])));
}
