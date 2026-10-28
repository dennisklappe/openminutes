import { useState } from 'react';
import type { VoiceSnippetDto } from '../src/dto.js';
import { formatDuration } from './format.js';
import { useClip } from './useClip.js';

export const MAX_PLAY_MS = 5000;

interface Props {
  audioUrl: string;
  label: string;
  snippets: VoiceSnippetDto[];
}

/**
 * Plays a few seconds of one voice in place. It has its own audio element, so the main player,
 * the scroll position and the focus (the name field the user is typing in) stay where they are.
 */
export function SnippetPlayer({ audioUrl, label, snippets }: Props) {
  const [index, setIndex] = useState(0);
  const snippet = snippets[index];
  const { active, loading, error, play, stop } = useClip(snippet, audioUrl, MAX_PLAY_MS);

  if (!snippet) return null;
  const keepFocus = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };

  const move = (step: number) => {
    stop();
    setIndex((index + step + snippets.length) % snippets.length);
  };

  return (
    <div className="snippet" aria-label={`Listen to ${label}`}>
      <button
        type="button"
        className="snippet-play"
        aria-pressed={active}
        aria-busy={loading}
        aria-label={active || loading ? 'Stop' : 'Play a few seconds'}
        onMouseDown={keepFocus}
        onClick={active || loading ? stop : play}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {active || loading ? (
            <rect x="3" y="3" width="10" height="10" rx="1.5" />
          ) : (
            <path d="M3.5 1.8v12.4a.6.6 0 0 0 .9.5l10-6.2a.6.6 0 0 0 0-1L4.4 1.3a.6.6 0 0 0-.9.5z" />
          )}
        </svg>
        <span className="mono">{formatDuration(snippet.startMs)}</span>
        <span className="truncate">{loading ? 'Loading...' : snippet.text}</span>
      </button>
      {snippets.length > 1 && (
        <span className="snippet-nav">
          <button
            type="button"
            aria-label="Previous sample"
            onMouseDown={keepFocus}
            onClick={() => {
              move(-1);
            }}
          >
            ‹
          </button>
          <small className="muted">
            {index + 1}/{snippets.length}
          </small>
          <button
            type="button"
            aria-label="Next sample"
            onMouseDown={keepFocus}
            onClick={() => {
              move(1);
            }}
          >
            ›
          </button>
        </span>
      )}
      {error && <ClipError message={error} onRetry={play} />}
    </div>
  );
}

/** Says why a clip did not start and offers another try. */
export function ClipError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <span className="snippet-error" role="alert">
      {message}{' '}
      <button type="button" className="link" onClick={onRetry}>
        Retry
      </button>
    </span>
  );
}
