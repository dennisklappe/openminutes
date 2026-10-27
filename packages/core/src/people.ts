import {
  and,
  asc,
  eq,
  inArray,
  meetings,
  ne,
  participants,
  people,
  sql,
  transcriptSegments,
  voiceSamples,
  type Database,
  type VoiceSampleKind,
  type VoiceSampleSource,
} from '@openminutes/db';
import { AUTO_MARGIN_MAX, AUTO_MARGIN_STEP, AUTO_SAMPLE_WEIGHT } from './voice-auto.js';
import { normalizeLanguage } from './voice-language.js';
import { buildPrototypes } from './voice-profile.js';

type Writer = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;
export type Person = typeof people.$inferSelect;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Trimmed, lower case, without blanks and doubles, in the order given. */
export function cleanEmails(emails: readonly string[]): string[] {
  return [...new Set(emails.map(normalizeEmail).filter((email) => email !== ''))];
}

const byName = (name: string) => sql`lower(${people.name}) = lower(${name.trim()})`;

export async function findPersonByName(db: Writer, name: string): Promise<Person | undefined> {
  const [person] = await db.select().from(people).where(byName(name));
  return person;
}

/**
 * The person with this name, created when there is none, with the email added to theirs. Names
 * are compared without regard to case, so "anna de vries" and "Anna de Vries" are one person.
 */
export async function ensurePerson(
  db: Writer,
  name: string,
  email?: string | readonly (string | null)[] | null,
): Promise<Person> {
  const trimmed = name.trim();
  const given = typeof email === 'string' ? [email] : (email ?? []);
  const wanted = cleanEmails(given.filter((address): address is string => address !== null));
  const existing = await findPersonByName(db, trimmed);
  if (!existing) {
    const [created] = await db
      .insert(people)
      .values({ name: trimmed, emails: wanted })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const raced = await findPersonByName(db, trimmed);
    if (!raced) throw new Error(`could not create the person ${trimmed}`);
    return raced;
  }
  const emails = cleanEmails([...existing.emails, ...wanted]);
  if (emails.length === existing.emails.length) return existing;
  const [updated] = await db
    .update(people)
    .set({ emails, updatedAt: new Date() })
    .where(eq(people.id, existing.id))
    .returning();
  return updated ?? existing;
}

const GENERIC_NAME = /^Speaker \d+$/;

/**
 * Links a participant to the person of that name, creating the person. A participant that still
 * has a generic "Speaker 2" name is nobody yet and is left alone.
 */
export async function linkParticipant(
  db: Writer,
  participant: {
    id: string;
    displayName: string;
    email: string | null;
    inviteeEmails: readonly string[];
  },
): Promise<Person | undefined> {
  if (GENERIC_NAME.test(participant.displayName) || participant.displayName.trim() === '') return;
  const person = await ensurePerson(db, participant.displayName, [
    participant.email,
    ...participant.inviteeEmails,
  ]);
  await db
    .update(participants)
    .set({ personId: person.id })
    .where(eq(participants.id, participant.id));
  return person;
}

/** False for a person who is marked do not track: nothing is learned or suggested for them. */
export async function isTracked(db: Pick<Database, 'select'>, personId: string): Promise<boolean> {
  const [person] = await db
    .select({ tracking: people.tracking })
    .from(people)
    .where(eq(people.id, personId));
  return person?.tracking !== 'off';
}

/**
 * Stops tracking a person: their voice samples, profile and the voice of their participants are
 * deleted, and nothing is learned for them from now on. Their name stays in every transcript.
 */
export async function stopTracking(db: Writer, personId: string): Promise<void> {
  await forgetVoices(db, [personId]);
  await db
    .update(participants)
    .set({ voiceEmbedding: null })
    .where(eq(participants.personId, personId));
  await db
    .update(people)
    .set({ tracking: 'off', updatedAt: new Date() })
    .where(eq(people.id, personId));
}

export async function resumeTracking(db: Writer, personId: string): Promise<void> {
  await db
    .update(people)
    .set({ tracking: 'on', updatedAt: new Date() })
    .where(eq(people.id, personId));
}

