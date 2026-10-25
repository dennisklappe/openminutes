import { useState } from 'react';
import type { SpeakerCheckDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';

interface Props {
  meetingId: string;
  check: SpeakerCheckDto;
  uncertain: number;
  hasSegments: boolean;
  onlyUncertain: boolean;
  onToggleOnly: (value: boolean) => void;
  onStep: (direction: 1 | -1) => void;
  onStarted: () => void;
}

export function SpeakerReviewBar(props: Props) {
  const { meetingId, check, uncertain, hasSegments, onlyUncertain, onToggleOnly } = props;
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string>();
  const checking = starting || check.running;

  const recheck = () => {
    setStarting(true);
    setFailure(undefined);
    api
      .speakerCheck(meetingId)
      .then(props.onStarted, (error: unknown) => {
        setFailure(errorMessage(error));
      })
      .finally(() => {
        setStarting(false);
      });
  };

  const error = failure ?? check.error;
  return (
    <div className="review-bar" role="region" aria-label="Review speakers">
      <p className="review-count" aria-live="polite">
        {uncertain === 0
          ? 'No uncertain lines'
          : `${String(uncertain)} uncertain ${uncertain === 1 ? 'line' : 'lines'}`}
      </p>
      <div className="review-steps">
        <button
          type="button"
          disabled={uncertain === 0}
          onClick={() => {
            props.onStep(-1);
          }}
        >
          Previous <kbd aria-hidden="true">[</kbd>
        </button>
        <button
          type="button"
          disabled={uncertain === 0}
          onClick={() => {
            props.onStep(1);
          }}
        >
          Next <kbd aria-hidden="true">]</kbd>
        </button>
      </div>
      <label className="review-only">
        <input
          type="checkbox"
          checked={onlyUncertain}
          disabled={uncertain === 0 && !onlyUncertain}
          onChange={(event) => {
            onToggleOnly(event.target.checked);
          }}
        />
        Only uncertain lines
      </label>
      <button
        type="button"
        className="review-check"
        disabled={!hasSegments || checking}
        onClick={recheck}
      >
        {checking ? 'Checking...' : check.ai ? 'Re-check with AI' : 'Re-check speakers'}
      </button>
      {error && (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
