import { useState, type SubmitEvent } from 'react';
import type { InviteeDto, ParticipantDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Dialog } from '../Dialog.js';
import { inviteeLabel } from './names.js';

interface Props {
  meetingId: string;
  invitee: InviteeDto;
  people: ParticipantDto[];
  onClose: () => void;
  onSaved: () => void;
}

export function LinkDialog({ meetingId, invitee, people, onClose, onSaved }: Props) {
  const [participantId, setParticipantId] = useState(people[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (participantId === '' || busy) return;
    setBusy(true);
    api.linkInvitee(meetingId, participantId, invitee.email).then(
      () => {
        onSaved();
        onClose();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <Dialog title="They were there" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">
          Which participant is <strong>{inviteeLabel(invitee)}</strong>?
        </p>
        <label className="field">
          <span>Participant</span>
          <select
            value={participantId}
            onChange={(e) => {
              setParticipantId(e.target.value);
            }}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.originalName ? `${person.name} (${person.originalName})` : person.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || participantId === ''}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
