import { useEffect, useRef, useState } from 'react';
import type { MeetingSeriesDto, MeetingStatus } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { ChevronIcon } from './icons.js';

interface Props {
  meetingId: string;
  status: MeetingStatus;
  series: MeetingSeriesDto | null;
  onChanged: () => void;
  onError: (message: string) => void;
}

/** The Auto-join pill of an upcoming meeting, opening a menu to change whether the bot joins it. */
export function JoinChoice({ meetingId, status, series, onChanged, onError }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const skipped = status === 'skipped';
  const seriesSkipped = (series?.skippedId ?? null) !== null;

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const close = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
    };
  }, [open]);

  const choose = (action: () => Promise<unknown>) => {
    setOpen(false);
    trigger.current?.focus();
    action().then(onChanged, (failure: unknown) => {
      onError(errorMessage(failure));
    });
  };

  const move = (event: React.KeyboardEvent) => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      setOpen(false);
      trigger.current?.focus();
    } else if (event.key === 'ArrowDown') {
      items[(at + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      items[(at - 1 + items.length) % items.length]?.focus();
    } else {
      return;
    }
    event.preventDefault();
  };

  const label = seriesSkipped ? 'Series skipped' : skipped ? 'Skipped' : 'Auto-join';
  return (
    <span className="join-choice" ref={root} onKeyDown={open ? move : undefined}>
      <button
        ref={trigger}
        type="button"
        className={`pill join-choice-trigger${skipped ? ' pill-skipped' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change whether the bot joins this meeting"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <i aria-hidden="true" />
        {label}
        <ChevronIcon />
      </button>
      {open && (
        <div className="join-menu panel" role="menu" aria-label="Join this meeting">
          <button
            role="menuitemradio"
            aria-checked={!skipped}
            onClick={() => {
              if (skipped) choose(() => api.rejoinMeeting(meetingId));
              else setOpen(false);
            }}
          >
            Join this meeting
          </button>
          <button
            role="menuitemradio"
            aria-checked={skipped}
            onClick={() => {
              if (!skipped) choose(() => api.skipMeeting(meetingId));
              else setOpen(false);
            }}
          >
            Don't join this meeting
          </button>
          {series && (
            <button
              role="menuitemradio"
              aria-checked={seriesSkipped}
              onClick={() => {
                const skippedId = series.skippedId;
                choose(() => (skippedId ? api.rejoinSeries(skippedId) : api.skipSeries(meetingId)));
              }}
            >
              {seriesSkipped
                ? 'Join every meeting of this series again'
                : "Don't join any meeting of this series"}
            </button>
          )}
        </div>
      )}
    </span>
  );
}
