import { useCallback, useState } from 'react';
import type { MeetingListItemDto, MeetingStatus } from '../../src/dto.js';
import { api, type BulkAction, type MeetingFilter } from '../api.js';
import { formatLength, formatWhen } from '../format.js';
import { ClockIcon, ImportIcon, MoreIcon, SearchIcon, UsersIcon, PlatformIcon } from '../icons.js';
import { JoinBox } from '../JoinBox.js';
import { JoinChoice } from '../JoinChoice.js';
import { Menu } from '../Menu.js';
import { RecordLink } from '../recorder/RecordLink.js';
import { UnfinishedBanner } from '../recorder/UnfinishedBanner.js';
import { type Selection, useSelection } from '../selection.js';
import { SelectionBar } from '../SelectionBar.js';
import { StatusFilter } from '../StatusFilter.js';
import {
  DEFAULT_STATUSES,
  isDefaultStatuses,
  loadStatuses,
  saveStatuses,
  statusQuery,
} from '../statusFilter.js';
import { StatusBadge } from '../StatusBadge.js';
import { BulkMessages, useBulk } from '../useBulk.js';
import { usePolling } from '../usePolling.js';

interface Filters {
  q: string;
  platform: string;
  statuses: MeetingStatus[];
}
const UPCOMING_COMPACT = { days: 7, limit: 10 };
const UPCOMING_EXPANDED = { days: 30, limit: 20 };
const PLATFORMS = [
  { value: '', label: 'All' },
  { value: 'meet', label: 'Meet' },
  { value: 'teams', label: 'Teams' },
  { value: 'recording', label: 'Phone' },
  { value: 'imported', label: 'Imported' },
];
const LIVE: MeetingStatus[] = ['joining', 'in_lobby', 'recording'];

