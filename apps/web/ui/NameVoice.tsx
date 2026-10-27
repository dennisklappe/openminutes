import { useEffect, useState, type SubmitEvent } from 'react';
import type { PersonDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { Dialog } from './Dialog.js';
import './people.css';

const NAME_MAX = 80;
const SEARCH_DELAY_MS = 250;

/**
 * Names a voice of a shared account from the People tab: type a new name, or pick a person who
 * already exists, which takes over this voice, its lines and its meetings.
 */
export function NameVoiceDialog({
  person,
  onClose,
  onNamed,
}: {
  person: Pick<PersonDto, 'id' | 'name' | 'sharedAccount'>;
  onClose: () => void;
  /** The id of the person that is left: the same one when renamed, the picked one when merged. */
  onNamed: (personId: string) => void;
}) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<PersonDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const needle = query.trim();
    if (needle === '') {
      setFound([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api.people({ q: needle, source: 'all', tracking: 'all', pageSize: 8 }).then(
        (result) => {
          if (current) setFound(result.people.filter((other) => other.id !== person.id));
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
  }, [query, person.id]);

  const run = (body: { name: string } | { personId: string }) => {
    setBusy(true);
    setError(undefined);
    api.nameVoicePerson(person.id, body).then(
      (done) => {
        onNamed(done.personId);
        onClose();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
      },
    );
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!busy && trimmed !== '') run({ name: trimmed });
  };

  return (
    <Dialog title={`Name ${person.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            maxLength={NAME_MAX}
            autoFocus
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
          <small>
            {person.sharedAccount ? `Heard in ${person.sharedAccount}. ` : ''}A new name keeps this
            person and their meetings.
          </small>
        </label>
        <div className="dialog-actions">
          <button type="submit" className="primary" disabled={busy || name.trim() === ''}>
            Use this name
          </button>
        </div>
      </form>
      <label className="field">
        <span>Or pick someone who is already in People</span>
        <input
          type="search"
          value={query}
          autoComplete="off"
          placeholder="Search names and emails"
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
      </label>
      {found.length > 0 && (
        <ul className="review-options">
          {found.map((other) => (
            <li key={other.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  run({ personId: other.id });
                }}
              >
                {other.name}
              </button>
            </li>
          ))}
        </ul>
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
      </div>
    </Dialog>
  );
}
