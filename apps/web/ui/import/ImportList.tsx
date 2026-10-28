import type { ImportMeetingDto, LinkableEventDto } from '../../src/dto.js';
import { EventPicker } from '../EventPicker.js';
import { formatLength, formatWhen } from '../format.js';
import { ClockIcon, UsersIcon } from '../icons.js';
import { eventsNear, isSelectable, selectableKeys } from './choices.js';

function Badges({ meeting }: { meeting: ImportMeetingDto }) {
  const failed = meeting.meeting?.status === 'failed';
  return (
    <span className="import-badges">
      {meeting.meeting && !failed && <span className="chip">Already imported</span>}
      {failed && <span className="chip chip-warn">Failed, retry</span>}
      {!meeting.hasAudio && <span className="chip chip-warn">No audio, not importable</span>}
    </span>
  );
}

export function ImportList(props: {
  meetings: readonly ImportMeetingDto[];
  picked: ReadonlySet<string>;
  onChange: (picked: Set<string>) => void;
  /** Calendar meetings a meeting can be linked to, and the one each is linked to now. */
  events: readonly LinkableEventDto[];
  links: Readonly<Record<string, string>>;
  onLink: (key: string, eventId: string | undefined) => void;
}) {
  const { meetings, picked, onChange, events, links, onLink } = props;
  const available = selectableKeys(meetings);
  const all = available.length > 0 && available.every((key) => picked.has(key));

  const toggle = (key: string) => {
    const next = new Set(picked);
    if (!next.delete(key)) next.add(key);
    onChange(next);
  };

  return (
    <section aria-labelledby="import-list-h">
      <div className="block-head">
        <h2 id="import-list-h">In the export</h2>
        <span className="muted">
          {picked.size} of {meetings.length} selected
        </span>
        {available.length > 0 && (
          <button
            type="button"
            className="link"
            onClick={() => {
              onChange(all ? new Set() : new Set(available));
            }}
          >
            {all ? 'Select none' : 'Select all'}
          </button>
        )}
      </div>
      <ul className="panel import-list">
        {meetings.map((meeting) => {
          const selectable = isSelectable(meeting);
          return (
            <li key={meeting.key}>
              <label className={`import-row${selectable ? '' : ' is-disabled'}`}>
                <input
                  type="checkbox"
                  checked={picked.has(meeting.key)}
                  disabled={!selectable}
                  onChange={() => {
                    toggle(meeting.key);
                  }}
                />
                <span className="import-main">
                  <span className="import-title truncate">{meeting.title}</span>
                  <span className="import-meta muted">
                    <span>
                      <ClockIcon />
                      {formatWhen(meeting.startedAt)}, {formatLength(meeting.durationMs)}
                    </span>
                    <span>
                      <UsersIcon />
                      {meeting.attendees}
                    </span>
                  </span>
                </span>
                <Badges meeting={meeting} />
              </label>
              {selectable && meeting.meeting === null && (
                <div className="import-link">
                  <EventPicker
                    compact
                    events={eventsNear(events, meeting)}
                    value={links[meeting.key]}
                    onChange={(id) => {
                      onLink(meeting.key, id);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
