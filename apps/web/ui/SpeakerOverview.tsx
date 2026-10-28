import type { ProgressDto } from '../src/dto.js';
import { progressLabel } from './format.js';

export function SpeakerHeader({
  label,
  checking,
  onChange,
}: {
  label: string;
  checking: boolean;
  onChange?: (() => void) | undefined;
}) {
  return (
    <div className="speaker-count">
      <strong>{label}</strong>
      {onChange && (
        <button type="button" onClick={onChange}>
          Change
        </button>
      )}
      {checking && <span className="muted">Checking voices...</span>}
    </div>
  );
}

export function SpeakersRunning({ progress }: { progress: ProgressDto | null }) {
  return (
    <div className="speaker-count speaker-running" role="status">
      <strong>
        <i className="speaker-spinner" aria-hidden="true" />
        {progressLabel(progress)}
      </strong>
      <span className="muted">
        The speakers are being worked out again. The new list appears here when this is done.
      </span>
    </div>
  );
}

export function SpeakerResult({ line, onDismiss }: { line: string; onDismiss: () => void }) {
  return (
    <p className="banner" role="status">
      <span>{line}</span>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </p>
  );
}
