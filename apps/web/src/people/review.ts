import {
  and,
  eq,
  inArray,
  meetings,
  participants,
  reviewDecisions,
  sql,
  transcriptSegments,
} from '@openminutes/db';
import type {
  PersonChoiceDto,
  PersonLineDto,
  ReviewCompleteDto,
  ReviewConsideredDto,
  ReviewLineDto,
  ReviewOrder,
  ReviewQueueDto,
  ReviewScopeDto,
  ReviewRosterDto,
} from '../dto.js';
import { languageName, profileCoverage, profileKey } from './profiles.js';
import { SESSION_CAP, TARGET_MS, selectUseful, whyOf, type Candidate } from './useful.js';
import { rememberEnabled } from '../voices/load.js';
import { loadChoices, loadPeople, personLines, trainingLines, type PeopleDeps } from './load.js';

/** The most lines looked at per person and in one queue. A session shows SESSION_CAP of them. */
const QUEUE_LIMIT = 500;
/** Confident lines fetched per person that still needs samples. */
const TRAINING_LIMIT = 150;
const CONSIDERED_LIMIT = 3;
/** Speech of other speakers shorter than this over a line is not an overlap. */
const OVERLAP_MS = 300;

/** Unknown confidence is the least certain, so it comes first. */
const certainty = (line: PersonLineDto) => line.speakerConfidence ?? -1;

/** The languages in which a person already has a good enough profile. */
function finishedLanguages(coverage: ReadonlyMap<string, number>, personId: string) {
  return [...coverage]
    .filter(([key, ms]) => key.startsWith(`${personId}|`) && ms >= TARGET_MS)
    .map(([key]) => ({ language: key.slice(personId.length + 1) }));
}

type Proposals = Map<string, { line: PersonLineDto; person: PersonChoiceDto }>;

const dbMeetings = (db: PeopleDeps['db'], ids: string[]) =>
  db
    .select({ id: meetings.id, createdAt: meetings.createdAt, platform: meetings.platform })
    .from(meetings)
    .where(inArray(meetings.id, ids));

/** The ids of lines another speaker talks over, which no voice profile can learn from. */
async function overlappedIds(db: PeopleDeps['db'], ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { rows } = await db.execute<{ id: string }>(sql`
    select s.id from transcript_segments s
    where s.id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      and exists (
        select 1 from transcript_segments o
        where o.meeting_id = s.meeting_id and o.id <> s.id
          and o.participant_id is distinct from s.participant_id
          and o.start_ms < s.end_ms - ${OVERLAP_MS} and o.end_ms > s.start_ms + ${OVERLAP_MS}
      )`);
  return new Set(rows.map((row) => row.id));
}

async function pickUseful(
  db: PeopleDeps['db'],
  proposals: Proposals,
  meetingRows: { id: string; platform: string }[],
  coverage: ReadonlyMap<string, number>,
) {
  const ids = [...proposals.keys()];
  const meetingIds = meetingRows.map((m) => m.id);
  const [segments, overlapped, roster] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select({
            id: transcriptSegments.id,
            candidates: transcriptSegments.speakerCandidates,
            doubt: transcriptSegments.voiceDoubt,
          })
          .from(transcriptSegments)
          .where(inArray(transcriptSegments.id, ids)),
    overlappedIds(db, ids),
    meetingIds.length === 0
      ? []
      : db
          .select({ id: participants.id, personId: participants.personId })
          .from(participants)
          .where(inArray(participants.meetingId, meetingIds)),
  ]);
  const owner = new Map(roster.map((p) => [p.id, p.personId]));
  const detail = new Map(segments.map((s) => [s.id, s]));
  const channel = new Map(meetingRows.map((m) => [m.id, m.platform]));
  const candidates: Candidate[] = [...proposals.values()].map(({ line, person }) => {
    const seg = detail.get(line.id);
    const rival = Math.max(
      0,
      ...(seg?.candidates ?? [])
        .filter((c) => c.score > 0 && owner.get(c.participantId) !== person.id)
        .map((c) => c.score),
    );
    return {
      id: line.id,
      group: profileKey(person.id, line.language),
      personId: person.id,
      meetingId: line.meetingId,
      startMs: line.startMs,
      endMs: line.endMs,
      text: line.text,
      channel: channel.get(line.meetingId) ?? '',
      overlapped: overlapped.has(line.id),
      voiceDoubt: line.reason === 'voice' || seg?.doubt === true,
      rival,
      confidence: line.speakerConfidence,
      suggested: line.reason === 'suggested' || line.reason === 'elimination',
    };
  });
  const { picked } = selectUseful(candidates, coverage, QUEUE_LIMIT);
  return { picked, candidates };
}

