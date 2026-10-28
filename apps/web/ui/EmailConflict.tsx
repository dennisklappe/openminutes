import type { EmailConflictDto } from '../src/dto.js';
import { useConfirm } from './Confirm.js';
import { conflictEffect, conflictMergeLabel, conflictMessage } from './people.js';
import './people.css';

/**
 * Shown under a form when an address belongs to another person: merge them into the person being
 * saved, which then retries the save, or keep both and carry on.
 */
export function EmailConflict({
  conflict,
  busy,
  onMerge,
  onKeep,
}: {
  conflict: EmailConflictDto;
  busy: boolean;
  onMerge: () => void;
  onKeep: () => void;
}) {
  const confirm = useConfirm();
  const merge = async () => {
    const confirmed = await confirm({
      title: conflictMergeLabel(conflict),
      body: <p>{conflictEffect(conflict)}</p>,
      confirmLabel: 'Merge and save',
      destructive: true,
    });
    if (confirmed) onMerge();
  };
  return (
    <div className="email-conflict" role="alert">
      <p>{conflictMessage(conflict)}</p>
      <div className="email-conflict-actions">
        {conflict.into && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              void merge();
            }}
          >
            {conflictMergeLabel(conflict)}
          </button>
        )}
        <button type="button" disabled={busy} onClick={onKeep}>
          Keep separate
        </button>
      </div>
    </div>
  );
}
