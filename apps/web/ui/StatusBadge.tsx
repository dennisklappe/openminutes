import type { MeetingStatus, ProgressDto } from '../src/dto.js';
import { progressLabel, statusLabels } from './format.js';

export function StatusBadge({
  status,
  progress,
}: {
  status: MeetingStatus;
  progress?: ProgressDto | null;
}) {
  return (
    <span className={`pill pill-${status}`}>
      <i aria-hidden="true" />
      {status === 'processing' && progress !== undefined
        ? progressLabel(progress)
        : statusLabels[status]}
    </span>
  );
}
