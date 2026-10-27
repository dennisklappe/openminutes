import { useCallback, useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import type { ReviewLineDto, ReviewOrder, ReviewQueueDto } from '../../src/dto.js';
import { api, errorMessage, meetingUrl } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { formatDate, formatDuration } from '../format.js';
import { isTyping } from '../keyboard.js';
import {
  commit,
  confidenceLabel,
  coverageLabel,
  counts,
  currentLine,
  decide,
  describeDecision,
  dropPerson,
  everyoneOptions,
  focusLine,
  keyAction,
  pick,
  position,
  restore,
  reviewSkipped,
  rosterOptions,
  startReview,
  uncommit,
  undo,
  type Decision,
  type Entry,
  type PickerOption,
  type ReviewState,
} from '../review.js';
import { buildReviewRoute, type ReviewRoute } from '../reviewRoute.js';
import { reasonLabel } from '../people.js';
import { SnippetPlayer } from '../SnippetPlayer.js';
import '../people.css';

type Picker = 'closed' | 'roster' | 'other' | 'new';

const SHOWN = 50;

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
                    {option.untracked && <span className="muted"> · not tracked</span>}
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
  onUntrack,
}: {
  line: ReviewLineDto;
  queue: ReviewQueueDto;
  picker: Picker;
  setPicker: (picker: Picker) => void;
  onDecide: (decision: Decision) => void;
  canUndo: boolean;
  onUndo: () => void;
  onUntrack: () => void;
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
            <span className="muted">
              {line.why === 'training' ? 'Needs more samples' : 'Not sure who this is'}
              {': '}
              {reasonLabel(line)}
            </span>
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
          <dt>Voice profile</dt>
          <dd>
            {coverageLabel(line)}
            <div
              className="voice-review-meter"
              role="progressbar"
              aria-label={`${line.languageName} voice profile of ${line.proposed.name}`}
              aria-valuemin={0}
              aria-valuemax={line.profileTargetSeconds}
              aria-valuenow={Math.min(line.profileSeconds, line.profileTargetSeconds)}
            >
              <span
                style={{
                  width: `${String(Math.min(100, (100 * line.profileSeconds) / line.profileTargetSeconds))}%`,
                }}
              />
            </div>
          </dd>
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
        <button type="button" className="link quiet" onClick={onUntrack}>
          Do not track {line.proposed.name}
        </button>
        <button type="button" className="link" disabled={!canUndo} onClick={onUndo}>
          Undo last <Key>U</Key>
        </button>
      </div>
    </section>
  );
}