/** Builds the voice profile of a person again from their samples. */
export async function rebuildProfile(db: Writer, personId: string): Promise<void> {
  const samples = await db
    .select({
      embedding: voiceSamples.embedding,
      weight: voiceSamples.weight,
      language: voiceSamples.language,
      source: voiceSamples.source,
    })
    .from(voiceSamples)
    .where(and(eq(voiceSamples.personId, personId), eq(voiceSamples.rejected, false)))
    .orderBy(asc(voiceSamples.createdAt), asc(voiceSamples.id));
  // A sample added by itself counts less than one a person confirmed.
  const usable = samples.flatMap(({ embedding, weight, language, source }) =>
    embedding
      ? [{ embedding, weight: source === 'auto' ? weight * AUTO_SAMPLE_WEIGHT : weight, language }]
      : [],
  );
  await db
    .update(people)
    .set({ voicePrototypes: buildPrototypes(usable), updatedAt: new Date() })
    .where(eq(people.id, personId));
}

export interface NewSample {
  personId: string;
  kind: VoiceSampleKind;
  embedding: number[];
  embedder?: string | null | undefined;
  meetingId?: string | null | undefined;
  segmentId?: string | null | undefined;
  durationMs?: number | undefined;
  /** verified (default): a person confirmed the line. auto: added by itself from a near-certain line. */
  source?: VoiceSampleSource | undefined;
  /** The language spoken. Left out, it is taken from the line, then from the meeting. */
  language?: string | null | undefined;
}

/** The language of a sample: the one given, else that of its line, else that of its meeting. */
async function languageOf(db: Writer, sample: NewSample): Promise<string> {
  if (sample.language !== undefined && sample.language !== null) {
    return normalizeLanguage(sample.language);
  }
  if (sample.segmentId) {
    const [line] = await db
      .select({ language: transcriptSegments.language, meeting: meetings.language })
      .from(transcriptSegments)
      .innerJoin(meetings, eq(meetings.id, transcriptSegments.meetingId))
      .where(eq(transcriptSegments.id, sample.segmentId));
    if (line) return normalizeLanguage(line.language ?? line.meeting);
  }
  if (sample.meetingId) {
    const [meeting] = await db
      .select({ language: meetings.language })
      .from(meetings)
      .where(eq(meetings.id, sample.meetingId));
    return normalizeLanguage(meeting?.language);
  }
  return normalizeLanguage(undefined);
}

async function upsertSample(db: Writer, sample: NewSample): Promise<void> {
  const values = {
    personId: sample.personId,
    kind: sample.kind,
    embedding: sample.embedding,
    embedder: sample.embedder ?? null,
    meetingId: sample.meetingId ?? null,
    segmentId: sample.segmentId ?? null,
    durationMs: sample.durationMs ?? 0,
    language: await languageOf(db, sample),
    source: sample.source ?? 'verified',
    rejected: false,
  };
  const same = sample.segmentId
    ? eq(voiceSamples.segmentId, sample.segmentId)
    : sample.kind === 'meeting' && sample.meetingId
      ? and(eq(voiceSamples.kind, 'meeting'), eq(voiceSamples.meetingId, sample.meetingId))
      : undefined;
  const [existing] = same
    ? await db
        .select({ id: voiceSamples.id })
        .from(voiceSamples)
        .where(and(eq(voiceSamples.personId, sample.personId), same))
    : [];
  if (existing) {
    await db.update(voiceSamples).set(values).where(eq(voiceSamples.id, existing.id));
  } else {
    await db.insert(voiceSamples).values(values);
  }
}

/**
 * Adds verified stretches of a voice and builds the profile again. A line counts once per person
 * and a meeting once per person, a repeat replaces the earlier vector.
 */
export async function addVoiceSamples(
  db: Writer,
  personId: string,
  samples: readonly Omit<NewSample, 'personId'>[],
): Promise<void> {
  if (!(await isTracked(db, personId))) return;
  for (const sample of samples) await upsertSample(db, { ...sample, personId });
  await rebuildProfile(db, personId);
}

