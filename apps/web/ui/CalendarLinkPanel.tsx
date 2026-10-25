import { useState } from 'react';
import type { CalendarLinkDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { AlertIcon, CheckIcon } from './icons.js';
import { Panel } from './Panel.js';

function Row({ link }: { link: CalendarLinkDto }) {
  const who = `${link.accountEmail}, ${link.calendarName}`;
  if (link.status === 'added') {
    return (
      <li className="calendar-link ok">
        <CheckIcon />
        <span>
          Link added to calendar
          <small className="muted"> {who}</small>
        </span>
      </li>
    );
  }
  if (link.status === 'pending') {
    return (
      <li className="calendar-link">
        <span>
          Not added yet
          <small className="muted"> {who}</small>
        </span>
      </li>
    );
  }
  return (
    <li className="calendar-link error">
      <AlertIcon />
      <span>
        {link.error}
        <small className="muted"> {who}</small>
        {link.status === 'needs_reconnect' && (
          <>
            {' '}
            <a href="#/settings/minutes">Allow calendar links</a>
          </>
        )}
      </span>
    </li>
  );
}

export function CalendarLinkPanel({
  meetingId,
  links,
  onChanged,
}: {
  meetingId: string;
  links: CalendarLinkDto[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const anyAdded = links.some((link) => link.status === 'added');

  const add = () => {
    setBusy(true);
    setError(undefined);
    api.addCalendarLink(meetingId).then(
      () => {
        setBusy(false);
        onChanged();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <Panel title="Minutes link in calendar">
      <ul className="calendar-links">
        {links.map((link) => (
          <Row key={`${link.accountEmail}/${link.calendarName}`} link={link} />
        ))}
      </ul>
      {error && <p className="banner banner-error">{error}</p>}
      <div className="minutes-actions">
        <button onClick={add} disabled={busy}>
          {anyAdded ? 'Update link in calendar' : 'Add link to calendar now'}
        </button>
      </div>
    </Panel>
  );
}