export function Review({ route }: { route: ReviewRoute }) {
  const { personId, meetingId } = route;
  const confirm = useConfirm();
  const [order, setOrder] = useState<ReviewOrder>(route.order ?? 'newest');
  const [notice, setNotice] = useState<string>();
  const wanted = useRef(route.lineId);
  wanted.current = route.lineId;
  /** A new order starts at its own first line, not at the card that was on screen. */
  const freshStart = useRef(false);
  const [queue, setQueue] = useState<ReviewQueueDto>();
  const [state, setState] = useState<ReviewState>();
  const [picker, setPicker] = useState<Picker>('closed');
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState('');
  /** Decisions on their way to the server, each one sent the moment it is made. */
  const sending = useRef(new Map<Entry, Promise<boolean>>());
  const [skippedMode, setSkippedMode] = useState(false);
  const [round, setRound] = useState(0);
  const exitTo = meetingId
    ? `#/meetings/${meetingId}`
    : personId
      ? `#/people/${personId}`
      : '#/people';

  useEffect(() => {
    let current = true;
    setQueue(undefined);
    setState(undefined);
    api
      .reviewQueue({
        ...(personId && { personId }),
        ...(meetingId && { meetingId }),
        order,
        ...(skippedMode && { skipped: true }),
      })
      .then(
        (loaded) => {
          if (!current) return;
          setQueue(loaded);
          const fresh = startReview(loaded.lines);
          const target = freshStart.current ? undefined : wanted.current;
          freshStart.current = false;
          const opened = target ? focusLine(fresh, target) : undefined;
          setNotice(
            target && !opened
              ? 'That line is no longer in the queue, so this is the next one.'
              : undefined,
          );
          setState(opened ?? fresh);
        },
        (failure: unknown) => {
          if (current) setError(errorMessage(failure));
        },
      );
    return () => {
      current = false;
    };
  }, [personId, meetingId, order, skippedMode, round]);

  /** Waits until every decision made so far has reached the server. */
  const flush = useCallback(async () => {
    await Promise.all(sending.current.values());
  }, []);

  /** Sends a decision at once. When it fails the line comes back for another look. */
  const send = useCallback((entry: Entry) => {
    const sent = commit(api, entry).then(
      () => true,
      (failure: unknown) => {
        setState((current) => (current ? restore(current, entry) : current));
        setError(`${errorMessage(failure)} The line is back for another look.`);
        return false;
      },
    );
    sending.current.set(entry, sent);
    void sent.then(() => {
      sending.current.delete(entry);
    });
    return sent;
  }, []);

  const line = state && currentLine(state);

  const onDecide = useCallback(
    (decision: Decision) => {
      if (!state || !line) return;
      const entry: Entry = { line, decision };
      setError(undefined);
      setNotice(undefined);
      setState(decide(state, decision));
      setPicker('closed');
      setMessage(describeDecision(entry));
      void send(entry);
    },
    [state, line, send],
  );

  // The address follows the card, replacing the entry so Back leaves the review and does not
  // walk through lines that are already decided.
  const lineId = line?.id;
  useEffect(() => {
    if (!state) return;
    const address = `#${buildReviewRoute({ personId, meetingId, order, lineId })}`;
    if (window.location.hash === address) return;
    window.history.replaceState(null, '', address);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [state === undefined, lineId, personId, meetingId, order]);

  // A card address pasted or reached with Back and Forward opens that card.
  useEffect(() => {
    if (!route.lineId || route.lineId === lineId) return;
    setState((current) => {
      if (!current) return current;
      const opened = focusLine(current, route.lineId ?? '');
      setNotice(
        opened ? undefined : 'That line is no longer in the queue, so this is the next one.',
      );
      return opened ?? current;
    });
  }, [route.lineId]);

  const last = state?.history.at(-1);
  const canUndo = last !== undefined;

  /** Takes the last decision back, also on the server, then shows the line again. */
  const onUndo = useCallback(async () => {
    if (!last) return;
    const entry = last;
    if (sending.current.has(entry) && !(await sending.current.get(entry))) return;
    try {
      await uncommit(api, entry);
    } catch (failure) {
      setError(errorMessage(failure));
      return;
    }
    setState((current) => (current?.history.at(-1) === entry ? undo(current) : current));
    setPicker('closed');
    setMessage('Undone.');
  }, [last]);

  /** Stops tracking the proposed person and takes all their lines out of this queue. */
  const untrack = useCallback(async () => {
    if (!line) return;
    const who = line.proposed;
    const confirmed = await confirm({
      title: `Stop tracking ${who.name}?`,
      body: (
        <p>
          Their saved voice samples and voice profile are deleted, and no voice is learned or
          suggested for them again. Their lines are no longer offered for review. {who.name} stays
          by name in every transcript and in the minutes. You can track them again on their page.
        </p>
      ),
      confirmLabel: 'Stop tracking',
      destructive: true,
    });
    if (!confirmed) return;
    await flush();
    try {
      await api.setTracking(who.id, 'off');
      setState((current) => (current ? dropPerson(current, who.id) : current));
      setPicker('closed');
      setMessage(`${who.name} is not tracked any more.`);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, [line, confirm, flush]);

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
      else void onUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [queue, line, picker, onDecide, onUndo, exit]);

  const done = state ? counts(state) : undefined;
  const hidden = queue && !skippedMode ? queue.skippedCount + (done?.skipped ?? 0) : 0;

  return (
    <>
      <a className="back-link" href={exitTo}>
        {meetingId ? 'Meeting' : personId ? 'Person' : 'People'}
      </a>
      <header className="page-head">
        <div>
          <h1>Review</h1>
          <p className="lede">
            One line at a time. Approve it, say who it was instead, or skip it. Skipped lines stay
            out of the way until you ask for them.
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
      <div className="review-controls">
        {(queue?.scope.person ?? queue?.scope.meeting) && (
          <span className="scope-chip">
            {queue.scope.person ? `Person: ${queue.scope.person.name}` : null}
            {queue.scope.meeting ? `Meeting: ${queue.scope.meeting.title}` : null}
            <a aria-label="Review everyone instead" href="#/people/review">
              &times;
            </a>
          </span>
        )}
        <label className="review-order">
          <span className="muted">Order</span>
          <select
            value={order}
            onChange={(e) => {
              void flush();
              freshStart.current = true;
              setOrder(e.target.value as ReviewOrder);
            }}
          >
            <option value="newest">Newest meetings first</option>
            <option value="uncertain">Least sure first</option>
          </select>
        </label>
      </div>
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
      {notice && (
        <p className="feedback" role="status">
          {notice}
        </p>
      )}
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
          onUndo={() => {
            void onUndo();
          }}
          onUntrack={() => {
            void untrack();
          }}
        />
      )}
      {queue && state && !line && done && (
        <div className="panel empty-state">
          <h3>
            {state.total === 0 ? 'Nothing to review' : queue.more > 0 ? 'Session done' : 'All done'}
          </h3>
          <p>
            {state.total === 0
              ? skippedMode
                ? 'No skipped lines are left.'
                : 'No lines need a look right now.'
              : `${String(done.approved)} approved, ${String(done.changed)} changed${done.skipped > 0 ? `, ${String(done.skipped)} skipped` : ''}.`}
          </p>
          {!skippedMode && queue.complete.length > 0 && (
            <ul className="muted">
              {queue.complete.map((person) => (
                <li key={`${person.id}|${person.language}`}>
                  Profile for {person.name} is good enough ({person.languageName}).
                </li>
              ))}
            </ul>
          )}
          <div className="review-end">
            {!skippedMode && queue.more > 0 && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void flush().then(() => {
                    setRound((n) => n + 1);
                  });
                }}
              >
                Keep going ({String(queue.more)} more)
              </button>
            )}
            {!skippedMode && hidden > 0 && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  void flush().then(() => {
                    setSkippedMode(true);
                    setMessage('Back to the skipped lines.');
                  });
                }}
              >
                Review {String(hidden)} skipped
              </button>
            )}
            {skippedMode && done.skipped > 0 && (
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
            {skippedMode && (
              <button
                type="button"
                onClick={() => {
                  setSkippedMode(false);
                }}
              >
                Back to the review
              </button>
            )}
            {canUndo && (
              <button
                type="button"
                onClick={() => {
                  void onUndo();
                }}
              >
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
