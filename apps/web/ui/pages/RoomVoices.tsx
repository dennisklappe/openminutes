import { useCallback, useEffect, useState } from 'react';
import type { RoomReviewDto, RoomVoiceDto } from '../../src/dto.js';
import { api, errorMessage, meetingUrl } from '../api.js';
import { formatDuration } from '../format.js';
import { Dialog } from '../Dialog.js';
import { VoiceFlow } from '../participants/VoiceFlow.js';
import { SnippetPlayer } from '../SnippetPlayer.js';
import '../people.css';

function VoiceCard({
  review,
  voice,
  onChanged,
}: {
  review: RoomReviewDto;
  voice: RoomVoiceDto;
  onChanged: (message: string) => void;
}) {
  const named = !voice.unnamed;
  const [changing, setChanging] = useState(false);
  const label = `Voice ${String(voice.number)}`;
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
          <VoiceFlow
            meetingId={review.meetingId}
            tileId={review.participant.id}
            voiceId={voice.id}
            label={label}
            onDone={() => {
              onChanged(`${label} is named.`);
            }}
          />
        )}
        {named && voice.personId && voice.personName && (
          <div className="review-picker-more">
            <button
              type="button"
              onClick={() => {
                setChanging(true);
              }}
            >
              Change who this is
            </button>
          </div>
        )}
        {changing && voice.personId && voice.personName && (
          <Dialog
            title={`Change who ${label} is`}
            onClose={() => {
              setChanging(false);
            }}
          >
            <p className="muted">
              Use this when the voice was given to the wrong person. This voice is named already.
            </p>
            <VoiceFlow
              meetingId={review.meetingId}
              tileId={review.participant.id}
              voiceId={voice.id}
              label={label}
              from={{ personId: voice.personId, name: voice.personName }}
              onCancel={() => {
                setChanging(false);
              }}
              onDone={() => {
                setChanging(false);
                onChanged(`${label} was changed.`);
              }}
            />
          </Dialog>
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

  const changed = (text: string) => {
    setMessage(text);
    load();
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

  const open = review?.voices.filter((voice) => voice.unnamed) ?? [];
  const anyNamed = review?.voices.some((voice) => !voice.unnamed) ?? false;
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
            Each voice is already its own person in the meeting. Listen to a few lines of each and
            say who it is, or leave it as it is and name it later from the People card.
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
        <VoiceCard key={voice.id} review={review} voice={voice} onChanged={changed} />
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
