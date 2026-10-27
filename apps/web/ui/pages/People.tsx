import { useEffect, useState, type SubmitEvent } from 'react';
import type { PeopleDto, PeopleFilter, PeopleSort } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Dialog } from '../Dialog.js';
import { PlusIcon, SearchIcon } from '../icons.js';
import { parseEmails, profileLabels, profileLevel, validEmail } from '../people.js';
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

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 250;
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function SortHeader({
  label,
  field,
  sort,
  dir,
  num,
  onSort,
}: {
  label: string;
  field: PeopleSort;
  sort: PeopleSort;
  dir: 'asc' | 'desc';
  num?: boolean;
  onSort: (field: PeopleSort) => void;
}) {
  const active = sort === field;
  return (
    <th
      className={num ? 'num' : undefined}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        className="link-button"
        onClick={() => {
          onSort(field);
        }}
      >
        {label}
        {active ? (dir === 'asc' ? ' \u2191' : ' \u2193') : ''}
      </button>
    </th>
  );
}

export function People() {
  const [data, setData] = useState<PeopleDto>();
  const [error, setError] = useState<string>();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<PeopleSort>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [source, setSource] = useState<PeopleFilter>('all');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(q);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [q]);

  useEffect(() => {
    let current = true;
    api.people({ q: search, sort, dir, source, page, pageSize: PAGE_SIZE }).then(
      (result) => {
        if (current) setData(result);
      },
      (failure: unknown) => {
        if (current) setError(errorMessage(failure));
      },
    );
    return () => {
      current = false;
    };
  }, [search, sort, dir, source, page, reload]);

  const changeSort = (field: PeopleSort) => {
    if (field === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(field);
      setDir(field === 'name' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const scan = () => {
    setScanning(true);
    api.scanPeople().then(
      () => {
        setScanning(false);
        setReload((n) => n + 1);
      },
      (failure: unknown) => {
        setScanning(false);
        setError(errorMessage(failure));
      },
    );
  };

  const shown = data?.people ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const from = data && data.total > 0 ? (data.page - 1) * data.pageSize + 1 : 0;

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
        <div className="head-actions">
          {data && data.needsReview > 0 && (
            <a className="button" href="#/people/review">
              Review {data.needsReview} {data.needsReview === 1 ? 'line' : 'lines'}
            </a>
          )}
          <button disabled={scanning} onClick={scan}>
            {scanning ? 'Scanning' : 'Scan meetings'}
          </button>
          <button
            className="primary"
            onClick={() => {
              setAdding(true);
            }}
          >
            <PlusIcon />
            Add person
          </button>
        </div>
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
        <select
          aria-label="Show"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as PeopleFilter);
            setPage(1);
          }}
        >
          <option value="all">Everyone</option>
          <option value="joined">Was in a meeting</option>
          <option value="invited">Only invited</option>
        </select>
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {data && shown.length === 0 ? (
        <div className="panel empty-state">
          <h3>{search || source !== 'all' ? 'Nobody matches' : 'No people yet'}</h3>
          <p>
            {search || source !== 'all'
              ? 'Try another name or email.'
              : 'People appear after a meeting, when you name a speaker, or when you add them here.'}
          </p>
        </div>
      ) : (
        data && (
          <div className="panel table-wrap">
            <table className="table people-table">
              <thead>
                <tr>
                  <SortHeader label="Name" field="name" sort={sort} dir={dir} onSort={changeSort} />
                  <th>Emails</th>
                  <th>Voice</th>
                  <th className="num">To review</th>
                  <SortHeader
                    label="Meetings"
                    field="meetings"
                    sort={sort}
                    dir={dir}
                    num
                    onSort={changeSort}
                  />
                  <SortHeader
                    label="Last seen"
                    field="lastSeen"
                    sort={sort}
                    dir={dir}
                    num
                    onSort={changeSort}
                  />
                </tr>
              </thead>
              <tbody>
                {shown.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <a className="row-link" href={`#/people/${person.id}`}>
                        {person.name}
                      </a>
                      {person.source === 'invited' && <span className="muted"> Invited</span>}
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
                    <td className="num muted">
                      {person.lastSeenAt ? dateFormat.format(new Date(person.lastSeenAt)) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="toolbar">
              <span className="muted">
                {from} to {from + shown.length - 1} of {data.total}
              </span>
              <button
                disabled={data.page <= 1}
                onClick={() => {
                  setPage(data.page - 1);
                }}
              >
                Previous
              </button>
              <button
                disabled={data.page >= pages}
                onClick={() => {
                  setPage(data.page + 1);
                }}
              >
                Next
              </button>
            </div>
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
