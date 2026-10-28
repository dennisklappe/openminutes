import { useEffect, useState, type SubmitEvent } from 'react';
import type {
  PeopleDto,
  PeopleFilter,
  PeopleSort,
  PersonDto,
  TrackingFilter,
} from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { Dialog } from '../Dialog.js';
import { MoreIcon, PlusIcon, SearchIcon } from '../icons.js';
import { Menu } from '../Menu.js';
import { MergeDialog } from '../MergePeople.js';
import { NameVoiceDialog } from '../NameVoice.js';
import {
  coverageText,
  parseEmails,
  profileLabels,
  reviewLabel,
  profileLevel,
  trackingLabels,
  validEmail,
} from '../people.js';
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
  const confirm = useConfirm();
  const [data, setData] = useState<PeopleDto>();
  const [error, setError] = useState<string>();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<PeopleSort>('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [source, setSource] = useState<PeopleFilter>('joined');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [reload, setReload] = useState(0);
  const [tracking, setTracking] = useState<TrackingFilter>('tracked');
  const [selected, setSelected] = useState<Map<string, PersonDto>>(new Map());
  const [merging, setMerging] = useState<[PersonDto | string, PersonDto | string]>();
  const [naming, setNaming] = useState<PersonDto>();

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
    api.people({ q: search, sort, dir, source, tracking, page, pageSize: PAGE_SIZE }).then(
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
  }, [search, sort, dir, source, tracking, page, reload]);

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

  const toggle = (person: PersonDto) => {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(person.id)) next.delete(person.id);
      else next.set(person.id, person);
      return next;
    });
  };

  const changeTracking = async (person: PersonDto) => {
    if (person.tracking === 'off') {
      await api.setTracking(person.id, 'on');
    } else {
      const confirmed = await confirm({
        title: `Stop tracking ${person.name}?`,
        body: (
          <p>
            Their saved voice samples and voice profile are deleted, and no voice is learned or
            suggested for them again. Their lines are no longer offered for review. {person.name}{' '}
            stays by name in every transcript and in the minutes.
          </p>
        ),
        confirmLabel: 'Stop tracking',
        destructive: true,
      });
      if (!confirmed) return;
      await api.setTracking(person.id, 'off');
    }
    setReload((n) => n + 1);
  };

  const shown = data?.people ?? [];
  const pair = selected.size === 2 ? [...selected.values()] : undefined;
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
          {data && data.reviewable > 0 && (
            <a className="button" href="#/people/review">
              Review {reviewLabel(data.needsReview)}
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
          <option value="invited">Invited only</option>
          <option value="unnamed">Unnamed voices</option>
        </select>
        <button
          type="button"
          aria-pressed={source === 'invited'}
          className={source === 'invited' ? 'primary' : undefined}
          onClick={() => {
            setSource(source === 'invited' ? 'joined' : 'invited');
            setPage(1);
          }}
        >
          Invited only ({data?.invitedOnly ?? 0})
        </button>
        <select
          aria-label="Tracking"
          value={tracking}
          onChange={(e) => {
            setTracking(e.target.value as TrackingFilter);
            setPage(1);
          }}
        >
          {(Object.keys(trackingLabels) as TrackingFilter[]).map((value) => (
            <option key={value} value={value}>
              {trackingLabels[value]}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {selected.size > 0 && (
        <div className="toolbar selection-bar" role="region" aria-label="Selected people">
          <span>{selected.size} selected</span>
          <button
            type="button"
            className="primary"
            disabled={!pair}
            onClick={() => {
              if (pair?.[0] && pair[1]) setMerging([pair[0], pair[1]]);
            }}
          >
            Merge 2 selected
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(new Map());
            }}
          >
            Clear
          </button>
          {selected.size !== 2 && (
            <span className="muted">Select exactly two people to merge.</span>
          )}
        </div>
      )}
      {data && shown.length === 0 ? (
        <div className="panel empty-state">
          <h3>
            {search || source !== 'joined' || tracking !== 'tracked'
              ? 'Nobody matches'
              : 'No people yet'}
          </h3>
          <p>
            {search || source !== 'joined' || tracking !== 'tracked'
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
                  <th
                    className="num"
                    title="Lines worth your time for this person: the ones the voice check or the labelling is unsure about, plus as many confident lines as their voice profile still needs to be good enough. Short, overlapped and filler lines never count."
                  >
                    To review
                  </th>
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
                  <th>
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((person) => (
                  <tr
                    key={person.id}
                    className={person.tracking === 'off' ? 'is-untracked' : undefined}
                  >
                    <td>
                      <div className="name-cell">
                        <input
                          type="checkbox"
                          aria-label={`Select ${person.name}`}
                          checked={selected.has(person.id)}
                          onChange={() => {
                            toggle(person);
                          }}
                        />
                        <div>
                          <a className="row-link" href={`#/people/${person.id}`}>
                            {person.name}
                          </a>
                          {person.unnamed && <span className="unnamed-tag">Unnamed</span>}
                          {person.sharedAccount && (
                            <span
                              className="shared-marker"
                              title={`Heard in the shared account ${person.sharedAccount}`}
                            >
                              via shared account
                            </span>
                          )}
                          {person.source === 'invited' && <span className="muted"> Invited</span>}
                          {person.tracking === 'off' && <span className="muted"> Not tracked</span>}
                          {person.duplicates[0] && (
                            <span className="duplicate-hint">
                              Possible duplicate of {person.duplicates[0].name}.{' '}
                              <button
                                type="button"
                                className="link"
                                onClick={() => {
                                  const other = person.duplicates[0];
                                  if (other) setMerging([person, other.id]);
                                }}
                              >
                                Merge
                              </button>
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="muted">
                      {person.emails.length === 0 ? 'No email' : person.emails.join(', ')}
                    </td>
                    <td className="muted">
                      {person.tracking === 'off' ? (
                        'Not tracked'
                      ) : data.learning || person.samples > 0 ? (
                        <span className={`profile-dot ${profileLevel(person)}`}>
                          {profileLabels[profileLevel(person)]}
                        </span>
                      ) : (
                        'Learning is off'
                      )}
                      {person.languages.length > 0 && (
                        <span className="language-chips">
                          {person.languages.map((profile) => (
                            <span
                              key={profile.language}
                              className="language-chip"
                              title={`${profile.languageName}: ${coverageText(profile.effectiveSeconds, profile.targetSeconds)}`}
                            >
                              {profile.language === 'und' ? '?' : profile.language}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="num">{person.needsReview || ''}</td>
                    <td className="num">{person.meetings}</td>
                    <td className="num muted">
                      {person.lastSeenAt ? dateFormat.format(new Date(person.lastSeenAt)) : ''}
                    </td>
                    <td className="row-menu">
                      <Menu
                        trigger={<MoreIcon />}
                        label={`Actions for ${person.name}`}
                        align="end"
                        items={[
                          { label: 'Open', href: `#/people/${person.id}` },
                          ...(person.unnamed
                            ? [
                                {
                                  label: 'Name',
                                  onSelect: () => {
                                    setNaming(person);
                                  },
                                },
                              ]
                            : []),
                          ...(person.needsReview > 0
                            ? [{ label: 'Review lines', href: `#/people/${person.id}/review` }]
                            : []),
                          {
                            label: person.tracking === 'off' ? 'Track again' : 'Do not track',
                            onSelect: () => {
                              void changeTracking(person);
                            },
                          },
                        ]}
                      />
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
      {merging && (
        <MergeDialog
          a={merging[0]}
          b={merging[1]}
          onClose={() => {
            setMerging(undefined);
          }}
          onMerged={() => {
            setMerging(undefined);
            setSelected(new Map());
            setReload((n) => n + 1);
          }}
        />
      )}
      {naming && (
        <NameVoiceDialog
          person={naming}
          onClose={() => {
            setNaming(undefined);
          }}
          onNamed={() => {
            setNaming(undefined);
            setReload((n) => n + 1);
          }}
        />
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