function Toolbar({ filter, onChange }: { filter: Filters; onChange: (next: Filters) => void }) {
  return (
    <div className="toolbar">
      <label className="search">
        <SearchIcon />
        <input
          type="search"
          aria-label="Search meetings"
          placeholder="Search titles and transcripts"
          value={filter.q}
          onChange={(e) => {
            onChange({ ...filter, q: e.target.value });
          }}
        />
      </label>
      <div className="segmented" role="group" aria-label="Platform">
        {PLATFORMS.map(({ value, label }) => (
          <button
            key={value}
            aria-pressed={filter.platform === value}
            onClick={() => {
              onChange({ ...filter, platform: value });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <StatusFilter
        selected={filter.statuses}
        onChange={(statuses) => {
          onChange({ ...filter, statuses });
        }}
      />
    </div>
  );
}

function length(m: MeetingListItemDto): string {
  if (m.durationMs !== null) return formatLength(m.durationMs);
  if (m.startedAt && m.endedAt) {
    return formatLength(new Date(m.endedAt).getTime() - new Date(m.startedAt).getTime());
  }
  if (LIVE.includes(m.status) && m.startedAt) {
    return formatLength(Date.now() - new Date(m.startedAt).getTime());
  }
  return '';
}

const canRejoin = (m: MeetingListItemDto) =>
  m.status === 'skipped' && (!m.scheduledStart || new Date(m.scheduledStart) > new Date());

function Upcoming({ onChanged }: { onChanged: () => void }) {
  const [error, setError] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const { days, limit } = expanded ? UPCOMING_EXPANDED : UPCOMING_COMPACT;
  const load = useCallback(() => api.upcomingMeetings(days, limit), [days, limit]);
  const { data, refresh } = usePolling(load);
  if (!data || data.all === 0) return null;
  const meetings = data.items;
  const more = data.all - meetings.length;
  const refreshAll = () => {
    refresh();
    onChanged();
  };
  return (
    <section className="block" aria-labelledby="upcoming-h">
      <div className="block-head">
        <h2 id="upcoming-h">Upcoming</h2>
        <span className="muted">
          {meetings.length < data.total
            ? `${String(meetings.length)} of ${String(data.total)}`
            : data.total}{' '}
          in the next {days} days
        </span>
      </div>
      {error && <p className="banner banner-error">{error}</p>}
      <ul className="panel list">
        {meetings.map((m) => (
          <li key={m.id} className={m.status === 'skipped' ? 'is-skipped' : undefined}>
            <a href={`#/meetings/${m.id}`}>
              <span className="when">
                <ClockIcon />
                {formatWhen(m.scheduledStart ?? m.createdAt)}
              </span>
              <span className="name">
                <PlatformIcon platform={m.platform} />
                <span className="truncate">{m.title}</span>
              </span>
            </a>
            <JoinChoice
              meetingId={m.id}
              status={m.status}
              series={m.series}
              onChanged={refreshAll}
              onError={setError}
            />
          </li>
        ))}
      </ul>
      {more > 0 &&
        (expanded ? (
          <p className="upcoming-more muted">
            {more} more further out. Search the list below, or change which meetings the bot joins
            in <a href="#/settings/calendars">calendar settings</a>.
          </p>
        ) : (
          <button
            className="link upcoming-more"
            onClick={() => {
              setExpanded(true);
            }}
          >
            Show more
          </button>
        ))}
    </section>
  );
}

type Act = (action: BulkAction, items: MeetingListItemDto[]) => void;

function Table(props: {
  meetings: MeetingListItemDto[];
  selection: Selection;
  onAct: Act;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { meetings, selection, onAct, onChanged, onError } = props;
  const removable = meetings.filter((m) => m.canDelete);
  const allSelected = removable.length > 0 && removable.every((m) => selection.ids.has(m.id));
  return (
    <div className="panel table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>
              <label className="cell-select">
                {selection.active && (
                  <input
                    type="checkbox"
                    aria-label="Select all meetings"
                    checked={allSelected}
                    onChange={() => {
                      selection.setAll(allSelected ? [] : removable.map((m) => m.id));
                    }}
                  />
                )}
                Meeting
              </label>
            </th>
            <th>Status</th>
            <th>Date</th>
            <th className="num">Length</th>
            <th className="num">People</th>
            <th>
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {meetings.map((m) => (
            <tr key={m.id} className={m.status === 'skipped' ? 'is-skipped' : undefined}>
              <td>
                <div className="cell-select">
                  {selection.active && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${m.title}`}
                      disabled={!m.canDelete}
                      checked={selection.ids.has(m.id)}
                      onChange={() => {
                        selection.toggle(m.id);
                      }}
                    />
                  )}
                  <a className="row-link" href={`#/meetings/${m.id}`}>
                    <PlatformIcon platform={m.platform} />
                    <span className="cell-title">
                      <span className="truncate">{m.title}</span>
                      {m.error && <span className="cell-error">{m.error}</span>}
                    </span>
                  </a>
                </div>
              </td>
              <td>
                {canRejoin(m) ? (
                  <JoinChoice
                    meetingId={m.id}
                    status={m.status}
                    series={m.series}
                    onChanged={onChanged}
                    onError={onError}
                  />
                ) : (
                  <StatusBadge status={m.status} progress={m.progress} />
                )}
              </td>
              <td className="muted nowrap">{formatWhen(m.startedAt ?? m.createdAt)}</td>
              <td className="num">{length(m) || '-'}</td>
              <td className="num">
                {m.participantCount > 0 ? (
                  <span className="people">
                    <UsersIcon />
                    {m.participantCount}
                  </span>
                ) : (
                  '-'
                )}
              </td>
              <td className="row-menu">
                <Menu
                  trigger={<MoreIcon />}
                  label={`Actions for ${m.title}`}
                  align="end"
                  items={[
                    { label: 'Open', href: `#/meetings/${m.id}` },
                    ...(m.status === 'transcribed'
                      ? [{ label: 'Review speakers', href: `#/meetings/${m.id}/review` }]
                      : []),
                    ...(m.canDelete
                      ? [
                          {
                            label: 'Archive',
                            onSelect: () => {
                              onAct('archive', [m]);
                            },
                          },
                          {
                            label: 'Delete',
                            danger: true,
                            onSelect: () => {
                              onAct('delete', [m]);
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Meetings() {
  const [filter, setFilter] = useState<Filters>(() => ({
    q: '',
    platform: '',
    statuses: loadStatuses(),
  }));
  const filtered = Boolean(filter.q || filter.platform) || !isDefaultStatuses(filter.statuses);
  const load = useCallback(() => {
    const query: MeetingFilter = {
      q: filter.q,
      platform: filter.platform,
      status: statusQuery(filter.statuses),
    };
    return api.meetings(filtered ? query : { ...query, upcoming: 'hide' });
  }, [filter, filtered]);
  const changeFilter = (next: Filters) => {
    saveStatuses(next.statuses);
    setFilter(next);
  };
  const { data: meetings, refresh } = usePolling(load);
  const [error, setError] = useState<string>();
  const selection = useSelection();
  const bulk = useBulk(() => {
    selection.stop();
    refresh();
  });

  const recent = meetings ?? [];
  const act: Act = (action, items) => {
    void bulk.run(action, items);
  };
  const chosen = recent.filter((m) => selection.ids.has(m.id));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Meetings</h1>
          <p className="lede">Send the bot into a meeting now, or let your calendar do it.</p>
        </div>
        <div className="head-actions">
          <a className="button" href="#/import">
            <ImportIcon />
            <span>Import</span>
          </a>
          <RecordLink className="button primary record-cta" />
        </div>
      </header>
      <UnfinishedBanner />
      <JoinBox onJoined={refresh} />
      {!filtered && <Upcoming onChanged={refresh} />}
      <section className="block" aria-labelledby="recent-h">
        <div className="block-head">
          <h2 id="recent-h">{filtered ? 'Results' : 'Recent'}</h2>
          {meetings && <span className="muted">{recent.length}</span>}
          {recent.some((m) => m.canDelete) && !selection.active && (
            <button className="link" onClick={selection.start}>
              Select
            </button>
          )}
        </div>
        <Toolbar filter={filter} onChange={changeFilter} />
        <BulkMessages bulk={bulk} />
        {error && <p className="banner banner-error">{error}</p>}
        {selection.active && (
          <SelectionBar
            count={chosen.length}
            actions={[
              {
                label: 'Archive',
                onClick: () => {
                  act('archive', chosen);
                },
              },
              {
                label: 'Delete',
                danger: true,
                onClick: () => {
                  act('delete', chosen);
                },
              },
            ]}
            onCancel={selection.stop}
          />
        )}
        {meetings && recent.length === 0 && (
          <div className="panel empty-state">
            {filtered ? (
              <>
                <h3>No meetings match</h3>
                <p>Try a different search, or clear the filters.</p>
                <button
                  onClick={() => {
                    changeFilter({ q: '', platform: '', statuses: DEFAULT_STATUSES });
                  }}
                >
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <h3>No meetings yet</h3>
                <p>
                  Paste a Meet or Teams link above and the bot joins. Connect a calendar and it
                  joins your meetings by itself.
                </p>
                <a className="button" href="#/settings/calendars">
                  Connect a calendar
                </a>
              </>
            )}
          </div>
        )}
        {recent.length > 0 && (
          <Table
            meetings={recent}
            selection={selection}
            onAct={act}
            onChanged={refresh}
            onError={setError}
          />
        )}
      </section>
    </>
  );
}
