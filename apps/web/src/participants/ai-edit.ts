import { planPeopleEdit } from '@openminutes/core';
import { eq, meetings } from '@openminutes/db';
import type { SummaryProvider } from '@openminutes/providers';
import { dismissInvitee, invitedEmail, linkInvitee } from './invitee-links.js';
import { loadParticipants, type ParticipantDeps } from './load.js';

/** Applies the people changes an instruction asks for and returns what was done, in plain words. */
export async function applyPeopleEdit(
  deps: ParticipantDeps,
  provider: SummaryProvider,
  meetingId: string,
  instruction: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const { absent, participants } = await loadParticipants(deps, meetingId);
  const actions = await planPeopleEdit(provider, {
    instruction,
    absent,
    participants,
    ...(signal && { signal }),
  });
  if (actions.length === 0) return [];
  const [meeting] = await deps.db.select().from(meetings).where(eq(meetings.id, meetingId));
  if (!meeting) return [];
  const applied: string[] = [];
  for (const action of actions) {
    const invitee = absent.find((entry) => entry.email === action.email);
    const email = invitee && invitedEmail(meeting, invitee.email);
    if (!invitee || !email) continue;
    const label = invitee.name ?? invitee.email;
    if (action.type === 'dismiss') {
      await dismissInvitee(deps.db, meeting, email);
      applied.push(`Removed ${label} from Unable to attend`);
      meeting.dismissedInvitees = [...(meeting.dismissedInvitees ?? []), email];
      continue;
    }
    const person = participants.find((entry) => entry.id === action.participantId);
    if (!person) continue;
    await linkInvitee(deps.db, person.id, email);
    applied.push(`Marked ${label} as present (${person.name})`);
  }
  return applied;
}
