import { useEffect, useState, type SubmitEvent } from 'react';
import type { InviteeDto, ParticipantDto, PersonDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Dialog } from '../Dialog.js';
import { linkTargets } from '../sharedRoom.js';
import { inviteeLabel } from './names.js';

interface Props {
  meetingId: string;
  invitee: InviteeDto;
  people: ParticipantDto[];
  onClose: () => void;
  onSaved: () => void;
}

const OTHER = 'other';
const SEARCH_DELAY_MS = 250;

/**
 * "They were there": which participant is this invitee. The people of a shared tile are offered
 * under the tile's name (the tile is not a person), and anyone from People can be picked too.
 */
export function LinkDialog({ meetingId, invitee, people, onClose, onSaved }: Props) {
  const targets = linkTargets(people);
  const first = targets.groups[0]?.targets[0] ?? targets.singles[0];
  const [choice, setChoice] = useState(first?.participantId ?? OTHER);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<PersonDto[]>([]);
  const [picked, setPicked] = useState<PersonDto>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const other = choice === OTHER;

  useEffect(() => {
    const needle = query.trim();
    if (!other || needle === '') {
      setFound([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api.people({ q: needle, source: 'all', tracking: 'all', pageSize: 8 }).then(
        (result) => {
          if (current) setFound(result.people.filter((entry) => !entry.unnamed));
        },
        () => {
          if (current) setFound([]);
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, other]);

  const ready = other ? picked !== undefined : choice !== '';
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    const run =
      other && picked
        ? api.linkInviteeToPerson(meetingId, picked.id, invitee.email)
        : api.linkInvitee(meetingId, choice, invitee.email);
    run.then(
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
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
            }}
          >
            {targets.groups.map((group) => (
              <optgroup key={group.tile} label={`In ${group.tile}`}>
                {group.targets.map((target) => (
                  <option key={target.participantId} value={target.participantId}>
                    {target.label}
                  </option>
                ))}
              </optgroup>
            ))}
            {targets.singles.length > 0 && (
              <optgroup label={targets.groups.length > 0 ? 'Other participants' : 'Participants'}>
                {targets.singles.map((target) => (
                  <option key={target.participantId} value={target.participantId}>
                    {target.label}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={OTHER}>Someone else...</option>
          </select>
        </label>
        {other && (
          <>
            <label className="field">
              <span>Search people</span>
              <input
                type="search"
                value={query}
                autoComplete="off"
                placeholder="Name"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPicked(undefined);
                }}
              />
            </label>
            {found.length > 0 && (
              <ul className="review-options scroll" aria-label="People">
                {found.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-pressed={picked?.id === entry.id}
                      onClick={() => {
                        setPicked(entry);
                      }}
                    >
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {picked && (
              <p className="muted">
                {inviteeLabel(invitee)} will be <strong>{picked.name}</strong> in this meeting.
              </p>
            )}
          </>
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
          <button type="submit" className="primary" disabled={busy || !ready}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}
