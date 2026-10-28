import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import type { PersonChoiceDto, ReviewRosterDto } from '../src/dto.js';
import { everyoneOptions, rosterOptions, type InvitedOption, type PickerOption } from './review.js';

type Mode = 'roster' | 'other' | 'new';

const SHOWN = 50;

/**
 * "Who is this?": someone from the meeting first, then anyone in People or a new person. Used
 * for a voice of a shared tile, on the naming page and in the People card.
 */
export function NamePicker({
  roster: rosterPeople,
  people,
  invited = [],
  label,
  busy,
  onPick,
  onShowTaken,
}: {
  roster: ReviewRosterDto[];
  people: PersonChoiceDto[];
  /** The invitees of the meeting, to pick first. */
  invited?: InvitedOption[];
  /** Whether some invitees are linked to someone else and can be listed too. */
  onShowTaken?: ((on: boolean) => void) | undefined;
  /** Names the group for assistive technology, such as "Who is voice 1". */
  label: string;
  busy: boolean;
  onPick: (option: PickerOption) => void;
}) {
  const [mode, setMode] = useState<Mode>('roster');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const roster = useMemo(() => rosterOptions(rosterPeople, people, ''), [rosterPeople, people]);
  const everyone = useMemo(() => everyoneOptions(people, '', query), [people, query]);
  const first = useRef<HTMLElement>(null);
  useEffect(() => {
    if (mode !== 'roster') first.current?.focus();
  }, [mode]);

  const create = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onPick({ personId: null, name: trimmed });
  };

  return (
    <div className="review-picker" role="group" aria-label={label}>
      <h3>Who is this?</h3>
      {mode === 'roster' && (
        <>
          {invited.length > 0 && (
            <>
              <h4 className="review-group">Invited to this meeting</h4>
              <ul className="review-options" aria-label="Invited to this meeting">
                {invited.map((entry) => (
                  <li key={entry.email}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        onPick(entry.option);
                      }}
                    >
                      {entry.label}
                      {entry.takenBy && <span className="muted"> · now {entry.takenBy}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {onShowTaken && (
            <label className="check">
              <input
                type="checkbox"
                onChange={(e) => {
                  onShowTaken(e.target.checked);
                }}
              />
              <span>Also show invitees linked to someone else (move)</span>
            </label>
          )}
          {roster.length > 0 && invited.length > 0 && (
            <h4 className="review-group">Other participants of this meeting</h4>
          )}
          {roster.length === 0 ? (
            invited.length === 0 && <p className="muted">Nobody else is listed for this meeting.</p>
          ) : (
            <ul className="review-options" aria-label="Other participants of this meeting">
              {roster.slice(0, 9).map((option) => (
                <li key={option.personId ?? option.name}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onPick(option);
                    }}
                  >
                    {option.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="review-picker-more">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode('other');
              }}
            >
              People...
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMode('new');
              }}
            >
              New person
            </button>
          </div>
        </>
      )}
      {mode === 'other' && (
        <>
          <label className="field">
            <span>Search people</span>
            <input
              type="search"
              ref={first as React.RefObject<HTMLInputElement>}
              value={query}
              autoComplete="off"
              placeholder="Name"
              onChange={(e) => {
                setQuery(e.target.value);
              }}
            />
          </label>
          {everyone.length === 0 ? (
            <p className="muted">Nobody matches.</p>
          ) : (
            <ul className="review-options scroll">
              {everyone.slice(0, SHOWN).map((option) => (
                <li key={option.personId}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onPick(option);
                    }}
                  >
                    {option.name}
                    {option.untracked && <span className="muted"> · not tracked</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {mode === 'new' && (
        <form onSubmit={create}>
          <label className="field">
            <span>Name of the new person</span>
            <input
              ref={first as React.RefObject<HTMLInputElement>}
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </label>
          <div className="review-picker-more">
            <button className="primary" type="submit" disabled={busy || name.trim() === ''}>
              Add and name the voice
            </button>
          </div>
        </form>
      )}
      {mode !== 'roster' && (
        <div className="review-picker-more">
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode('roster');
            }}
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}
