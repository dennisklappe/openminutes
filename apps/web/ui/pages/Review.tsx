import { useCallback, useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import type { ReviewLineDto, ReviewQueueDto } from '../../src/dto.js';
import { api, errorMessage, meetingUrl } from '../api.js';
import { formatDate, formatDuration } from '../format.js';
import { isTyping } from '../keyboard.js';
import {
  commit,
  confidenceLabel,
  counts,
  currentLine,
  decide,
  describeDecision,
  everyoneOptions,
  keyAction,
  pick,
  position,
  restore,
  reviewSkipped,
  rosterOptions,
  startReview,
  undo,
  type Decision,
  type Entry,
  type PickerOption,
  type ReviewState,
} from '../review.js';
import { reasonLabel } from '../people.js';
import { SnippetPlayer } from '../SnippetPlayer.js';
import '../people.css';

type Picker = 'closed' | 'roster' | 'other' | 'new';

const SHOWN = 50;
/** How long the last decision can be taken back before it is sent. */
const UNDO_MS = 10_000;

function Key({ children }: { children: string }) {
  return (
    <kbd className="key" aria-hidden="true">
      {children}
    </kbd>
  );
}

function PersonPicker({
  line,
  people,
  mode,
  onMode,
  onPick,
  onReject,
}: {
  line: ReviewLineDto;
  people: ReviewQueueDto['people'];
  mode: Exclude<Picker, 'closed'>;
  onMode: (mode: Picker) => void;
  onPick: (option: PickerOption) => void;
  onReject: () => void;
}) {
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const roster = useMemo(
    () => rosterOptions(line.roster, people, line.proposed.id),
    [line, people],
  );
  const everyone = useMemo(
    () => everyoneOptions(people, line.proposed.id, query),
    [people, line.proposed.id, query],
  );
  const first = useRef<HTMLElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, [mode]);

  const create = (event: SubmitEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onPick({ personId: null, name: trimmed });
  };

  return (
    <div
      className="review-picker"
      role="group"
      aria-label={`Who said this instead of ${line.proposed.name}`}
    >
      <h3>Who said it instead?</h3>
      {mode === 'roster' && (
        <>
          {roster.length === 0 ? (
            <p className="muted">Nobody else is listed for this meeting.</p>
          ) : (
            <ul className="review-options">
              {roster.slice(0, 9).map((option, index) => (
                <li key={option.personId ?? option.name}>
                  <button
                    type="button"
                    ref={index === 0 ? (first as React.RefObject<HTMLButtonElement>) : undefined}
                    onClick={() => {
                      onPick(option);
                    }}
                  >
                    <Key>{String(index + 1)}</Key>
                    {option.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="review-picker-more">
            <button
              type="button"
              onClick={() => {
                onMode('new');
              }}
            >
              New person
            </button>
            <button
              type="button"
              onClick={() => {
                onMode('other');
              }}
            >
              Someone else...
            </button>
            <button type="button" onClick={onReject}>
              Not {line.proposed.name}, unsure who
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
              onClick={() => {
                onMode('new');
              }}
            >
              New person
            </button>
          </div>
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
            <button className="primary" type="submit" disabled={name.trim() === ''}>
              Add and move the line
            </button>
          </div>
        </form>
      )}
      <div className="review-picker-more">
        <button
          type="button"
          className="link"
          onClick={() => {
            onMode(mode === 'roster' ? 'closed' : 'roster');
          }}
        >
          {mode === 'roster' ? 'Cancel' : 'Back'}
        </button>
      </div>
    </div>
  );
}

function Card({
  line,
  queue,
  picker,
  setPicker,
  onDecide,
  canUndo,
  onUndo,
}: {
  line: ReviewLineDto;
  queue: ReviewQueueDto;
  picker: Picker;
  setPicker: (picker: Picker) => void;
  onDecide: (decision: Decision) => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const disapprove = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    heading.current?.focus();
  }, [line.id]);
  useEffect(() => {
    if (picker === 'closed' && wasOpen.current) disapprove.current?.focus();
    wasOpen.current = picker !== 'closed';
  }, [picker]);

  return (
    <section className="panel review-card" aria-labelledby="review-quote">
      <div className="card-body">
        <h2 id="review-quote" className="review-quote" tabIndex={-1} ref={heading}>
          {line.text}
        </h2>
        {line.hasAudio && (
          <SnippetPlayer
            key={line.id}
            audioUrl={meetingUrl(line.meetingId, 'audio')}
            label={line.text}
            snippets={[{ startMs: line.startMs, endMs: line.endMs, text: '' }]}
          />
        )}
        <dl className="facts review-facts">
          <dt>Proposed</dt>
          <dd>
            <strong>{line.proposed.name}</strong>
            <span className="muted"> · {confidenceLabel(line)}</span>
            <br />
            <span className="muted">{reasonLabel(line)}</span>
          </dd>
          {line.considered.length > 0 && (
            <>
              <dt>Also considered</dt>
              <dd>
                {line.considered
                  .map((c) => `${c.name} ${String(Math.round(c.score * 100))}%`)
                  .join(', ')}
              </dd>
            </>
          )}
          <dt>Meeting</dt>
          <dd>
            <a href={`#/meetings/${line.meetingId}`}>{line.meetingTitle}</a>
            <span className="muted">
              {' '}
              · {formatDate(line.meetingDate)} · at {formatDuration(line.startMs)}
            </span>
          </dd>
        </dl>
        {picker !== 'closed' && (
          <PersonPicker
            line={line}
            people={queue.people}
            mode={picker}
            onMode={setPicker}
            onPick={(option) => {
              onDecide(pick(option));
            }}
            onReject={() => {
              onDecide({ kind: 'reject' });
            }}
          />
        )}
      </div>
      {picker === 'closed' && (
        <footer className="card-foot review-actions">
          <button
            type="button"
            onClick={() => {
              onDecide({ kind: 'skip' });
            }}
          >
            Skip <Key>S</Key>
          </button>
          <button
            type="button"
            ref={disapprove}
            className="danger"
            onClick={() => {
              setPicker('roster');
            }}
          >
            Disapprove <Key>D</Key>
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onDecide({ kind: 'approve' });
            }}
          >
            Approve <Key>A</Key>
          </button>
        </footer>
      )}
      <div className="review-undo">
        <button type="button" className="link" disabled={!canUndo} onClick={onUndo}>
          Undo last <Key>U</Key>
        </button>
      </div>
    </section>
  );
}

export function Review({ personId }: { personId?: string | undefined }) {
  const [queue, setQueue] = useState<ReviewQueueDto>();
  const [state, setState] = useState<ReviewState>();
  const [picker, setPicker] = useState<Picker>('closed');
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState('');
  const pending = useRef<Entry | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [, tick] = useState(0);
  const exitTo = personId ? `#/people/${personId}` : '#/people';

  useEffect(() => {
    api.reviewQueue(personId).then(
      (loaded) => {
        setQueue(loaded);
        setState(startReview(loaded.lines));
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  }, [personId]);

  /** The last decision is held back until the next one, so Undo can take it back. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const entry = pending.current;
    if (!entry) return;
    pending.current = undefined;
    try {
      await commit(api, entry);
    } catch (failure) {
      setState((current) => (current ? restore(current, entry) : current));
      setError(`${errorMessage(failure)} The line is back for another look.`);
    }
  }, []);

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
      void flush();
    };
  }, [flush]);

  const line = state && currentLine(state);

  const onDecide = useCallback(
    (decision: Decision) => {
      if (!state || !line) return;
      const entry: Entry = { line, decision };
      void flush();
      setError(undefined);
      setState(decide(state, decision));
      setPicker('closed');
      setMessage(describeDecision(entry));
      if (decision.kind !== 'skip') {
        pending.current = entry;
        timer.current = setTimeout(() => {
          void flush();
          tick((n) => n + 1);
        }, UNDO_MS);
      }
    },
    [state, line, flush],
  );

  /** Only a skip or the decision still held back can be taken back. */
  const last = state?.history.at(-1);
  const canUndo = last !== undefined && (last.decision.kind === 'skip' || pending.current === last);

  const onUndo = useCallback(() => {
    if (!state || !last || !canUndo) return;
    if (pending.current === last) {
      pending.current = undefined;
      clearTimeout(timer.current);
    }
    setState(undo(state));
    setPicker('closed');
    setMessage('Undone.');
  }, [state, last, canUndo]);

  const exit = useCallback(() => {
    void flush().then(() => {
      window.location.hash = exitTo;
    });
  }, [flush, exitTo]);

  useEffect(() => {
    if (!queue || !line) return;
    const roster = rosterOptions(line.roster, queue.people, line.proposed.id);
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'Escape' && isTyping(event.target)) return;
      const action = keyAction(
        event.key,
        picker === 'closed' ? 'closed' : picker === 'roster' ? 'roster' : 'other',
      );
      if (!action) return;
      event.preventDefault();
      if (typeof action === 'object') {
        const option = roster[action.pick];
        if (option) onDecide(pick(option));
      } else if (action === 'exit') {
        if (picker === 'closed') exit();
        else setPicker('closed');
      } else if (action === 'approve') onDecide({ kind: 'approve' });
      else if (action === 'skip') onDecide({ kind: 'skip' });
      else if (action === 'disapprove') setPicker('roster');
      else onUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [queue, line, picker, onDecide, onUndo, exit]);

  const done = state ? counts(state) : undefined;

  return (
    <>
      <a className="back-link" href={exitTo}>
        {personId ? 'Person' : 'People'}
      </a>
      <header className="page-head">
        <div>
          <h1>Review</h1>
          <p className="lede">
            One line at a time. Approve it, say who it was instead, or skip it for later.
            {queue &&
              !queue.learning &&
              ' Voice learning is off, so approving only confirms who said the line.'}
          </p>
        </div>
        {state && state.total > 0 && (
          <p className="review-progress muted">
            {line ? `${String(position(state))} of ${String(state.total)}` : 'Finished'}
          </p>
        )}
      </header>
      {state && state.total > 0 && (
        <div
          className="voice-review-meter"
          role="progressbar"
          aria-label="Review progress"
          aria-valuemin={0}
          aria-valuemax={state.total}
          aria-valuenow={state.history.filter((e) => e.decision.kind !== 'skip').length}
        >
          <span
            style={{
              width: `${String((100 * state.history.filter((e) => e.decision.kind !== 'skip').length) / state.total)}%`,
            }}
          />
        </div>
      )}
      <div className="visually-hidden" role="status" aria-live="polite">
        {message}
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {queue && state && line && (
        <Card
          line={line}
          queue={queue}
          picker={picker}
          setPicker={setPicker}
          onDecide={onDecide}
          canUndo={canUndo}
          onUndo={onUndo}
        />
      )}
      {queue && state && !line && done && (
        <div className="panel empty-state">
          <h3>{state.total === 0 ? 'Nothing to review' : 'All done'}</h3>
          <p>
            {state.total === 0
              ? 'No lines need a look right now.'
              : `${String(done.approved)} approved, ${String(done.changed)} changed${done.skipped > 0 ? `, ${String(done.skipped)} skipped` : ''}.`}
          </p>
          <div className="review-end">
            {done.skipped > 0 && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setState(reviewSkipped(state));
                  setMessage('Back to the skipped lines.');
                }}
              >
                Review {String(done.skipped)} skipped
              </button>
            )}
            {canUndo && (
              <button type="button" onClick={onUndo}>
                Undo last
              </button>
            )}
            <a className="button" href={exitTo}>
              Back
            </a>
          </div>
        </div>
      )}
    </>
  );
}
