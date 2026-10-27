import { inArray, meetings, participants, transcriptSegments } from '@openminutes/db';
import type {
  PersonChoiceDto,
  PersonLineDto,
  ReviewConsideredDto,
  ReviewLineDto,
  ReviewQueueDto,
  ReviewRosterDto,
} from '../dto.js';
import { rememberEnabled } from '../voices/load.js';
import { loadChoices, loadPeople, personLines, type PeopleDeps } from './load.js';

/** The longest queue one review session loads. */
const QUEUE_LIMIT = 200;
const CONSIDERED_LIMIT = 3;

/** Unknown confidence is the least certain, so it comes first. */
const certainty = (line: PersonLineDto) => line.speakerConfidence ?? -1;

/**
 * The lines that need a look, for everyone or for one person, the least certain first. Each line
 * carries who it is proposed for, who else was considered and the other people of its meeting.
 */
export async function loadReviewQueue(
  deps: PeopleDeps,
  personId?: string,
): Promise<ReviewQueueDto> {
  const { db } = deps;
  const everyone = await loadPeople(db, personId);
  const proposals = new Map<string, { line: PersonLineDto; person: PersonChoiceDto }>();
  for (const person of everyone.filter((p) => p.needsReview > 0)) {
    for (const line of await personLines(db, person.id, 'review', { limit: QUEUE_LIMIT })) {
      if (!proposals.has(line.id)) {
        proposals.set(line.id, { line, person: { id: person.id, name: person.name } });
      }
    }
  }
  const chosen = [...proposals.values()]
    .sort((a, b) => certainty(a.line) - certainty(b.line) || a.line.startMs - b.line.startMs)
    .slice(0, QUEUE_LIMIT);

  const segmentIds = chosen.map((c) => c.line.id);
  const meetingIds = [...new Set(chosen.map((c) => c.line.meetingId))];
  const [segments, roster, dates, people] = await Promise.all([
    segmentIds.length === 0
      ? []
      : db
          .select({
            id: transcriptSegments.id,
            candidates: transcriptSegments.speakerCandidates,
          })
          .from(transcriptSegments)
          .where(inArray(transcriptSegments.id, segmentIds)),
    meetingIds.length === 0
      ? []
      : db.select().from(participants).where(inArray(participants.meetingId, meetingIds)),
    meetingIds.length === 0
      ? []
      : db
          .select({ id: meetings.id, createdAt: meetings.createdAt })
          .from(meetings)
          .where(inArray(meetings.id, meetingIds)),
    loadChoices(db),
  ]);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const candidatesOf = new Map(segments.map((s) => [s.id, s.candidates ?? []]));
  const dateOf = new Map(dates.map((d) => [d.id, d.createdAt.toISOString()]));
  const labelOf = (p: (typeof roster)[number]) =>
    (p.personId ? names.get(p.personId) : undefined) ?? p.displayName;
  const byId = new Map(roster.map((p) => [p.id, p]));

  const lines = chosen.map(({ line, person }): ReviewLineDto => {
    const here = roster.filter((p) => p.meetingId === line.meetingId);
    const seen = new Set<string>();
    const considered: ReviewConsideredDto[] = [];
    for (const candidate of [...(candidatesOf.get(line.id) ?? [])].sort(
      (a, b) => b.score - a.score,
    )) {
      const who = byId.get(candidate.participantId);
      if (!who || candidate.score <= 0 || who.personId === person.id) continue;
      const name = labelOf(who);
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      considered.push({ name, score: candidate.score });
    }
    const listed = new Set<string>();
    const others: ReviewRosterDto[] = [];
    for (const p of here) {
      if (p.isBot || p.personId === person.id) continue;
      if (p.personId === null && !p.nameConfirmed) continue;
      const key = p.personId ?? `name:${p.displayName.toLowerCase()}`;
      if (listed.has(key)) continue;
      listed.add(key);
      others.push({ personId: p.personId, name: labelOf(p) });
    }
    return {
      id: line.id,
      meetingId: line.meetingId,
      meetingTitle: line.meetingTitle,
      meetingDate: dateOf.get(line.meetingId) ?? new Date(0).toISOString(),
      startMs: line.startMs,
      endMs: line.endMs,
      text: line.text,
      hasAudio: line.hasAudio,
      speakerConfidence: line.speakerConfidence,
      voiceScore: line.voiceScore,
      reason: line.reason ?? 'uncertain',
      proposed: person,
      considered: considered.slice(0, CONSIDERED_LIMIT),
      roster: others.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
  return { lines, people, learning: await rememberEnabled(deps.settings) };
}
