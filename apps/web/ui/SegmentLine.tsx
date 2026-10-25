import { useCallback, useId, useRef, useState, type Ref } from 'react';
import type {
  SegmentDto,
  SpeakerChoiceDto,
  SpeakerEditInput,
  SpeakerTargetInput,
} from '../src/dto.js';
import { formatDuration } from './format.js';
import { neighbours, scopeChoices, scopeIds, splitWords, type Scope } from './speakerEdits.js';
import { SpeakerLabel } from './SpeakerLabel.js';
import { SpeakerMenu, type LineAction } from './SpeakerMenu.js';
import { SplitLine } from './SplitLine.js';

interface Props {
  segment: SegmentDto;
  segments: SegmentDto[];
  choices: SpeakerChoiceDto[];
  slot: number | undefined;
  active: boolean;
  reviewing: boolean;
  rowRef: Ref<HTMLLIElement> | undefined;
  onSeek: (ms: number) => void;
  onEdit: (input: SpeakerEditInput) => void;
}

export function SegmentLine(props: Props) {
  const { segment, segments, choices, slot, active, reviewing, rowRef, onSeek, onEdit } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const label = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    label.current?.focus();
  }, []);

  const finish = (input: SpeakerEditInput) => {
    setMenuOpen(false);
    setSplitting(false);
    label.current?.focus();
    onEdit(input);
  };

  const { previous, next } = neighbours(segments, segment.id);
  const revertable = segment.speakerSource === 'ai' || segment.speakerSource === 'guess';
  const actions: LineAction[] = [
    ...(revertable
      ? [
          {
            label: segment.previousSpeaker
              ? `Back to ${segment.previousSpeaker}`
              : 'Undo this change',
            run: () => {
              finish({ kind: 'revert', segmentIds: [segment.id] });
            },
          },
        ]
      : []),
    ...(splitWords(segment.text).length > 1
      ? [
          {
            label: 'Split line...',
            run: () => {
              setMenuOpen(false);
              setSplitting(true);
            },
          },
        ]
      : []),
    ...(previous
      ? [
          {
            label: 'Merge with previous line',
            run: () => {
              finish({ kind: 'merge', segmentIds: [previous.id, segment.id] });
            },
          },
        ]
      : []),
    ...(next
      ? [
          {
            label: 'Merge with next line',
            run: () => {
              finish({ kind: 'merge', segmentIds: [segment.id, next.id] });
            },
          },
        ]
      : []),
  ];

  const pick = (target: SpeakerTargetInput, scope: Scope) => {
    finish({ kind: 'assign', segmentIds: scopeIds(segments, segment.id, scope), speaker: target });
  };

  const classes = [active && 'active', reviewing && 'reviewing'].filter(Boolean).join(' ');
  return (
    <li
      ref={rowRef}
      className={classes || undefined}
      data-segment-id={segment.id}
      data-speaker-slot={slot}
    >
      <button
        type="button"
        className="seek-time mono muted"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => {
          onSeek(segment.startMs);
        }}
      >
        {formatDuration(segment.startMs)}
      </button>
      <div className="line-body">
        <div className="label-row">
          {choices.length > 0 && (
            <SpeakerLabel
              segment={segment}
              open={menuOpen}
              menuId={menuId}
              buttonRef={label}
              onToggle={() => {
                setMenuOpen(!menuOpen);
              }}
            />
          )}
          {menuOpen && (
            <SpeakerMenu
              id={menuId}
              choices={choices}
              currentId={segment.speakerId}
              scopes={scopeChoices(segments, segment.id)}
              actions={actions}
              onPick={pick}
              onClose={closeMenu}
            />
          )}
        </div>
        {splitting ? (
          <SplitLine
            text={segment.text}
            choices={choices}
            currentId={segment.speakerId}
            onSplit={(wordIndex, speaker) => {
              finish({ kind: 'split', segmentId: segment.id, wordIndex, speaker });
            }}
            onCancel={() => {
              setSplitting(false);
              label.current?.focus();
            }}
          />
        ) : (
          <button
            type="button"
            className="seek-text"
            onClick={() => {
              onSeek(segment.startMs);
            }}
          >
            {segment.text}
          </button>
        )}
      </div>
    </li>
  );
}
