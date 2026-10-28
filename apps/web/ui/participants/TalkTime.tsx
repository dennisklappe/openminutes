import { useState } from 'react';
import type { SegmentDto } from '../../src/dto.js';
import { PencilIcon } from '../icons.js';
import { Panel } from '../Panel.js';
import { talkTime } from '../speakers.js';
import { SpeakerEditDialog } from './SpeakerEditDialog.js';
import { useRegenerate } from './useRegenerate.js';

interface Props {
  meetingId: string;
  segments: readonly SegmentDto[];
  hasSummary: boolean;
  /** Called after a speaker was edited, so the page and the People card load again. */
  onChanged: () => void;
}

/** Who talked how long, with an Edit action per speaker for the name and the bound emails. */
export function TalkTime({ meetingId, segments, hasSummary, onChanged }: Props) {
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const regenerate = useRegenerate(meetingId, onChanged, setError);
  return (
    <Panel title="Talk time">
      <ul className="talk">
        {talkTime(segments).map(
          ({ key, name, slot, unassigned, percent, share, participantId }) => (
            <li
              key={key}
              className={unassigned ? 'talk-unassigned' : undefined}
              data-speaker-slot={slot ?? undefined}
            >
              <span className="talk-name">
                <span className="truncate">{name}</span>
                {participantId && !unassigned && (
                  <button
                    type="button"
                    className="icon-button speaker-edit"
                    aria-label={`Edit ${name}`}
                    onClick={() => {
                      setEditing(participantId);
                    }}
                  >
                    <PencilIcon />
                  </button>
                )}
              </span>
              <span className="mono muted">{percent}%</span>
              <i style={{ width: `${share * 100}%` }} />
            </li>
          ),
        )}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <SpeakerEditDialog
          meetingId={meetingId}
          participantId={editing}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={(renamed) => {
            onChanged();
            if (renamed && hasSummary) void regenerate();
          }}
        />
      )}
    </Panel>
  );
}
