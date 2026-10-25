import type { Ref } from 'react';
import type { SegmentDto } from '../src/dto.js';
import { uncertaintyLabel } from './speakerEdits.js';

interface Props {
  segment: SegmentDto;
  open: boolean;
  menuId: string;
  onToggle: () => void;
  buttonRef: Ref<HTMLButtonElement>;
}

function sourceBadge(segment: SegmentDto) {
  const was = segment.previousSpeaker ?? 'the original speaker';
  switch (segment.speakerSource) {
    case 'ai':
      return {
        text: 'AI',
        title: `Speaker chosen by AI from the conversation, originally ${was}`,
      };
    case 'guess':
      return { text: 'Guess', title: 'Best guess, no clear sign who spoke' };
    case 'user':
      return { text: 'edited', title: 'Speaker set by you' };
    default:
      return undefined;
  }
}

export function SpeakerLabel({ segment, open, menuId, onToggle, buttonRef }: Props) {
  const badge = sourceBadge(segment);
  return (
    <span className="speaker-label">
      <button
        ref={buttonRef}
        type="button"
        className="speaker-name"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-uncertain={segment.uncertain || undefined}
        onClick={onToggle}
      >
        {segment.uncertain && (
          <span
            className="uncertain-dot"
            role="img"
            aria-label={uncertaintyLabel(segment)}
            title={uncertaintyLabel(segment)}
          />
        )}
        <span className="speaker-text">{segment.speaker ?? 'No speaker'}</span>
      </button>
      {badge && (
        <span
          className={`source-badge ${segment.speakerSource ?? ''}`}
          title={badge.title}
          aria-label={badge.title}
        >
          {badge.text}
        </span>
      )}
    </span>
  );
}
