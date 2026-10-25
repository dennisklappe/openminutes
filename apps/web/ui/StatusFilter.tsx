import { useEffect, useId, useRef, useState } from 'react';
import type { MeetingStatus } from '../src/dto.js';
import { statusLabels } from './format.js';
import { CheckIcon, ChevronIcon } from './icons.js';
import {
  ALL_STATUSES,
  DEFAULT_STATUSES,
  isDefaultStatuses,
  statusSummary,
} from './statusFilter.js';

/**
 * A checkbox menu for the meeting status filter. Keyboard: arrows move, Space or Enter toggles,
 * Escape closes and returns focus to the button. The last checked status cannot be unchecked.
 */
export function StatusFilter(props: {
  selected: MeetingStatus[];
  onChange: (next: MeetingStatus[]) => void;
}) {
  const { selected, onChange } = props;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    root.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const move = (event: React.KeyboardEvent) => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const target: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: items.length - 1,
    };
    const next = target[event.key];
    if (next === undefined || items.length === 0) return;
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };

  const toggle = (status: MeetingStatus) => {
    const checked = selected.includes(status);
    if (checked && selected.length === 1) return;
    onChange(ALL_STATUSES.filter((s) => (s === status ? !checked : selected.includes(s))));
  };

  return (
    <div
      className="menu status-filter"
      ref={root}
      onBlur={(event) => {
        if (open && !root.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label="Status"
        className="status-filter-trigger"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span>{statusSummary(selected)}</span>
        <span className="status-filter-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div className="menu-list start" id={id} role="menu" aria-label="Status" onKeyDown={move}>
          {ALL_STATUSES.map((status) => {
            const checked = selected.includes(status);
            return (
              <button
                key={status}
                type="button"
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => {
                  toggle(status);
                }}
              >
                <span className="menu-check" aria-hidden="true">
                  {checked && <CheckIcon />}
                </span>
                {statusLabels[status]}
              </button>
            );
          })}
          <button
            type="button"
            role="menuitem"
            className="menu-reset"
            disabled={isDefaultStatuses(selected)}
            onClick={() => {
              onChange(DEFAULT_STATUSES);
            }}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
