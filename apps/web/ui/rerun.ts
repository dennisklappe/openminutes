import type { MeetingRerunDto } from '../src/dto.js';
import type { MenuItem } from './Menu.js';

export type RerunKind = 'transcribe' | 'voices' | 'speakers';

export interface RerunInput {
  canTranscribe: boolean;
  hasTranscript: boolean;
  rerun: MeetingRerunDto;
}

export function rerunItems(input: RerunInput, choose: (kind: RerunKind) => void): MenuItem[] {
  const { canTranscribe, hasTranscript, rerun } = input;
  const item = (label: string, kind: RerunKind): MenuItem => ({
    label,
    onSelect: () => {
      choose(kind);
    },
  });
  return [
    ...(canTranscribe
      ? [item(hasTranscript ? 'Re-transcribe...' : 'Transcribe...', 'transcribe')]
      : []),
    ...(rerun.available ? [item('Re-run voice recognition...', 'voices')] : []),
    ...(rerun.speakers ? [item('Re-run speakers with a number of people...', 'speakers')] : []),
  ];
}

export interface RerunCopy {
  title: string;
  confirm: string;
  keeps: string;
  changes: string;
  /** Why the action cannot run now, when it cannot. */
  blocked?: string;
}

const KEPT_BY_HAND = 'Lines whose speaker you set by hand are never touched.';

export function rerunCopy(kind: RerunKind, options: { voiceCheckOn: boolean }): RerunCopy {
  if (kind === 'transcribe') {
    return {
      title: 'Re-transcribe',
      confirm: 'Re-transcribe',
      keeps: `${KEPT_BY_HAND} Names you gave to voices are kept where the voice still matches.`,
      changes:
        'The recording is transcribed again, so the text can change. Speakers, name suggestions and the speaker review are redone and a new summary version is written. Older summaries stay in History.',
    };
  }
  if (kind === 'voices') {
    return {
      title: 'Re-run voice recognition',
      confirm: 'Re-run',
      keeps: `The text and the speakers stay as they are. ${KEPT_BY_HAND}`,
      changes:
        'Every other line is compared with the saved voices again, then name suggestions and the speaker review are redone. Nothing is transcribed again. The summary is not rewritten: a notice offers to regenerate it.',
      ...(options.voiceCheckOn
        ? {}
        : {
            blocked:
              'Check lines against saved voices is off, so there is nothing to run. Turn it on under Settings, Voices.',
          }),
    };
  }
  return {
    title: 'Re-run speakers',
    confirm: 'Re-run speakers',
    keeps: `The text stays as it is. ${KEPT_BY_HAND} Names you gave to voices are kept where the voice still matches.`,
    changes:
      'The voices are found again with exactly this many people and every other line moves to them. Then the voice check, name suggestions and the speaker review run. The summary is not rewritten: a notice offers to regenerate it.',
  };
}
