import { matchVoices, type SettingsStore } from '@openminutes/core';
import {
  asc,
  eq,
  knownVoices,
  participants,
  transcriptSegments,
  type Database,
  type meetings,
} from '@openminutes/db';
import type { VoiceDto, VoicesDto, VoiceSuggestionDto } from '../dto.js';
import { isGenericName, mergeSuggestions } from './names.js';
import { pickSnippets } from './snippets.js';

export interface VoiceDeps {
  db: Database;
  settings: SettingsStore;
}

type Meeting = typeof meetings.$inferSelect;
type Participant = typeof participants.$inferSelect;

export const rememberEnabled = async (settings: SettingsStore) =>
  (await settings.get('voices.remember')) === 'true';

function calendarNames(meeting: Meeting): VoiceSuggestionDto[] {
  return (meeting.invitees ?? []).map((invitee) => ({
    name: invitee.name ?? invitee.email,
    source: 'calendar',
  }));
}

export async function loadVoices(deps: VoiceDeps, meeting: Meeting): Promise<VoicesDto> {
  const remember = await rememberEnabled(deps.settings);
  const [people, segments, known] = await Promise.all([
    deps.db.select().from(participants).where(eq(participants.meetingId, meeting.id)),
    deps.db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meeting.id))
      .orderBy(asc(transcriptSegments.startMs)),
    remember ? deps.db.select().from(knownVoices) : Promise.resolve([]),
  ]);

  const firstSpoken = (p: Participant) => segments.findIndex((s) => s.participantId === p.id);
  const speaking = people
    .filter((p) => firstSpoken(p) >= 0)
    .sort((a, b) => firstSpoken(a) - firstSpoken(b));
  const named = (p: Participant): VoiceSuggestionDto[] =>
    speaking
      .filter((other) => other.id !== p.id && !isGenericName(other.displayName))
      .map((other) => ({ name: other.displayName, source: 'participant' }));
  const heard = (p: Participant): VoiceSuggestionDto[] =>
    p.voiceEmbedding
      ? matchVoices(p.voiceEmbedding, known).map(({ name }) => ({ name, source: 'voice' }))
      : [];

  const voices = speaking.map((p): VoiceDto => {
    const own = segments.filter((s) => s.participantId === p.id);
    const stored = p.nameSuggestions ?? [];
    return {
      id: p.id,
      name: p.displayName,
      confirmed: p.nameConfirmed,
      durationMs: own.reduce((total, s) => total + s.endMs - s.startMs, 0),
      snippets: pickSnippets(own),
      suggestions: mergeSuggestions(
        [
          stored.filter((s) => s.source === 'conversation'),
          [...stored.filter((s) => s.source === 'voice'), ...heard(p)],
          calendarNames(meeting),
          named(p),
        ],
        p.displayName,
      ),
    };
  });

  return {
    voices,
    needsNaming:
      meeting.platform === 'recording' && voices.some((v) => !v.confirmed && isGenericName(v.name)),
    rememberEnabled: remember,
  };
}
