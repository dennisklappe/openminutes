import { meetingUrl, type ReprocessOptions } from '../api.js';
import type { MenuItem } from '../Menu.js';
import { MAX_SPEAKERS, MIN_SPEAKERS } from '../../src/speakerCount.js';

const speakerCounts = Array.from(
  { length: MAX_SPEAKERS - MIN_SPEAKERS + 1 },
  (_, index) => MIN_SPEAKERS + index,
);

const speakersLabel = (count: number) =>
  count === MAX_SPEAKERS ? `${String(count)} or more speakers` : `${String(count)} speakers`;

export function speakerItems(
  current: number | null,
  reprocess: (options: ReprocessOptions) => void,
): MenuItem[] {
  return [
    ...speakerCounts
      .filter((count) => count !== current)
      .map((count) => ({
        label: `Re-process with ${speakersLabel(count)}`,
        onSelect: () => {
          reprocess({ speakers: count });
        },
      })),
    ...(current === null
      ? []
      : [
          {
            label: 'Re-process with automatic speaker count',
            onSelect: () => {
              reprocess({ speakers: null });
            },
          },
        ]),
  ];
}

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
  canTranscribe: boolean;
  canDelete: boolean;
  archived: boolean;
  hasTranscript: boolean;
  speakerCount: number | null;
  isRecording: boolean;
  reprocess: (options?: ReprocessOptions) => void;
  chooseLanguage: () => void;
  toggleArchive: () => void;
  remove: () => void;
  /** Where the speaker review of this meeting lives, when there is a transcript. */
  reviewHref?: string | undefined;
}): MenuItem[] {
  const { canTranscribe, canDelete, archived, hasTranscript } = input;
  const { speakerCount, isRecording, reprocess, chooseLanguage, toggleArchive, remove } = input;
  return [
    ...(input.reviewHref && hasTranscript
      ? [{ label: 'Review speakers', href: input.reviewHref }]
      : []),
    ...(canTranscribe
      ? [
          {
            label: hasTranscript ? 'Re-process' : 'Transcribe',
            onSelect: () => {
              reprocess();
            },
          },
          {
            label: 'Re-run in another language...',
            onSelect: chooseLanguage,
          },
          ...(isRecording ? speakerItems(speakerCount, reprocess) : []),
        ]
      : []),
    ...(canDelete
      ? [
          { label: archived ? 'Unarchive' : 'Archive', onSelect: toggleArchive },
          { label: 'Delete meeting', danger: true, onSelect: remove },
        ]
      : []),
  ];
}
