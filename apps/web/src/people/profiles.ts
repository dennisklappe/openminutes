import {
  effectiveMs,
  normalizeLanguage,
  rebuildProfile,
  UNKNOWN_LANGUAGE,
} from '@openminutes/core';
import { and, eq, meetings, sql, voiceSamples, type Database } from '@openminutes/db';
import type { LanguageCoverageDto } from '../dto.js';
import { PeopleError } from './edit.js';
import { TARGET_MS } from './useful.js';

const names = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });

/** "Dutch" for "nl", "Unknown language" when it is not known. */
export function languageName(code: string): string {
  const language = normalizeLanguage(code);
  if (language === UNKNOWN_LANGUAGE) return 'Unknown language';
  try {
    return names.of(language) ?? language.toUpperCase();
  } catch {
    return language.toUpperCase();
  }
}

/** Where a profile is counted: one person, one language. */
export const profileKey = (personId: string, language: string) =>
  `${personId}|${normalizeLanguage(language)}`;

export interface ProfileRow {
  personId: string;
  language: string;
  /** Verified samples, ones a person confirmed. */
  samples: number;
  ms: number;
  /** Samples the voice added by itself, and the speech they cover. */
  autoSamples: number;
  autoMs: number;
  /** The meetings the auto samples come from, for removing them per meeting. */
  autoMeetings: { meetingId: string; title: string; ms: number }[];
}

/** The samples of every person per language, or of the given people, verified and auto apart. */
export async function loadProfileRows(
  db: Database,
  personIds?: readonly string[],
): Promise<ProfileRow[]> {
  if (personIds?.length === 0) return [];
  const rows = await db
    .select({
      personId: voiceSamples.personId,
      language: voiceSamples.language,
      source: voiceSamples.source,
      samples: sql<number>`coalesce(sum(${voiceSamples.weight}), 0)::int`,
      ms: sql<number>`coalesce(sum(${voiceSamples.durationMs}), 0)::int`,
    })
    .from(voiceSamples)
    .where(
      and(
        eq(voiceSamples.rejected, false),
        sql`${voiceSamples.embedding} is not null`,
        personIds
          ? sql`${voiceSamples.personId} in (${sql.join(
              personIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`
          : undefined,
      ),
    )
    .groupBy(voiceSamples.personId, voiceSamples.language, voiceSamples.source);
  const autoByMeeting = await db
    .select({
      personId: voiceSamples.personId,
      language: voiceSamples.language,
      meetingId: voiceSamples.meetingId,
      title: meetings.title,
      ms: sql<number>`coalesce(sum(${voiceSamples.durationMs}), 0)::int`,
    })
    .from(voiceSamples)
    .innerJoin(meetings, eq(meetings.id, voiceSamples.meetingId))
    .where(
      and(
        eq(voiceSamples.source, 'auto'),
        eq(voiceSamples.rejected, false),
        personIds
          ? sql`${voiceSamples.personId} in (${sql.join(
              personIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`
          : undefined,
      ),
    )
    .groupBy(voiceSamples.personId, voiceSamples.language, voiceSamples.meetingId, meetings.title);
  const merged = new Map<string, ProfileRow>();
  const rowFor = (personId: string, language: string) => {
    const code = normalizeLanguage(language);
    const key = profileKey(personId, code);
    let row = merged.get(key);
    if (!row) {
      row = {
        personId,
        language: code,
        samples: 0,
        ms: 0,
        autoSamples: 0,
        autoMs: 0,
        autoMeetings: [],
      };
      merged.set(key, row);
    }
    return row;
  };
  for (const r of rows) {
    const row = rowFor(r.personId, r.language);
    if (r.source === 'auto') {
      row.autoSamples += r.samples;
      row.autoMs += r.ms;
    } else {
      row.samples += r.samples;
      row.ms += r.ms;
    }
  }
  for (const m of autoByMeeting) {
    if (m.meetingId) {
      rowFor(m.personId, m.language).autoMeetings.push({
        meetingId: m.meetingId,
        title: m.title,
        ms: m.ms,
      });
    }
  }
  return [...merged.values()];
}

/** What each profile counts for towards its target: verified speech plus a part of the auto speech. */
export async function profileCoverage(db: Database): Promise<Map<string, number>> {
  const coverage = new Map<string, number>();
  for (const row of await loadProfileRows(db)) {
    coverage.set(profileKey(row.personId, row.language), effectiveMs(row.ms, row.autoMs));
  }
  return coverage;
}

/** The languages of a person, most speech first. */
export function languagesOf(rows: readonly ProfileRow[]): LanguageCoverageDto[] {
  return rows
    .toSorted(
      (a, b) =>
        effectiveMs(b.ms, b.autoMs) - effectiveMs(a.ms, a.autoMs) ||
        a.language.localeCompare(b.language),
    )
    .map((row) => ({
      language: row.language,
      languageName: languageName(row.language),
      samples: row.samples,
      seconds: Math.round(row.ms / 1000),
      autoSamples: row.autoSamples,
      autoSeconds: Math.round(row.autoMs / 1000),
      effectiveSeconds: Math.round(effectiveMs(row.ms, row.autoMs) / 1000),
      targetSeconds: TARGET_MS / 1000,
      autoMeetings: row.autoMeetings.map((m) => ({
        meetingId: m.meetingId,
        title: m.title,
        seconds: Math.round(m.ms / 1000),
      })),
    }));
}

/** Forgets the voice of a person in one language and builds their profile again. */
export async function deleteProfile(db: Database, personId: string, language: string) {
  const code = normalizeLanguage(language);
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(voiceSamples)
      .where(
        and(
          eq(voiceSamples.personId, personId),
          eq(voiceSamples.language, code),
          eq(voiceSamples.rejected, false),
        ),
      )
      .returning({ id: voiceSamples.id });
    if (removed.length === 0)
      throw new PeopleError('There is no voice profile in that language', 404);
    await rebuildProfile(tx, personId);
  });
}
