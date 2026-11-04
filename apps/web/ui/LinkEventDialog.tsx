import { useMemo, useState } from 'react';
import { nearestFirst, suggestEvent } from '../src/meetings/link-pick.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './Dialog.js';
import { EventPicker, useLinkableEvents, windowAround } from './EventPicker.js';

const DAY_HOURS = 36;

/**
 * Links a recording to a calendar meeting, which gives it the invitees, or moves one that is
 * linked already to another meeting or lets it go.
 */
export function LinkEventDialog(props: {
  meetingId: string;
  /** The recording is linked to a calendar meeting already. */
  linked?: boolean;
  /** When the recording was made, as an ISO time. */
  at: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { meetingId, linked = false, at, onClose, onLinked } = props;
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

  const unlink = () => {
    setBusy(true);
    api.unlinkEvent(meetingId).then(onLinked, (failure: unknown) => {
      setError(errorMessage(failure));
      setBusy(false);
    });
  };

  return (
    <Dialog
      title={linked ? 'Change calendar meeting' : 'Link to calendar meeting'}
      onClose={onClose}
    >
      <p className="muted">
        {linked
          ? 'The recording lets go of its calendar meeting and takes the title, date and invitees of the one you pick.'
          : 'The recording takes the title, date and invitees of the meeting, and the meeting no longer shows as skipped or upcoming.'}
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
        {linked && (
          <button type="button" disabled={busy} onClick={unlink}>
            Unlink
          </button>
        )}
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy || !value} onClick={link}>
          {linked ? 'Change' : 'Link'}
        </button>
      </div>
    </Dialog>
  );
}
