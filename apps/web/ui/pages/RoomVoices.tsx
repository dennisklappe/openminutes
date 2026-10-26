import { useCallback, useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import type { RoomReviewDto, RoomVoiceDto } from '../../src/dto.js';
import { api, errorMessage, meetingUrl } from '../api.js';
import { formatDuration } from '../format.js';
import { everyoneOptions, rosterOptions, type PickerOption } from '../review.js';
import { SnippetPlayer } from '../SnippetPlayer.js';
import '../people.css';

type Mode = 'roster' | 'other' | 'new';

const SHOWN = 50;

function WhoIsThis({
  review,
  voice,
  busy,
  onPick,
}: {
  review: RoomReviewDto;
  voice: RoomVoiceDto;
  busy: boolean;
  onPick: (option: PickerOption) => void;
}) {
  const [mode, setMode] = useState<Mode>('roster');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const roster = useMemo(() => rosterOptions(review.roster, review.people, ''), [review]);
  const everyone = useMemo(() => everyoneOptions(review.people, '', query), [review, query]);
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
    <div className="review-picker" role="group" aria-label={`Who is voice ${String(voice.number)}`}>
      <h3>Who is this?</h3>
      {mode === 'roster' && (
        <>
          {roster.length === 0 ? (
            <p className="muted">Nobody else is listed for this meeting.</p>
          ) : (
            <ul className="review-options">
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

function VoiceCard({
  review,
  voice,
  busy,
  onPick,
}: {
  review: RoomReviewDto;
  voice: RoomVoiceDto;
  busy: boolean;
  onPick: (voice: RoomVoiceDto, option: PickerOption) => void;
}) {
  const named = voice.personId !== null;
  return (
    <section
      className="panel review-card room-voice"
      aria-labelledby={`room-voice-${voice.id}`}
      data-named={named || undefined}
    >
      <div className="card-body">
        <h2 id={`room-voice-${voice.id}`} className="room-voice-title">
          Voice {voice.number}
          {named && <span className="muted"> · {voice.personName}</span>}
        </h2>
        <p className="muted">
          {voice.lines} {voice.lines === 1 ? 'line' : 'lines'} · {formatDuration(voice.durationMs)}{' '}
          of clear speech
        </p>
        {review.hasAudio && voice.snippets.length > 0 && (
          <SnippetPlayer
            audioUrl={meetingUrl(review.meetingId, 'audio')}
            label={`Voice ${String(voice.number)}`}
            snippets={voice.snippets}
          />
        )}
        {!review.hasAudio && voice.snippets.length > 0 && (
          <ul className="room-quotes muted">
            {voice.snippets.map((snippet) => (
              <li key={snippet.startMs}>{snippet.text}</li>
            ))}
          </ul>
        )}
        {!named && (
          <WhoIsThis
            review={review}
            voice={voice}
            busy={busy}
            onPick={(option) => {
              onPick(voice, option);
            }}
          />
        )}
      </div>
    </section>
  );
}

/** Names the voices found in one participant tile that probably holds several people. */
export function RoomVoices({
  meetingId,
  participantId,
}: {
  meetingId: string;
  participantId: string;
}) {
  const [review, setReview] = useState<RoomReviewDto>();
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState('');
  const back = `#/meetings/${meetingId}`;

  const load = useCallback(() => {
    api.roomReview(meetingId, participantId).then(setReview, (failure: unknown) => {
      if (failure instanceof Error && 'status' in failure && failure.status === 404) {
        setMissing(true);
      } else setError(errorMessage(failure));
    });
  }, [meetingId, participantId]);
  useEffect(load, [load]);

  const name = (voice: RoomVoiceDto, option: PickerOption) => {
    setBusy(true);
    setError(undefined);
    api
      .nameRoomVoice(
        meetingId,
        voice.id,
        option.personId ? { personId: option.personId } : { newName: option.name },
      )
      .then(
        () => {
          setMessage(`Voice ${String(voice.number)} is now ${option.name}.`);
          load();
        },
        (failure: unknown) => {
          setError(errorMessage(failure));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  const onePerson = () => {
    setBusy(true);
    setError(undefined);
    api.dismissRoom(meetingId, participantId).then(
      () => {
        window.location.hash = back;
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
        setBusy(false);
      },
    );
  };

  const open = review?.voices.filter((voice) => voice.personId === null) ?? [];
  const anyNamed = review?.voices.some((voice) => voice.personId !== null) ?? false;
  return (
    <>
      <a className="back-link" href={back}>
        Meeting
      </a>
      <header className="page-head">
        <div>
          <h1>{review ? `Who is in ${review.participant.name}?` : 'Voices'}</h1>
          <p className="lede">
            This participant has several voices, probably several people in front of one screen.
            Listen to a few lines of each and say who it is. Nothing in the transcript changes until
            you name a voice.
            {review &&
              !review.learning &&
              ' Voice learning is off, so naming a voice only labels its lines.'}
          </p>
        </div>
      </header>
      <div className="visually-hidden" role="status" aria-live="polite">
        {message}
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {missing && (
        <div className="panel empty-state">
          <h3>No shared voices here</h3>
          <p>This participant has no voices to name, or it was marked as one person.</p>
          <div className="review-end">
            <a className="button" href={back}>
              Back to the meeting
            </a>
          </div>
        </div>
      )}
      {review?.voices.map((voice) => (
        <VoiceCard key={voice.id} review={review} voice={voice} busy={busy} onPick={name} />
      ))}
      {review && (
        <div className="review-end">
          {open.length === 0 && (
            <a className="button primary" href={back}>
              All named, back to the meeting
            </a>
          )}
          {open.length > 0 && !anyNamed && (
            <button type="button" disabled={busy} onClick={onePerson}>
              It is one person
            </button>
          )}
          {open.length > 0 && (
            <a className="button" href={back}>
              Not now
            </a>
          )}
        </div>
      )}
    </>
  );
}
