import { meetingUrl } from '../api.js';
import type { MenuItem } from '../Menu.js';

/** Downloads that are not the minutes: the transcript on its own and the audio. */
export function downloadItems(input: {
  id: string;
  hasTranscript: boolean;
  hasAudio: boolean;
}): MenuItem[] {
  const { id, hasTranscript, hasAudio } = input;
  return [
    ...(hasTranscript
      ? [
          {
            label: 'Transcript only (Markdown)',
            href: meetingUrl(id, 'transcript.md'),
            download: true,
          },
          {
            label: 'Transcript only (JSON)',
            href: meetingUrl(id, 'transcript.json'),
            download: true,
          },
        ]
      : []),
    ...(hasAudio
      ? [{ label: 'Audio', href: `${meetingUrl(id, 'audio')}?download`, download: true }]
      : []),
  ];
}

export function moreItems(input: {
  canDelete: boolean;
  archived: boolean;
  hasTranscript: boolean;
  toggleArchive: () => void;
  remove: () => void;
  /** Where the speaker review of this meeting lives, when there is a transcript. */
  reviewHref?: string | undefined;
}): MenuItem[] {
  const { canDelete, archived, hasTranscript, toggleArchive, remove } = input;
  return [
    ...(input.reviewHref && hasTranscript
      ? [{ label: 'Review speakers', href: input.reviewHref }]
      : []),
    ...(canDelete
      ? [
          { label: archived ? 'Unarchive' : 'Archive', onSelect: toggleArchive },
          { label: 'Delete meeting', danger: true, onSelect: remove },
        ]
      : []),
  ];
}
