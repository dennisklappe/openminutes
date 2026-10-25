import type { VoiceDto, VoiceSuggestionDto } from '../src/dto.js';

export const NAME_MAX = 80;

export const sourceLabels: Record<VoiceSuggestionDto['source'], string> = {
  conversation: 'Said in the call',
  voice: 'Sounds like',
  calendar: 'Invited',
  participant: 'Also in this meeting',
};

const isGenericName = (name: string) => /^Speaker \d+$/.test(name);

export const initialName = (voice: VoiceDto) =>
  voice.confirmed || !isGenericName(voice.name) ? voice.name : '';

export function canSave(voice: VoiceDto, draft: string, remember: boolean): boolean {
  const name = draft.trim();
  if (name === '' || name.length > NAME_MAX) return false;
  return !voice.confirmed || name !== voice.name || remember;
}
