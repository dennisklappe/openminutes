import { rememberVoice } from '@openminutes/core';
import {
  and,
  desc,
  eq,
  participants,
  speakerEvents,
  summaries,
  transcriptSegments,
  type Database,
} from '@openminutes/db';
import { personEmail } from '../participants/invitee-links.js';
import { replaceName } from './names.js';

type Participant = typeof participants.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

async function mergeInto(tx: Tx, from: Participant, into: Participant): Promise<void> {
  await tx
    .update(transcriptSegments)
    .set({ participantId: into.id })
    .where(eq(transcriptSegments.participantId, from.id));
  await tx
    .update(speakerEvents)
    .set({ participantId: into.id })
    .where(eq(speakerEvents.participantId, from.id));
  await tx.delete(participants).where(eq(participants.id, from.id));
}

async function rewriteSummary(tx: Tx, meetingId: string, from: string, to: string) {
  const [latest] = await tx
    .select()
    .from(summaries)
    .where(and(eq(summaries.meetingId, meetingId), eq(summaries.status, 'done')))
    .orderBy(desc(summaries.createdAt))
    .limit(1);
  if (!latest) return;
  const content = replaceName(latest.content, from, to);
  if (content !== latest.content) {
    await tx.update(summaries).set({ content }).where(eq(summaries.id, latest.id));
  }
}

export async function nameVoice(
  db: Database,
  voice: Participant,
  name: string,
  remember: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    const others = await tx
      .select()
      .from(participants)
      .where(eq(participants.meetingId, voice.meetingId));
    const twin = others.find(
      (p) => p.id !== voice.id && p.displayName.trim().toLowerCase() === name.toLowerCase(),
    );
    let embedding = voice.voiceEmbedding;
    if (twin) {
      embedding = twin.voiceEmbedding ?? voice.voiceEmbedding;
      await mergeInto(tx, voice, twin);
    }
    const survivor = twin ?? voice;
    await tx
      .update(participants)
      .set({ displayName: name, nameConfirmed: true, voiceEmbedding: embedding })
      .where(eq(participants.id, survivor.id));
    await rewriteSummary(tx, voice.meetingId, voice.displayName, name);
    if (remember && embedding) {
      await rememberVoice(tx, name, embedding, personEmail(survivor));
    }
  });
}
