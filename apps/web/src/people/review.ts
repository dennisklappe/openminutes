import { eq, inArray, meetings, participants, transcriptSegments } from '@openminutes/db';
import type {
  PersonChoiceDto,
  PersonLineDto,
  ReviewConsideredDto,
  ReviewLineDto,
  ReviewOrder,
  ReviewQueueDto,
  ReviewScopeDto,
  ReviewRosterDto,
} from '../dto.js';
import { rememberEnabled } from '../voices/load.js';
import { loadChoices, loadPeople, personLines, type PeopleDeps } from './load.js';

/** The longest queue one review session loads. */
const QUEUE_LIMIT = 200;
const CONSIDERED_LIMIT = 3;

/** Unknown confidence is the least certain, so it comes first. */
const certainty = (line: PersonLineDto) => line.speakerConfidence ?? -1;

export interface ReviewScope {
  personId?: string | undefined;
  meetingId?: string | undefined;
  order?: ReviewOrder | undefined;
}

/**
 * The lines that need a look, for everyone, one person, one meeting or a person within a meeting.
 * By default the newest meeting first and within a meeting in the order spoken, or the least
 * certain line first. Each line carries who it is proposed for, who else was considered and the
 * other people of its meeting. People marked do not track never show up, as the proposed person,
 * as someone considered or in the meeting's list. Undefined when the meeting does not exist.
 */
export async function loadReviewQueue(
  deps: PeopleDeps,
  { personId, meetingId, order = 'newest' }: ReviewScope = {},
): Promise<ReviewQueueDto | undefined> {
  const { db } = deps;
  let meeting: ReviewScopeDto['meeting'];
  let inMeeting: Set<string> | undefined;
  if (meetingId) {
    const [found] = await db
      .select({ id: meetings.id, title: meetings.title })
      .from(meetings)
      .where(eq(meetings.id, meetingId));
    if (!found) return undefined;
    meeting = found;
    inMeeting = new Set(
      (await db.select().from(participants).where(eq(participants.meetingId, meetingId))).flatMap(
        (p) => (p.personId ? [p.personId] : []),
      ),
    );
  }
  const everyone = (await loadPeople(db, personId)).filter(
    (p) => p.tracking === 'on' && (!inMeeting || inMeeting.has(p.id)),
  );
  const proposals = new Map<string, { line: PersonLineDto; person: PersonChoiceDto }>();
  for (const person of everyone.filter((p) => p.needsReview > 0)) {
    const lines = await personLines(db, person.id, 'review', {
      limit: QUEUE_LIMIT,
      ...(meetingId && { meetingId }),
    });
    for (const line of lines) {
      if (!proposals.has(line.id)) {
        proposals.set(line.id, { line, person: { id: person.id, name: person.name } });
      }
    }
  }
  const dateIds = [...new Set([...proposals.values()].map((c) => c.line.meetingId))];
  const stamps = new Map(
    (dateIds.length === 0
      ? []
      : await db
          .select({ id: meetings.id, createdAt: meetings.createdAt })
          .from(meetings)
          .where(inArray(meetings.id, dateIds))
    ).map((m) => [m.id, m.createdAt.getTime()]),
  );
  const when = (line: PersonLineDto) => stamps.get(line.meetingId) ?? 0;
  const byTime = (a: PersonLineDto, b: PersonLineDto) =>
    when(b) - when(a) ||
    a.meetingId.localeCompare(b.meetingId) ||
    a.startMs - b.startMs ||
    a.id.localeCompare(b.id);
  const chosen = [...proposals.values()]
    .sort((a, b) =>
      order === 'uncertain'
        ? certainty(a.line) - certainty(b.line) || byTime(a.line, b.line)
        : byTime(a.line, b.line),
    )
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
  const untracked = new Set(people.filter((p) => p.tracked === false).map((p) => p.id));
  const hidden = (p: { personId: string | null }) =>
    p.personId !== null && untracked.has(p.personId);
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
      if (!who || candidate.score <= 0 || who.personId === person.id || hidden(who)) continue;
      const name = labelOf(who);
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      considered.push({ name, score: candidate.score });
    }
    const listed = new Set<string>();
    const others: ReviewRosterDto[] = [];
    for (const p of here) {
      if (p.isBot || p.personId === person.id || hidden(p)) continue;
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
  const scope: ReviewScopeDto = { ...(meeting && { meeting }) };
  if (personId) {
    const [named] = await loadPeople(db, personId);
    if (named) scope.person = { id: named.id, name: named.name, tracked: named.tracking === 'on' };
  }
  return { lines, order, scope, people, learning: await rememberEnabled(deps.settings) };
}
