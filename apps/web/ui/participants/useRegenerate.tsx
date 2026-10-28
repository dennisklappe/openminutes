import { useCallback } from 'react';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';

/** Asks whether to write the summary again after a rename replaced names in it. */
export function useRegenerate(
  meetingId: string,
  onChanged: () => void,
  onError: (message: string) => void,
) {
  const confirm = useConfirm();
  return useCallback(async () => {
    const confirmed = await confirm({
      title: 'Regenerate the summary?',
      body: (
        <p>
          Names in the current summary were replaced. Regenerating writes a new version from the
          transcript, using the new names. Earlier versions are kept.
        </p>
      ),
      confirmLabel: 'Regenerate summary',
    });
    if (!confirmed) return;
    api.summarize(meetingId, {}).then(onChanged, (failure: unknown) => {
      onError(errorMessage(failure));
    });
  }, [confirm, meetingId, onChanged, onError]);
}
