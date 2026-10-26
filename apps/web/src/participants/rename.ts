import { rememberVoice } from '@openminutes/core';
import {
  and,
  desc,
  eq,
  ne,
  participantAliases,
  participants,
  sql,
  summaries,
  type Database,
} from '@openminutes/db';
import { addSummaryVersion } from '../minutes/summary-edit.js';
import { personEmail } from './invitee-links.js';
import { renameInText } from './replace.js';

type Participant = typeof participants.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface RenameOutcome {
  summaryUpdated: boolean;
}

/** What the owner says about who this person is, besides the name. Left out keeps what is there. */
export interface PersonLinks {
  inviteeEmails?: string[];
  email?: string | null;
}

async function syncAlias(tx: Tx, original: string, name: string, person: Participant) {
  const matching = sql`lower(${participantAliases.originalName}) = lower(${original})`;
  if (
    name.toLowerCase() === original.toLowerCase() &&
    person.inviteeEmails.length === 0 &&
    !person.email
  ) {
    await tx.delete(participantAliases).where(matching);
    return;
  }
  const emails = { inviteeEmails: person.inviteeEmails, email: person.email };
  const updated = await tx
    .update(participantAliases)
    .set({ displayName: name, ...emails })
    .where(matching)
    .returning({ id: participantAliases.id });
  if (updated.length === 0) {
    await tx
      .insert(participantAliases)
      .values({ originalName: original, displayName: name, ...emails });
  }
}

async function renameInSummary(
  tx: Tx,
  meetingId: string,
  from: string,
  to: string,
  others: readonly string[],
): Promise<boolean> {
  const [latest] = await tx
    .select()
    .from(summaries)
    .where(and(eq(summaries.meetingId, meetingId), eq(summaries.status, 'done')))
    .orderBy(desc(summaries.createdAt))
    .limit(1);
  if (!latest) return false;
  const pending = await tx
    .select({ id: summaries.id })
    .from(summaries)
    .where(and(eq(summaries.meetingId, meetingId), eq(summaries.status, 'pending')))
    .limit(1);
  if (pending.length > 0) return false;
  const content = renameInText(latest.content, from, to, others);
  if (content === latest.content) return false;
  await addSummaryVersion(tx, meetingId, { origin: 'rename', content });
  return true;
}

export async function renameParticipant(
  db: Database,
  person: Participant,
  name: string,
  remember: boolean,
  links: PersonLinks = {},
): Promise<RenameOutcome> {
  return db.transaction(async (tx) => {
    const original = person.originalName ?? person.displayName;
    const [saved] = await tx
      .update(participants)
      .set({
        displayName: name,
        originalName: original,
        nameConfirmed: true,
        ...(links.inviteeEmails && { inviteeEmails: links.inviteeEmails }),
        ...(links.email !== undefined && { email: links.email }),
      })
      .where(eq(participants.id, person.id))
      .returning();
    if (remember && saved) {
      await syncAlias(tx, original, name, saved);
      if (saved.voiceEmbedding) {
        await rememberVoice(tx, name, saved.voiceEmbedding, personEmail(saved));
      }
    }
    if (name === person.displayName) return { summaryUpdated: false };
    const others = await tx
      .select({ name: participants.displayName })
      .from(participants)
      .where(and(eq(participants.meetingId, person.meetingId), ne(participants.id, person.id)));
    const summaryUpdated = await renameInSummary(
      tx,
      person.meetingId,
      person.displayName,
      name,
      others.map((other) => other.name),
    );
    return { summaryUpdated };
  });
}
