import {
  and,
  eq,
  inArray,
  isNull,
  people,
  sql,
  voiceSamples,
  type Database,
} from '@openminutes/db';
import { effectiveMs } from './voice-auto.js';
import { normalizeLanguage } from './voice-language.js';
import { prototypesIn } from './voice-profile.js';
import type { VoiceTuning } from './voice-tuning.js';

/** What a profile has to show for itself: one person, one language. */
export interface ProfileFacts {
  /** Speech of lines a person confirmed, and of lines added by themselves, in milliseconds. */
  verifiedMs: number;
  autoMs: number;
  /** Different meetings the samples come from. */
  meetings: number;
  /** Ways of sounding: the vectors of the profile in this language. */
  ways: number;
}

export interface Readiness {
  /** Clean speech against the target, 0 to 1. */
  length: number;
  /** The weaker of meetings and ways of sounding against their targets, 0 to 1. */
  variety: number;
  meetings: number;
  ways: number;
  /** Both bars are full. */
  ready: boolean;
}

const share = (have: number, target: number) => Math.min(1, Math.max(0, have / target));

/** The two bars of a profile. Ready means 100% on both. */
export function readiness(facts: ProfileFacts, tuning: VoiceTuning): Readiness {
  const length = share(effectiveMs(facts.verifiedMs, facts.autoMs), tuning.readySeconds * 1000);
  const meetings = share(facts.meetings, tuning.readyMeetings);
  const ways = share(facts.ways, tuning.readyWays);
  const variety = Math.min(meetings, ways);
  return { length, variety, meetings, ways, ready: length >= 1 && variety >= 1 };
}

/** A line scores at least this against the profile of the person to count as their voice. */
export const agreeThreshold = (tuning: VoiceTuning, autoMargin = 0) =>
  Math.min(0.95, tuning.agreeScore + autoMargin);

/** Where a profile is counted: one person, one language. */
export const readinessKey = (personId: string, language: string) =>
  `${personId}|${normalizeLanguage(language)}`;

/** The facts of every profile, or of the given people, keyed by `readinessKey`. */
export async function loadProfileFacts(
  db: Pick<Database, 'select'>,
  personIds?: readonly string[],
): Promise<Map<string, ProfileFacts>> {
  if (personIds?.length === 0) return new Map();
  const rows = await db
    .select({
      personId: voiceSamples.personId,
      language: voiceSamples.language,
      source: voiceSamples.source,
      ms: sql<number>`coalesce(sum(${voiceSamples.durationMs}), 0)::int`,
    })
    .from(voiceSamples)
    .where(
      and(
        eq(voiceSamples.rejected, false),
        isNull(voiceSamples.prunedAt),
        sql`${voiceSamples.embedding} is not null`,
        personIds ? inArray(voiceSamples.personId, [...personIds]) : undefined,
      ),
    )
    .groupBy(voiceSamples.personId, voiceSamples.language, voiceSamples.source);
  const meetingRows = await db
    .select({
      personId: voiceSamples.personId,
      language: voiceSamples.language,
      meetings: sql<number>`count(distinct ${voiceSamples.meetingId})::int`,
    })
    .from(voiceSamples)
    .where(
      and(
        eq(voiceSamples.rejected, false),
        isNull(voiceSamples.prunedAt),
        sql`${voiceSamples.embedding} is not null`,
        personIds ? inArray(voiceSamples.personId, [...personIds]) : undefined,
      ),
    )
    .groupBy(voiceSamples.personId, voiceSamples.language);
  const owners = await db
    .select({ id: people.id, prototypes: people.voicePrototypes })
    .from(people)
    .where(personIds ? inArray(people.id, [...personIds]) : undefined);
  const facts = new Map<string, ProfileFacts>();
  const factsFor = (personId: string, language: string) => {
    const key = readinessKey(personId, language);
    let entry = facts.get(key);
    if (!entry) {
      entry = { verifiedMs: 0, autoMs: 0, meetings: 0, ways: 0 };
      facts.set(key, entry);
    }
    return entry;
  };
  for (const row of rows) {
    const entry = factsFor(row.personId, row.language);
    if (row.source === 'auto') entry.autoMs += row.ms;
    else entry.verifiedMs += row.ms;
  }
  for (const row of meetingRows) factsFor(row.personId, row.language).meetings = row.meetings;
  for (const owner of owners) {
    for (const language of new Set(owner.prototypes.map((p) => normalizeLanguage(p.language)))) {
      factsFor(owner.id, language).ways = prototypesIn(owner.prototypes, language).length;
    }
  }
  return facts;
}

/** The profiles that are ready, as `readinessKey`s, for the given people or everyone. */
export async function readyProfiles(
  db: Pick<Database, 'select'>,
  tuning: VoiceTuning,
  personIds?: readonly string[],
): Promise<Set<string>> {
  const facts = await loadProfileFacts(db, personIds);
  return new Set([...facts].filter(([, f]) => readiness(f, tuning).ready).map(([key]) => key));
}
