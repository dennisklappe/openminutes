import { useEffect, useState } from 'react';
import type { LinkableEventDto } from '../src/dto.js';
import { api } from './api.js';
import { formatWhen } from './format.js';
import './recorder/recorder.css';

const HOUR_MS = 3_600_000;

/**
 * The calendar meetings starting in a window, earliest first. Empty while loading and when they
 * cannot be fetched (offline, signed out): linking is optional, so the picker just stays away.
 */
export function useLinkableEvents(from: Date | undefined, to: Date | undefined) {
  const [events, setEvents] = useState<LinkableEventDto[]>([]);
  const start = from?.getTime();
  const end = to?.getTime();
  useEffect(() => {
    if (start === undefined || end === undefined) return;
    let current = true;
    api.linkableEvents(new Date(start), new Date(end)).then(
      ({ items }) => {
        if (current) setEvents(items);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [start, end]);
  return events;
}

/** The window around a time, in hours before and after. */
export const windowAround = (at: Date, beforeHours: number, afterHours: number) => ({
  from: new Date(at.getTime() - beforeHours * HOUR_MS),
  to: new Date(at.getTime() + afterHours * HOUR_MS),
});

export const eventLabel = (event: LinkableEventDto) =>
  `${event.title}, ${formatWhen(event.scheduledStart)}${
    event.people > 0 ? `, ${String(event.people)} invited` : ''
  }${event.status === 'skipped' ? ' (skipped)' : ''}`;

/** Chooses the calendar meeting a recording belongs to, or none. */
export function EventPicker(props: {
  events: readonly LinkableEventDto[];
  value: string | undefined;
  disabled?: boolean;
  label?: string;
  compact?: boolean;
  onChange: (eventId: string | undefined) => void;
}) {
  const { events, value, disabled, label, compact, onChange } = props;
  if (events.length === 0) return null;
  const chosen = events.find((event) => event.id === value);
  return (
    <label className={`event-picker${compact ? ' compact' : ''}`}>
      <span>{label ?? 'Link to a calendar meeting'}</span>
      <select
        value={value ?? ''}
        disabled={disabled === true}
        onChange={(event) => {
          onChange(event.target.value || undefined);
        }}
      >
        <option value="">Not linked</option>
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {eventLabel(event)}
          </option>
        ))}
      </select>
      {chosen && chosen.names.length > 0 && !compact && (
        <small className="muted">
          {chosen.names.join(', ')}
          {chosen.people > chosen.names.length
            ? ` and ${String(chosen.people - chosen.names.length)} more`
            : ''}
        </small>
      )}
    </label>
  );
}
