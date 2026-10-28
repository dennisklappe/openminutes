import { useEffect, useState, type SubmitEvent } from 'react';
import type { SpeakerIdentityDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { Dialog } from '../Dialog.js';
import {
  addTypedEmail,
  identityToSave,
  inviteeSuggestions,
  matchNote,
  peopleHref,
  withoutEmail,
} from './identity.js';
import { inviteeLabel, NAME_MAX } from './names.js';

interface Props {
  meetingId: string;
  participantId: string;
  onClose: () => void;
  /** Called once saved, with whether the name changed. */
  onSaved: (renamed: boolean) => void;
}

const MATCH_DELAY_MS = 300;

/** Name and email addresses of one speaker, saved in one request. */
export function SpeakerEditDialog({ meetingId, participantId, onClose, onSaved }: Props) {
  const confirm = useConfirm();
  const [identity, setIdentity] = useState<SpeakerIdentityDto>();
  const [name, setName] = useState('');
  const [emails, setEmails] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [match, setMatch] = useState<SpeakerIdentityDto['match']>(null);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.speakerIdentity(meetingId, participantId).then(
      (data) => {
        setIdentity(data);
        setName(data.name);
        setEmails(data.emails);
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  }, [meetingId, participantId]);

  useEffect(() => {
    if (!identity || identity.nameLocked || name.trim() === identity.name) {
      setMatch(null);
      return;
    }
    const timer = setTimeout(() => {
      api.speakerIdentity(meetingId, participantId, name.trim()).then(
        (data) => {
          setMatch(data.match);
        },
        () => {
          setMatch(null);
        },
      );
    }, MATCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [identity, name, meetingId, participantId]);

  const add = (email: string) => {
    const next = addTypedEmail(emails, email);
    setError(next.error);
    if (next.error) return;
    setEmails(next.emails);
    setTyped('');
  };

  const remove = async (email: string) => {
    const confirmed = await confirm({
      title: 'Remove this email?',
      body: (
        <p>
          {email} is taken off {name.trim() || identity?.name}. It is saved when you press Save.
        </p>
      ),
      confirmLabel: 'Remove email',
      destructive: true,
    });
    if (confirmed) setEmails((current) => withoutEmail(current, email));
  };

  const change = identity && identityToSave(name, emails, identity);
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!identity || busy) return;
    // An address typed but not added yet counts: it is what the person meant.
    const pending = addTypedEmail(emails, typed);
    if (pending.error) {
      setError(pending.error);
      return;
    }
    const draft = identityToSave(name, pending.emails, identity);
    if (!draft) return;
    setBusy(true);
    api
      .saveSpeakerIdentity(meetingId, participantId, {
        ...draft,
        remember: !identity.nameLocked && remember,
      })
      .then(
        () => {
          onSaved(draft.name !== identity.name);
          onClose();
        },
        (failure: unknown) => {
          setBusy(false);
          setError(errorMessage(failure));
        },
      );
  };

  const suggestions = identity ? inviteeSuggestions(identity.invitees, emails) : [];
  const href = peopleHref(identity?.personId ?? null);
  const note = matchNote(match);
  return (
    <Dialog title="Edit speaker" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            maxLength={NAME_MAX}
            autoFocus
            autoComplete="off"
            enterKeyHint="done"
            disabled={!identity || identity.nameLocked}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          {identity?.originalName && (
            <small>In the meeting this was {identity.originalName}.</small>
          )}
          {identity?.nameLocked && (
            <small>This voice of a shared account is named from the People card.</small>
          )}
          {note && <small role="status">{note}</small>}
        </label>
        <fieldset className="field speaker-emails">
          <legend>Emails</legend>
          {emails.length === 0 ? (
            <p className="muted">No email bound yet.</p>
          ) : (
            <ul>
              {emails.map((email) => (
                <li key={email}>
                  <span className="truncate">{email}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    onClick={() => {
                      void remove(email);
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {suggestions.length > 0 && (
            <div className="speaker-suggest">
              {suggestions.map((invitee) => (
                <button
                  key={invitee.email}
                  type="button"
                  disabled={!!invitee.takenBy}
                  onClick={() => {
                    add(invitee.email);
                  }}
                >
                  {inviteeLabel(invitee)}
                  <span className="muted">
                    {invitee.takenBy ? ` taken by ${invitee.takenBy}` : ' Invited'}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="speaker-add">
            <input
              type="email"
              value={typed}
              maxLength={254}
              autoComplete="off"
              aria-label="Add email"
              placeholder="name@example.com"
              onChange={(e) => {
                setTyped(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed.trim() !== '') {
                  e.preventDefault();
                  add(typed);
                }
              }}
            />
            <button
              type="button"
              disabled={typed.trim() === ''}
              onClick={() => {
                add(typed);
              }}
            >
              Add
            </button>
          </div>
        </fieldset>
        {identity && !identity.nameLocked && (
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
        )}
        {href && (
          <p>
            <a href={href}>Open on People</a>
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={busy || !identity || (change === undefined && typed.trim() === '')}
          >
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
