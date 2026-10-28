import { useCallback, useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import type { ReviewLineDto, ReviewOrder, ReviewQueueDto, ReviewVoiceDto } from '../../src/dto.js';
import { api, errorMessage, meetingUrl } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { formatDate, formatDuration } from '../format.js';
import { isTyping } from '../keyboard.js';
import {
  clickWord,
  commit,
  confidenceLabel,
  coverageLabel,
  counts,
  currentLine,
  cardPerson,
  decide,
  defaultPeople,
  describeDecision,
  dropPerson,
  everyoneOptions,
  focusLine,
  isVoiceCard,
  keyAction,
  optionKey,
  pick,
  position,
  restore,
  reviewSkipped,
  rosterOptions,
  splitIntoParts,
  splitOptions,
  startReview,
  uncommit,
  undo,
  undoable,
  type Decision,
  type Entry,
  type PickerOption,
  type ReviewState,
} from '../review.js';
import { buildReviewRoute, type ReviewRoute } from '../reviewRoute.js';
import { barPercent, reasonLabel } from '../people.js';
import { splitTimes } from '../../src/meetings/split-times.js';
import { splitWords } from '../speakerEdits.js';
import { SnippetPlayer } from '../SnippetPlayer.js';
import '../people.css';

type Picker = 'closed' | 'roster' | 'other' | 'new' | 'split';

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

function SplitPanel({
  line,
  people,
  onSplit,
  onCancel,
}: {
  line: ReviewLineDto;
  people: ReviewQueueDto['people'];
  onSplit: (decision: Decision) => void;
  onCancel: () => void;
}) {
  const words = useMemo(() => splitWords(line.text), [line.text]);
  const proposed = useMemo<PickerOption>(
    () => ({ personId: line.proposed.id, name: line.proposed.name }),
    [line.proposed],
  );
  const roster = useMemo(
    () => rosterOptions(line.roster, people, line.proposed.id),
    [line.roster, people, line.proposed.id],
  );
  const options = useMemo(() => splitOptions(proposed, roster), [proposed, roster]);
  const [cuts, setCuts] = useState<number[]>([]);
  const [again, setAgain] = useState(false);
  const [chosen, setChosen] = useState<Record<number, string>>({});
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, [line.id]);

  const parts = splitIntoParts(words, cuts);
  const defaults = defaultPeople(proposed, roster, parts.length);
  const who = defaults.map(
    (fallback, i) => options.find((o) => optionKey(o) === chosen[i]) ?? fallback,
  );
  const times = cuts.length > 0 ? splitTimes(line, cuts) : [];
  const partOf = (index: number) => cuts.filter((cut) => cut <= index).length;
  const full = cuts.length >= 2;
  const hint =
    cuts.length === 0
      ? line.reason === 'mixed'
        ? 'This line probably has two speakers. Click the first word of the second speaker.'
        : 'Click the first word of the second speaker.'
      : again
        ? 'Click the first word of the third part.'
        : 'Click another word to move the split.';

  return (
    <div className="review-picker review-split" role="group" aria-label="Split line">
      <h3>Split this line</h3>
      <p className="muted split-hint">{hint}</p>
      <p className="split-words review-split-words">
        {words.map((word, index) => (
          <button
            key={index}
            type="button"
            ref={index === 0 ? first : undefined}
            className={`split-chip part-${String(partOf(index))}`}
            data-cut={cuts.includes(index) || undefined}
            aria-pressed={cuts.includes(index)}
            disabled={index === 0}
            onClick={() => {
              setCuts(clickWord(cuts, index, again));
              setAgain(false);
            }}
          >
            {word}
          </button>
        ))}
      </p>
      {cuts.length > 0 && (
        <ol className="review-parts">
          {parts.map((part, index) => {
            const key = `part-${String(index)}`;
            const time = times[index];
            return (
              <li key={key} className={`part-${String(index)}`}>
                <label className="field">
                  <span>
                    Part {String(index + 1)}
                    {time && <span className="muted"> · about {formatDuration(time.startMs)}</span>}
                  </span>
                  <select
                    value={optionKey(who[index] ?? proposed)}
                    onChange={(e) => {
                      setChosen({ ...chosen, [index]: e.target.value });
                    }}
                  >
                    {options.map((option) => (
                      <option key={optionKey(option)} value={optionKey(option)}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="review-part-text muted">{part.join(' ')}</span>
              </li>
            );
          })}
        </ol>
      )}
      {options.length < 2 && (
        <p className="muted">
          Nobody else is listed for this meeting, so every part goes to {proposed.name}.
        </p>
      )}
      <div className="review-picker-more">
        <button
          type="button"
          className="primary"
          disabled={cuts.length === 0}
          onClick={() => {
            onSplit({ kind: 'split', cuts, people: who });
          }}
        >
          Split line
        </button>
        <button
          type="button"
          disabled={cuts.length === 0 || full}
          aria-pressed={again}
          onClick={() => {
            setAgain(!again);
          }}
        >
          Split again
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function VoicePicker({
  voice,
  people,
  onPick,
  onCancel,
}: {
  voice: ReviewVoiceDto;
  people: ReviewQueueDto['people'];
  onPick: (option: PickerOption) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const everyone = useMemo(
    () => everyoneOptions(people, voice.person.id, query),
    [people, voice.person.id, query],
  );
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    search.current?.focus();
  }, []);
  return (
    <div
      className="review-picker"
      role="group"
      aria-label={`Who is this voice instead of ${voice.person.name}`}
    >
      <h3>Who is this voice?</h3>
      <label className="field">
        <span>Search people</span>
        <input
          type="search"
          ref={search}
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
        <button type="button" className="link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function VoiceCard({
  voice,
  queue,
  picker,
  setPicker,
  onDecide,
  canUndo,
  onUndo,
  onUntrack,
}: {
  voice: ReviewVoiceDto;
  queue: ReviewQueueDto;
  picker: Picker;
  setPicker: (picker: Picker) => void;
  onDecide: (decision: Decision) => void;
  canUndo: boolean;
  onUndo: () => void;
  onUntrack: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const someoneElse = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    heading.current?.focus();
  }, [voice.id]);
  useEffect(() => {
    if (picker === 'closed' && wasOpen.current) someoneElse.current?.focus();
    wasOpen.current = picker !== 'closed';
  }, [picker]);

  return (
    <section className="panel review-card review-voice" aria-labelledby="review-quote">
      <div className="card-body">
        <h2 id="review-quote" className="review-quote" tabIndex={-1} ref={heading}>
          This voice is labelled {voice.person.name} but does not match their profile. Is it them?
        </h2>
        <p className="muted">
          <a href={`#/meetings/${voice.meetingId}`}>{voice.meetingTitle}</a>
          {' · '}
          {formatDate(voice.meetingDate)}
          {' · '}
          {String(barPercent(voice.mismatch))}% of this voice did not match
        </p>
        <ul className="review-voice-lines">
          {voice.lines
            .filter((item) => item.hasAudio)
            .map((item) => (
              <li key={item.id}>
                <SnippetPlayer
                  key={item.id}
                  audioUrl={meetingUrl(voice.meetingId, 'audio')}
                  label={item.text}
                  snippets={[{ startMs: item.startMs, endMs: item.endMs, text: item.text }]}
                />
              </li>
            ))}
        </ul>
        {voice.lines.every((item) => !item.hasAudio) && (
          <p className="muted">There is no audio to play for this meeting.</p>
        )}
        {picker !== 'closed' && (
          <VoicePicker
            voice={voice}
            people={queue.people}
            onPick={(option) => {
              onDecide(pick(option));
            }}
            onCancel={() => {
              setPicker('closed');
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
            ref={someoneElse}
            className="danger"
            onClick={() => {
              setPicker('other');
            }}
          >
            No, someone else <Key>D</Key>
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onDecide({ kind: 'confirm' });
            }}
          >
            Yes, it is them <Key>A</Key>
          </button>
        </footer>
      )}
      <div className="review-undo">
        <button type="button" className="link quiet" onClick={onUntrack}>
          Do not track {voice.person.name}
        </button>
        <button type="button" className="link" disabled={!canUndo} onClick={onUndo}>
          Undo last <Key>U</Key>
        </button>
      </div>
    </section>
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
  const splitButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    heading.current?.focus();
  }, [line.id]);
  useEffect(() => {
    if (picker === 'closed' && wasOpen.current) {
      (line.reason === 'mixed' ? splitButton : disapprove).current?.focus();
    }
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
              {line.reason === 'mixed'
                ? ''
                : `${line.why === 'training' ? 'Needs more samples' : 'Not sure who this is'}: `}
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
        {picker === 'split' && (
          <SplitPanel
            line={line}
            people={queue.people}
            onSplit={onDecide}
            onCancel={() => {
              setPicker('closed');
            }}
          />
        )}
        {picker !== 'closed' && picker !== 'split' && (
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
          <button
            type="button"
            ref={splitButton}
            className="split-action"
            onClick={() => {
              setPicker('split');
            }}
          >
            Split line <Key>X</Key>
          </button>
          <button
            type="button"
            className="span-2"
            title="Two speakers in one line: keep the label, never train a voice on it"
            onClick={() => {
              onDecide({ kind: 'mixed' });
            }}
          >
            Mixed, skip for training <Key>M</Key>
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
  const wanted = useRef(route);
  wanted.current = route;
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
          const fresh = startReview([...loaded.voices, ...loaded.lines]);
          const want = freshStart.current ? undefined : wanted.current;
          freshStart.current = false;
          const target = want?.voiceId ?? want?.lineId;
          const opened = target ? focusLine(fresh, target, want?.voiceId !== undefined) : undefined;
          setNotice(
            target && !opened
              ? 'That card is no longer in the queue, so this is the next one.'
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

  const card = state && currentLine(state);
  const line = card && !isVoiceCard(card) ? card : undefined;
  const voice = card && isVoiceCard(card) ? card : undefined;
  const lineId = line?.id;
  const voiceId = voice?.id;
  const probablyMixed = line?.reason === 'mixed';
  // A line the voice guard thinks holds two speakers opens with the split already chosen.
  useEffect(() => {
    setPicker(probablyMixed ? 'split' : 'closed');
  }, [lineId, voiceId, probablyMixed]);

  const onDecide = useCallback(
    (decision: Decision) => {
      if (!state || !card) return;
      const entry: Entry = { line: card, decision };
      setError(undefined);
      setNotice(undefined);
      setState(decide(state, decision));
      setPicker('closed');
      setMessage(describeDecision(entry));
      void send(entry);
    },
    [state, card, send],
  );

  // The address follows the card, replacing the entry so Back leaves the review and does not
  // walk through lines that are already decided.
  useEffect(() => {
    if (!state) return;
    const address = `#${buildReviewRoute({ personId, meetingId, order, lineId, voiceId })}`;
    if (window.location.hash === address) return;
    window.history.replaceState(null, '', address);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, [state === undefined, lineId, voiceId, personId, meetingId, order]);

  // A card address pasted or reached with Back and Forward opens that card.
  useEffect(() => {
    const wantedId = route.voiceId ?? route.lineId;
    if (!wantedId || wantedId === card?.id) return;
    setState((current) => {
      if (!current) return current;
      const opened = focusLine(current, wantedId, route.voiceId !== undefined);
      setNotice(
        opened ? undefined : 'That card is no longer in the queue, so this is the next one.',
      );
      return opened ?? current;
    });
  }, [route.lineId, route.voiceId]);

  const last = state?.history.at(-1);
  const canUndo = last !== undefined && undoable(last);

  /** Takes the last decision back, also on the server, then shows the line again. */
  const onUndo = useCallback(async () => {
    if (!last || !undoable(last)) return;
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
    if (!card) return;
    const who = cardPerson(card);
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
  }, [card, confirm, flush]);

  const exit = useCallback(() => {
    void flush().then(() => {
      window.location.hash = exitTo;
    });
  }, [flush, exitTo]);

  useEffect(() => {
    if (!queue || !card) return;
    const roster = line ? rosterOptions(line.roster, queue.people, line.proposed.id) : [];
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== 'Escape' && isTyping(event.target)) return;
      const action = keyAction(
        event.key,
        picker === 'closed'
          ? 'closed'
          : picker === 'roster'
            ? 'roster'
            : picker === 'split'
              ? 'split'
              : 'other',
      );
      if (!action) return;
      if (voice && (action === 'split' || action === 'mixed')) return;
      event.preventDefault();
      if (typeof action === 'object') {
        const option = roster[action.pick];
        if (option) onDecide(pick(option));
      } else if (action === 'exit') {
        if (picker === 'closed') exit();
        else setPicker('closed');
      } else if (action === 'approve') onDecide({ kind: voice ? 'confirm' : 'approve' });
      else if (action === 'skip') onDecide({ kind: 'skip' });
      else if (action === 'disapprove') setPicker(voice ? 'other' : 'roster');
      else if (action === 'split') setPicker('split');
      else if (action === 'mixed') onDecide({ kind: 'mixed' });
      else void onUndo();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [queue, card, line, voice, picker, onDecide, onUndo, exit]);

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
            One line at a time. Approve it, say who it was instead, split it when two people spoke,
            or skip it. Skipped lines stay out of the way until you ask for them.
            {queue &&
              !queue.learning &&
              ' Voice learning is off, so approving only confirms who said the line.'}
          </p>
        </div>
        {state && state.total > 0 && (
          <p className="review-progress muted">
            {card ? `${String(position(state))} of ${String(state.total)}` : 'Finished'}
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
      {queue && state && voice && (
        <VoiceCard
          voice={voice}
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
      {queue && state && !card && done && (
        <div className="panel empty-state">
          <h3>
            {state.total === 0 ? 'Nothing to review' : queue.more > 0 ? 'Session done' : 'All done'}
          </h3>
          <p>
            {state.total === 0
              ? skippedMode
                ? 'No skipped lines are left.'
                : 'No lines need a look right now.'
              : `${String(done.approved)} approved, ${String(done.changed)} changed${done.mixed > 0 ? `, ${String(done.mixed)} marked mixed` : ''}${done.skipped > 0 ? `, ${String(done.skipped)} skipped` : ''}.`}
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
