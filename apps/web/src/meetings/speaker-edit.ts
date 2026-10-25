import {
  and,
  eq,
  inArray,
  participants,
  transcriptSegments,
  type Database,
  type meetings,
} from '@openminutes/db';
import type { SpeakerEditInput, SpeakerSnapshotDto, SpeakerTargetInput } from '../dto.js';
import { isGenericName } from '../voices/names.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Row = typeof transcriptSegments.$inferSelect;
type Meeting = Pick<typeof meetings.$inferSelect, 'id' | 'platform'>;

export interface AppliedEdit {
  undo: SpeakerEditInput;
  learned?: { participantId: string; segmentIds: string[] };
}

export class SpeakerEditError extends Error {}

const toSnapshot = (row: Row): SpeakerSnapshotDto => ({
  id: row.id,
  speakerId: row.participantId,
  startMs: row.startMs,
  endMs: row.endMs,
  text: row.text,
  confidence: row.confidence,
  speakerConfidence: row.speakerConfidence,
  speakerSource: row.speakerSource,
  speakerCandidates: row.speakerCandidates,
  previousSpeakerId: row.previousParticipantId,
});

const fromSnapshot = (meetingId: string, row: SpeakerSnapshotDto) => ({
  id: row.id,
  meetingId,
  participantId: row.speakerId,
  startMs: row.startMs,
  endMs: row.endMs,
  text: row.text,
  confidence: row.confidence,
  speakerConfidence: row.speakerConfidence,
  speakerSource: row.speakerSource,
  speakerCandidates: row.speakerCandidates,
  previousParticipantId: row.previousSpeakerId,
});

async function segmentsOf(tx: Tx, meetingId: string, ids: readonly string[]): Promise<Row[]> {
  const unique = [...new Set(ids)];
  const rows = await tx
    .select()
    .from(transcriptSegments)
    .where(
      and(eq(transcriptSegments.meetingId, meetingId), inArray(transcriptSegments.id, unique)),
    );
  if (rows.length !== unique.length) throw new SpeakerEditError('Unknown line');
  return rows;
}

async function speakersOf(tx: Tx, meetingId: string) {
  return tx.select().from(participants).where(eq(participants.meetingId, meetingId));
}

interface Target {
  id: string;
  created: boolean;
}

async function resolveTarget(
  tx: Tx,
  meetingId: string,
  target: SpeakerTargetInput,
): Promise<Target> {
  const people = await speakersOf(tx, meetingId);
  if ('id' in target) {
    if (!people.some((p) => p.id === target.id)) throw new SpeakerEditError('Unknown speaker');
    return { id: target.id, created: false };
  }
  const named = 'name' in target;
  const existing = named && people.find((p) => p.displayName === target.name);
  if (existing) return { id: existing.id, created: false };
  const next =
    Math.max(0, ...people.filter((p) => isGenericName(p.displayName)).map(genericNumber)) + 1;
  const [created] = await tx
    .insert(participants)
    .values({
      meetingId,
      displayName: named ? target.name : `Speaker ${String(next)}`,
      nameConfirmed: named,
    })
    .returning({ id: participants.id });
  if (!created) throw new SpeakerEditError('Could not create the speaker');
  return { id: created.id, created: true };
}

const genericNumber = (person: { displayName: string }) =>
  Number(person.displayName.slice('Speaker '.length));

/** What the line records when a person picks its speaker: the machine's guess is kept to revert to. */
function assignment(row: Row, targetId: string) {
  const keepsPrevious = row.speakerSource === 'user' || row.participantId === targetId;
  return {
    participantId: targetId,
    speakerSource: 'user' as const,
    previousParticipantId: keepsPrevious ? row.previousParticipantId : row.participantId,
  };
}

async function assign(
  tx: Tx,
  meeting: Meeting,
  input: Extract<SpeakerEditInput, { kind: 'assign' }>,
): Promise<AppliedEdit> {
  const rows = await segmentsOf(tx, meeting.id, input.segmentIds);
  const target = await resolveTarget(tx, meeting.id, input.speaker);
  for (const row of rows) {
    await tx
      .update(transcriptSegments)
      .set(assignment(row, target.id))
      .where(eq(transcriptSegments.id, row.id));
  }
  return {
    undo: {
      kind: 'restore',
      rows: rows.map(toSnapshot),
      removeIds: [],
      removeSpeakerIds: target.created ? [target.id] : [],
    },
    learned: { participantId: target.id, segmentIds: rows.map((row) => row.id) },
  };
}

async function split(
  tx: Tx,
  meeting: Meeting,
  input: Extract<SpeakerEditInput, { kind: 'split' }>,
): Promise<AppliedEdit> {
  const [row] = await segmentsOf(tx, meeting.id, [input.segmentId]);
  if (!row) throw new SpeakerEditError('Unknown line');
  const words = row.text.split(/\s+/).filter((word) => word !== '');
  if (input.wordIndex >= words.length) throw new SpeakerEditError('There is no word to split at');
  const first = words.slice(0, input.wordIndex).join(' ');
  const rest = words.slice(input.wordIndex).join(' ');
  const cut =
    row.startMs +
    Math.round(((row.endMs - row.startMs) * first.length) / (first.length + 1 + rest.length));
  const target = input.speaker && (await resolveTarget(tx, meeting.id, input.speaker));
  await tx
    .update(transcriptSegments)
    .set({ text: first, endMs: cut })
    .where(eq(transcriptSegments.id, row.id));
  const [added] = await tx
    .insert(transcriptSegments)
    .values({
      meetingId: meeting.id,
      participantId: row.participantId,
      startMs: cut,
      endMs: row.endMs,
      text: rest,
      confidence: row.confidence,
      speakerConfidence: row.speakerConfidence,
      speakerSource: row.speakerSource,
      speakerCandidates: row.speakerCandidates,
      previousParticipantId: row.previousParticipantId,
      ...(target && assignment(row, target.id)),
    })
    .returning({ id: transcriptSegments.id });
  if (!added) throw new SpeakerEditError('Could not split the line');
  return {
    undo: {
      kind: 'restore',
      rows: [toSnapshot(row)],
      removeIds: [added.id],
      removeSpeakerIds: target?.created ? [target.id] : [],
    },
  };
}

