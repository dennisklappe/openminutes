import { BOT_DEFAULTS, type SettingsStore } from '@openminutes/core';
import { and, asc, eq, participants, type Database } from '@openminutes/db';

const GENERIC = /^Speaker \d+$/;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function participantInstructions(
  db: Database,
  settings: SettingsStore,
  meetingId: string,
): Promise<string> {
  const [people, botName] = await Promise.all([
    db
      .select({ name: participants.displayName, original: participants.originalName })
      .from(participants)
      .where(and(eq(participants.meetingId, meetingId), eq(participants.isBot, false)))
      .orderBy(asc(participants.joinedAt), asc(participants.displayName)),
    settings.get('bot.name'),
  ]);
  const bot = botName?.trim() || BOT_DEFAULTS.name;
  const listed = people
    .filter(({ name }) => !GENERIC.test(name) && !same(name, bot))
    .map(({ name, original }) =>
      original && !same(original, name) ? `${name} (joined as ${original})` : name,
    );
  if (listed.length === 0) return '';
  return `The participants were: ${listed.join(', ')}. Refer to people by these names, using first names where they are unambiguous, and never by the name they joined the call as.`;
}
