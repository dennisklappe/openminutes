import { useMemo, useState } from 'react';
import { nearestFirst, suggestEvent } from '../src/meetings/link-pick.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './Dialog.js';
import { EventPicker, useLinkableEvents, windowAround } from './EventPicker.js';

const DAY_HOURS = 36;

/** Links a recording that has no calendar meeting to one, which gives it the invitees. */
export function LinkEventDialog(props: {
  meetingId: string;
  /** When the recording was made, as an ISO time. */
  at: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { meetingId, at, onClose, onLinked } = props;
  const time = useMemo(() => new Date(at), [at]);
  const range = useMemo(() => windowAround(time, DAY_HOURS, DAY_HOURS), [time]);
  const found = useLinkableEvents(range.from, range.to);
  const events = useMemo(() => nearestFirst(found, time), [found, time]);
  const [picked, setPicked] = useState<string | null | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Until the user chooses, the meeting closest to the recording is offered.
  const value = picked === undefined ? suggestEvent(events, time)?.id : (picked ?? undefined);

  const link = () => {
    if (!value) return;
    setBusy(true);
    api.linkEvent(meetingId, value).then(onLinked, (failure: unknown) => {
      setError(errorMessage(failure));
      setBusy(false);
    });
  };

  return (
    <Dialog title="Link to calendar meeting" onClose={onClose}>
      <p className="muted">
        The recording takes the title, date and invitees of the meeting, and the meeting no longer
        shows as skipped or upcoming.
      </p>
      {events.length === 0 ? (
        <p>No calendar meetings found around the time of this recording.</p>
      ) : (
        <EventPicker
          events={events}
          value={value}
          disabled={busy}
          label="Calendar meeting"
          onChange={(id) => {
            setPicked(id ?? null);
          }}
        />
      )}
      {error && <p className="banner banner-error">{error}</p>}
      <div className="confirm-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy || !value} onClick={link}>
          Link
        </button>
      </div>
    </Dialog>
  );
}
