import { useState, type SyntheticEvent } from 'react';
import type { MeetingDto } from '../src/dto.js';
import { api, ApiError, errorMessage } from './api.js';
import { LinkIcon } from './icons.js';

export function JoinBox({ onJoined }: { onJoined: (meeting: MeetingDto) => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(false);

  const join = (force: boolean) => {
    setBusy(true);
    api.join(url, force).then(
      (meeting) => {
        setBusy(false);
        setUrl('');
        setError(undefined);
        setDuplicate(false);
        onJoined(meeting);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
        setDuplicate(failure instanceof ApiError && failure.status === 409);
      },
    );
  };

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    join(false);
  };

  return (
    <form className="join" onSubmit={submit}>
      <div className="join-bar">
        <LinkIcon />
        <input
          type="url"
          required
          placeholder="Paste a Meet or Teams link"
          aria-label="Meeting link"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
        />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? (
            'Joining'
          ) : (
            <>
              Join<span className="wide"> meeting</span>
            </>
          )}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {duplicate && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            join(true);
          }}
        >
          Join anyway
        </button>
      )}
    </form>
  );
}
