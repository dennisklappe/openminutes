import { useEffect, useMemo, useState, type SubmitEvent } from 'react';
import type { PeopleDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Dialog } from '../Dialog.js';
import { PlusIcon, SearchIcon } from '../icons.js';
import { filterPeople, parseEmails, profileLabels, profileLevel, validEmail } from '../people.js';
import '../people.css';

const NAME_MAX = 80;

function AddPerson({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [emails, setEmails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const parsed = parseEmails(emails);
  const badEmail = parsed.find((email) => !validEmail(email));

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy || name.trim() === '' || badEmail) return;
    setBusy(true);
    api.createPerson({ name: name.trim(), emails: parsed }).then(
      ({ person }) => {
        window.location.hash = `#/people/${person.id}`;
      },
      (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <Dialog title="Add a person" onClose={onClose}>
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
        </label>
        <label className="field">
          <span>Emails</span>
          <textarea
            rows={2}
            value={emails}
            autoComplete="off"
            onChange={(e) => {
              setEmails(e.target.value);
            }}
          />
          <small>None, one or several, separated by commas or new lines.</small>
        </label>
        {badEmail && (
          <p className="feedback error" role="alert">
            {badEmail} is not an email address.
          </p>
        )}
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || name.trim() === '' || badEmail !== undefined}
          >
            Add person
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function People() {
  const [data, setData] = useState<PeopleDto>();
  const [error, setError] = useState<string>();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.people().then(setData, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  }, []);

  const shown = useMemo(() => filterPeople(data?.people ?? [], q), [data, q]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>People</h1>
          <p className="lede">
            Everyone you meet, with their emails and, if you allow it, how they sound. Open a person
            to check which lines are theirs.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setAdding(true);
          }}
        >
          <PlusIcon />
          Add person
        </button>
      </header>
      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <input
            type="search"
            aria-label="Search people"
            placeholder="Search names, emails and notes"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
          />
        </label>
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {data && shown.length === 0 ? (
        <div className="panel empty-state">
          <h3>{q ? 'Nobody matches' : 'No people yet'}</h3>
          <p>
            {q
              ? 'Try another name or email.'
              : 'People appear when you name a speaker in a meeting, or add them here.'}
          </p>
        </div>
      ) : (
        data && (
          <div className="panel table-wrap">
            <table className="table people-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Emails</th>
                  <th>Voice</th>
                  <th className="num">To review</th>
                  <th className="num">Meetings</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <a className="row-link" href={`#/people/${person.id}`}>
                        {person.name}
                      </a>
                    </td>
                    <td className="muted">
                      {person.emails.length === 0 ? 'No email' : person.emails.join(', ')}
                    </td>
                    <td className="muted">
                      {data.learning || person.samples > 0 ? (
                        <span className={`profile-dot ${profileLevel(person)}`}>
                          {profileLabels[profileLevel(person)]}
                        </span>
                      ) : (
                        'Learning is off'
                      )}
                    </td>
                    <td className="num">{person.needsReview || ''}</td>
                    <td className="num">{person.meetings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
      {adding && (
        <AddPerson
          onClose={() => {
            setAdding(false);
          }}
        />
      )}
    </>
  );
}
