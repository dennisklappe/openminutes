import { matchVoices, savedVoices } from '@openminutes/core';
import { eq, participants, type Database, type NameSuggestion } from '@openminutes/db';
import type { SummaryProvider } from '@openminutes/providers';
import type { RecordingSpeaker } from './recording-speakers.js';
import { splitText } from './summarize.js';

export interface SpokenLine {
  speaker: string | null;
  text: string;
}

const MAX_VOICE_SUGGESTIONS = 3;
const MAX_CONVERSATION_SUGGESTIONS = 2;
const MAX_NAME_LENGTH = 60;
const PROMPT_OVERHEAD_CHARS = 1500;

class SuggestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuggestionError';
  }
}

const NAMES_INSTRUCTIONS = `You are given part of a transcript of a recording. Each line is "Speaker N: text". Find first names or full names that people say out loud to address or introduce someone ("Thanks, Anna", "this is Mark"), and decide which Speaker N most likely bears each name. A person addressed by name is usually not the one saying it, and usually speaks right after.

Only use names that appear literally in the text. Suggest a name only when you are fairly sure. Reply with JSON only, in exactly this shape: {"names":[{"speaker":"Speaker 1","name":"Anna"}]}. Use {"names":[]} when there is nothing to suggest.`;

export async function voiceSuggestions(
  db: Database,
  speakers: readonly RecordingSpeaker[],
): Promise<Map<string, NameSuggestion[]>> {
  const known = await savedVoices(db);
  const result = new Map<string, NameSuggestion[]>();
  for (const { id, embedding } of speakers) {
    if (!embedding) continue;
    const matches = matchVoices(embedding, known).slice(0, MAX_VOICE_SUGGESTIONS);
    if (matches.length > 0) {
      result.set(
        id,
        matches.map(({ name }) => ({ name, source: 'voice' })),
      );
    }
  }
  return result;
}

function parseNames(reply: string): unknown[] {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end < start) throw new SuggestionError('The model did not return JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    throw new SuggestionError('The model returned invalid JSON');
  }
  const names = (parsed as { names?: unknown } | null)?.names;
  if (!Array.isArray(names)) throw new SuggestionError('The model reply has no names list');
  return names;
}

function validate(
  entries: readonly unknown[],
  speakerNames: ReadonlySet<string>,
  spokenText: string,
): Map<string, string[]> {
  const accepted = new Map<string, string[]>();
  for (const entry of entries) {
    const { speaker, name } = (entry ?? {}) as Record<string, unknown>;
    if (typeof speaker !== 'string' || !speakerNames.has(speaker)) {
      throw new SuggestionError('The model named a speaker that is not in the recording');
    }
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH || !spokenText.includes(trimmed)) {
      throw new SuggestionError('The model suggested a name that is not in the transcript');
    }
    const names = accepted.get(speaker) ?? [];
    if (!names.includes(trimmed)) accepted.set(speaker, [...names, trimmed]);
  }
  return accepted;
}

/**
 * Asks the summary model which names people say ("Thanks, Anna") belong to which speaker. Only
 * the transcript text with its "Speaker N" labels is sent. A name is accepted only if it occurs
 * literally in the transcript and the speaker exists, at most two per speaker. Any other answer
 * rejects everything and returns nothing, provider errors are let through.
 */
export async function conversationSuggestions(
  provider: SummaryProvider,
  lines: readonly SpokenLine[],
  speakers: readonly RecordingSpeaker[],
): Promise<Map<string, NameSuggestion[]>> {
  const speakerNames = new Set(speakers.map((speaker) => speaker.name));
  const spokenText = lines.map((line) => line.text).join('\n');
  const rendered = lines.map((line) => `${line.speaker ?? 'Unknown'}: ${line.text}`).join('\n');
  const limit = Math.max(2000, provider.maxInputChars - PROMPT_OVERHEAD_CHARS);
  const found = new Map<string, string[]>();
  for (const part of splitText(rendered, limit)) {
    const reply = await provider.summarize(part, NAMES_INSTRUCTIONS);
    for (const [speaker, names] of validate(parseNames(reply), speakerNames, spokenText)) {
      found.set(speaker, [...new Set([...(found.get(speaker) ?? []), ...names])]);
    }
  }
  const idOf = new Map(speakers.map((speaker) => [speaker.name, speaker.id]));
  const result = new Map<string, NameSuggestion[]>();
  for (const [speaker, names] of found) {
    const id = idOf.get(speaker);
    if (id) {
      result.set(
        id,
        names
          .slice(0, MAX_CONVERSATION_SUGGESTIONS)
          .map((name) => ({ name, source: 'conversation' })),
      );
    }
  }
  return result;
}

export async function storeSuggestions(
  db: Database,
  ...sources: ReadonlyMap<string, NameSuggestion[]>[]
): Promise<void> {
  const ids = [...new Set(sources.flatMap((source) => [...source.keys()]))];
  if (ids.length === 0) return;
  await db.transaction(async (tx) => {
    for (const id of ids) {
      const merged: NameSuggestion[] = [];
      for (const suggestion of sources.flatMap((source) => source.get(id) ?? [])) {
        if (!merged.some((m) => m.name.toLowerCase() === suggestion.name.toLowerCase())) {
          merged.push(suggestion);
        }
      }
      await tx.update(participants).set({ nameSuggestions: merged }).where(eq(participants.id, id));
    }
  });
}