export const addVoiceSample = (db: Writer, sample: NewSample) =>
  addVoiceSamples(db, sample.personId, [sample]);

/**
 * Remembers a voice found in a meeting under a name: the person is created when new and the
 * voice joins their profile as one sample for that meeting.
 */
export async function rememberVoice(
  db: Writer,
  name: string,
  embedding: number[],
  email?: string | readonly (string | null)[] | null,
  meetingId?: string | null,
): Promise<Person> {
  const person = await ensurePerson(db, name, email);
  await addVoiceSample(db, {
    personId: person.id,
    kind: meetingId ? 'meeting' : 'imported',
    embedding,
    meetingId,
  });
  return person;
}

/** Every saved voice vector of a tracked person with the name it belongs to, for matching a new voice by name. */
export async function savedVoices(
  db: Pick<Database, 'select'>,
): Promise<{ name: string; embedding: number[]; language: string }[]> {
  const rows = await db
    .select({ name: people.name, prototypes: people.voicePrototypes })
    .from(people)
    .where(eq(people.tracking, 'on'));
  return rows.flatMap(({ name, prototypes }) =>
    prototypes.map((prototype) => ({
      name,
      embedding: prototype.vector,
      language: normalizeLanguage(prototype.language),
    })),
  );
}

/**
 * Takes the lines out of the voice profiles of everyone but `keep`, because the lines now belong
 * to someone else, and builds those profiles again.
 */
export async function dropLineSamples(
  db: Writer,
  segmentIds: readonly string[],
  keep?: string | null,
): Promise<void> {
  if (segmentIds.length === 0) return;
  const stale = await db
    .select({ id: voiceSamples.id, personId: voiceSamples.personId })
    .from(voiceSamples)
    .where(
      and(
        inArray(voiceSamples.segmentId, [...segmentIds]),
        keep ? ne(voiceSamples.personId, keep) : undefined,
      ),
    );
  if (stale.length === 0) return;
  await db.delete(voiceSamples).where(
    inArray(
      voiceSamples.id,
      stale.map((sample) => sample.id),
    ),
  );
  for (const personId of new Set(stale.map((sample) => sample.personId))) {
    await rebuildProfile(db, personId);
  }
}

/** Removes everything voice related of the given people, or of everyone. */
export async function forgetVoices(db: Writer, personIds?: readonly string[]): Promise<void> {
  if (personIds && personIds.length === 0) return;
  await db
    .delete(voiceSamples)
    .where(personIds ? inArray(voiceSamples.personId, [...personIds]) : undefined);
  await db
    .update(people)
    .set({ voicePrototypes: [], updatedAt: new Date() })
    .where(personIds ? inArray(people.id, [...personIds]) : undefined);
}

/**
 * Takes the samples that were added by themselves out of the voice profiles and builds those
 * profiles again. Narrow it to one person, one language or one meeting. Verified samples stay.
 */
export async function removeAutoSamples(
  db: Writer,
  scope: { personId?: string; language?: string; meetingId?: string },
): Promise<number> {
  const removed = await db
    .delete(voiceSamples)
    .where(
      and(
        eq(voiceSamples.source, 'auto'),
        scope.personId ? eq(voiceSamples.personId, scope.personId) : undefined,
        scope.language ? eq(voiceSamples.language, normalizeLanguage(scope.language)) : undefined,
        scope.meetingId ? eq(voiceSamples.meetingId, scope.meetingId) : undefined,
      ),
    )
    .returning({ personId: voiceSamples.personId });
  for (const personId of new Set(removed.map((row) => row.personId))) {
    await rebuildProfile(db, personId);
  }
  return removed.length;
}

/**
 * A sample added by itself was rejected by a person: the line is not theirs. That is a signal
 * the near-certain test was too loose for this person, so they need a little more margin.
 */
export async function penalizeAutoMargin(db: Writer, personId: string): Promise<void> {
  await db
    .update(people)
    .set({ autoMargin: sql`least(${people.autoMargin} + ${AUTO_MARGIN_STEP}, ${AUTO_MARGIN_MAX})` })
    .where(eq(people.id, personId));
}