export interface ReviewScope {
  personId?: string | undefined;
  meetingId?: string | undefined;
  order?: ReviewOrder | undefined;
  /** Only the lines skipped earlier, instead of everything but them. */
  skipped?: boolean | undefined;
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
  { personId, meetingId, order = 'newest', skipped = false }: ReviewScope = {},
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
  // Lines the labelling is sure of are worth confirming while the profile needs samples.
  const coverage = await profileCoverage(db);
  if (!skipped) {
    for (const person of everyone) {
      const lines = await trainingLines(db, person.id, {
        limit: TRAINING_LIMIT,
        skipLanguages: finishedLanguages(coverage, person.id).map((f) => f.language),
        ...(meetingId && { meetingId }),
      });
      for (const line of lines) {
        if (!proposals.has(line.id)) {
          proposals.set(line.id, { line, person: { id: person.id, name: person.name } });
        }
      }
    }
  }
  // A skip hides the line for the person it was proposed for, in every session. A line proposed
  // for someone else now is a new question and comes back.
  const skips = new Map(
    (proposals.size === 0
      ? []
      : await db
          .select({ segmentId: reviewDecisions.segmentId, personId: reviewDecisions.personId })
          .from(reviewDecisions)
          .where(
            and(
              eq(reviewDecisions.kind, 'skip'),
              inArray(reviewDecisions.segmentId, [...proposals.keys()]),
            ),
          )
    ).map((row) => [row.segmentId, row.personId]),
  );
  let skippedCount = 0;
  for (const [id, { person }] of proposals) {
    const isSkipped = skips.get(id) === person.id;
    if (isSkipped) skippedCount++;
    if (isSkipped !== skipped) proposals.delete(id);
  }
  const dateIds = [...new Set([...proposals.values()].map((c) => c.line.meetingId))];
  const meetingRows = dateIds.length === 0 ? [] : await dbMeetings(db, dateIds);
  const stamps = new Map(meetingRows.map((m) => [m.id, m.createdAt.getTime()]));
  const when = (line: PersonLineDto) => stamps.get(line.meetingId) ?? 0;
  const byTime = (a: PersonLineDto, b: PersonLineDto) =>
    when(b) - when(a) ||
    a.meetingId.localeCompare(b.meetingId) ||
    a.startMs - b.startMs ||
    a.id.localeCompare(b.id);
  const inOrder = (a: { line: PersonLineDto }, b: { line: PersonLineDto }) =>
    order === 'uncertain'
      ? certainty(a.line) - certainty(b.line) || byTime(a.line, b.line)
      : byTime(a.line, b.line);

  // Only lines that teach a voice profile something are asked, the skipped list excepted.
  let useful = [...proposals.values()];
  let complete: ReviewCompleteDto[] = [];
  const picked = await pickUseful(db, proposals, meetingRows, coverage);
  const why = new Map(picked.candidates.map((c) => [c.id, whyOf(c)]));
  if (!skipped) {
    const byId = new Map(proposals);
    useful = picked.picked.flatMap((c) => byId.get(c.id) ?? []);
    // Whoever has a good profile no longer gets lines asked for training, only doubtful ones.
    complete = everyone
      .filter((p) => p.meetings > 0)
      .flatMap((p) =>
        finishedLanguages(coverage, p.id).map(({ language }) => ({
          id: p.id,
          name: p.name,
          language,
          languageName: languageName(language),
        })),
      );
  }
  const more = skipped ? 0 : Math.max(0, useful.length - SESSION_CAP);
  const chosen = (
    skipped ? useful.sort(inOrder).slice(0, QUEUE_LIMIT) : useful.slice(0, SESSION_CAP)
  ).sort(inOrder);

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
      why: why.get(line.id) ?? 'doubt',
      proposed: person,
      language: line.language,
      languageName: languageName(line.language),
      profileSeconds: Math.round((coverage.get(profileKey(person.id, line.language)) ?? 0) / 1000),
      profileTargetSeconds: TARGET_MS / 1000,
      considered: considered.slice(0, CONSIDERED_LIMIT),
      roster: others.sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
  const scope: ReviewScopeDto = { ...(meeting && { meeting }) };
  if (personId) {
    const [named] = await loadPeople(db, personId);
    if (named) scope.person = { id: named.id, name: named.name, tracked: named.tracking === 'on' };
  }
  return {
    lines,
    order,
    scope,
    people,
    skippedCount,
    more,
    complete,
    learning: await rememberEnabled(deps.settings),
  };
}