async function merge(
  tx: Tx,
  meeting: Meeting,
  input: Extract<SpeakerEditInput, { kind: 'merge' }>,
): Promise<AppliedEdit> {
  const wanted = await segmentsOf(tx, meeting.id, input.segmentIds);
  const all = await tx
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meeting.id))
    .orderBy(transcriptSegments.startMs, transcriptSegments.id);
  const ids = new Set(wanted.map((row) => row.id));
  const parts = all.filter((row) => ids.has(row.id));
  if (parts.length < 2) throw new SpeakerEditError('Pick at least two lines to merge');
  const start = all.indexOf(parts[0] as Row);
  if (all.slice(start, start + parts.length).some((row, i) => row !== parts[i])) {
    throw new SpeakerEditError('Only neighbouring lines can be merged');
  }
  const [head, ...tail] = parts as [Row, ...Row[]];
  const speakers = new Set(parts.map((row) => row.participantId));
  await tx
    .update(transcriptSegments)
    .set({
      text: parts.map((row) => row.text).join(' '),
      endMs: parts.at(-1)?.endMs ?? head.endMs,
      ...(speakers.size > 1 && { speakerSource: 'user' as const }),
    })
    .where(eq(transcriptSegments.id, head.id));
  await tx.delete(transcriptSegments).where(
    inArray(
      transcriptSegments.id,
      tail.map((row) => row.id),
    ),
  );
  return {
    undo: { kind: 'restore', rows: parts.map(toSnapshot), removeIds: [], removeSpeakerIds: [] },
  };
}

async function revert(
  tx: Tx,
  meeting: Meeting,
  input: Extract<SpeakerEditInput, { kind: 'revert' }>,
): Promise<AppliedEdit> {
  const rows = (await segmentsOf(tx, meeting.id, input.segmentIds)).filter(
    (row) =>
      (row.speakerSource === 'ai' || row.speakerSource === 'guess') &&
      row.previousParticipantId !== null,
  );
  const original = meeting.platform === 'recording' ? 'diarization' : 'indicator';
  for (const row of rows) {
    await tx
      .update(transcriptSegments)
      .set({
        participantId: row.previousParticipantId,
        previousParticipantId: null,
        speakerSource: original,
      })
      .where(eq(transcriptSegments.id, row.id));
  }
  return {
    undo: { kind: 'restore', rows: rows.map(toSnapshot), removeIds: [], removeSpeakerIds: [] },
  };
}

async function restore(
  tx: Tx,
  meeting: Meeting,
  input: Extract<SpeakerEditInput, { kind: 'restore' }>,
): Promise<AppliedEdit> {
  const touched = [...new Set([...input.rows.map((row) => row.id), ...input.removeIds])];
  const present = touched.length
    ? await tx.select().from(transcriptSegments).where(inArray(transcriptSegments.id, touched))
    : [];
  if (present.some((row) => row.meetingId !== meeting.id))
    throw new SpeakerEditError('Unknown line');
  const people = new Set((await speakersOf(tx, meeting.id)).map((p) => p.id));
  for (const row of input.rows) {
    if (row.speakerId && !people.has(row.speakerId)) throw new SpeakerEditError('Unknown speaker');
  }
  const existing = new Set(present.map((row) => row.id));
  for (const row of input.rows) {
    const values = fromSnapshot(meeting.id, row);
    await tx
      .insert(transcriptSegments)
      .values({
        ...values,
        previousParticipantId: people.has(row.previousSpeakerId ?? '')
          ? row.previousSpeakerId
          : null,
      })
      .onConflictDoUpdate({ target: transcriptSegments.id, set: values });
  }
  if (input.removeIds.length > 0) {
    await tx.delete(transcriptSegments).where(inArray(transcriptSegments.id, input.removeIds));
  }
  await removeEmptySpeakers(tx, meeting.id, input.removeSpeakerIds);
  return {
    undo: {
      kind: 'restore',
      rows: present.filter((row) => touched.includes(row.id)).map(toSnapshot),
      removeIds: input.rows.map((row) => row.id).filter((id) => !existing.has(id)),
      removeSpeakerIds: [],
    },
  };
}

async function removeEmptySpeakers(tx: Tx, meetingId: string, ids: readonly string[]) {
  for (const id of ids) {
    const [used] = await tx
      .select({ id: transcriptSegments.id })
      .from(transcriptSegments)
      .where(eq(transcriptSegments.participantId, id))
      .limit(1);
    if (!used) {
      await tx
        .delete(participants)
        .where(and(eq(participants.id, id), eq(participants.meetingId, meetingId)));
    }
  }
}

export function applySpeakerEdit(
  db: Database,
  meeting: Meeting,
  input: SpeakerEditInput,
): Promise<AppliedEdit> {
  return db.transaction((tx) => {
    switch (input.kind) {
      case 'assign':
        return assign(tx, meeting, input);
      case 'split':
        return split(tx, meeting, input);
      case 'merge':
        return merge(tx, meeting, input);
      case 'revert':
        return revert(tx, meeting, input);
      case 'restore':
        return restore(tx, meeting, input);
    }
  });
}
