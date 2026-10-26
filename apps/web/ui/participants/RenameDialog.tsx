import { useState, type SubmitEvent } from 'react';
import type { InviteeDto, ParticipantDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Dialog } from '../Dialog.js';
import { inviteeLabel, likelyInvitee, NAME_MAX, renameToSave, validEmail } from './names.js';

interface Props {
  meetingId: string;
  person: ParticipantDto;
  /** Invitees this person could be: the unmatched ones and the one already linked. */
  invitees: InviteeDto[];
  onClose: () => void;
  onSaved: (renamed: boolean) => void;
}

export function RenameDialog({ meetingId, person, invitees, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState(person.name);
  const [chosen, setChosen] = useState<string[]>();
  const [email, setEmail] = useState(person.email ?? '');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const original = person.originalName ?? person.name;
  const guess = likelyInvitee([draft, person.originalName], invitees);
  const links =
    chosen ??
    (person.inviteeEmails.length > 0 ? person.inviteeEmails : guess === '' ? [] : [guess]);
  const change = renameToSave(draft, person, links, email);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (change === undefined || busy) return;
    setBusy(true);
    api.renameParticipant(meetingId, person.id, { ...change, remember }).then(
      () => {
        onSaved(true);
        onClose();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <Dialog title="Rename participant" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">
          Shown in the transcript, the summary and the minutes. In the meeting this person was{' '}
          <strong>{original}</strong>.
        </p>
        <label className="field">
          <span>Name</span>
          <input
            value={draft}
            maxLength={NAME_MAX}
            autoFocus
            autoComplete="off"
            enterKeyHint="done"
            onFocus={(e) => {
              e.currentTarget.select();
            }}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
          />
        </label>
        {invitees.length > 0 && (
          <fieldset className="field people-invitees">
            <legend>Which invitees is this? (one person can have several emails)</legend>
            {invitees.map((invitee) => (
              <label key={invitee.email} className="check">
                <input
                  type="checkbox"
                  checked={links.includes(invitee.email)}
                  onChange={(e) => {
                    setChosen(
                      e.target.checked
                        ? [...links, invitee.email]
                        : links.filter((entry) => entry !== invitee.email),
                    );
                  }}
                />
                <span>{inviteeLabel(invitee)}</span>
              </label>
            ))}
          </fieldset>
        )}
        {links.length === 0 && (
          <label className="field">
            <span>
              {invitees.length > 0 ? 'Not on the invitation, email (optional)' : 'Email (optional)'}
            </span>
            <input
              type="email"
              value={email}
              maxLength={254}
              autoComplete="off"
              placeholder="name@example.com"
              aria-invalid={!validEmail(email.trim())}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </label>
        )}
        <label className="check people-remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked);
            }}
          />
          <span>Remember for next time</span>
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
          <button type="submit" className="primary" disabled={busy || change === undefined}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
