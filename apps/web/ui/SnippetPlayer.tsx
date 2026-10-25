import { useEffect, useRef, useState } from 'react';
import type { VoiceSnippetDto } from '../src/dto.js';
import { formatDuration } from './format.js';

const MAX_PLAY_MS = 5000;

let playing: HTMLAudioElement | undefined;

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
  const [active, setActive] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const snippet = snippets[index];

  const stop = () => {
    audio.current?.pause();
    setActive(false);
  };

  useEffect(() => stop, []);

  if (!snippet) return null;
  const keepFocus = (event: { preventDefault: () => void }) => {
    event.preventDefault();
  };

  const play = () => {
    const element = audio.current;
    if (!element) return;
    if (playing && playing !== element) playing.pause();
    playing = element;
    const endsAt = Math.min(snippet.endMs, snippet.startMs + MAX_PLAY_MS) / 1000;
    const start = () => {
      element.currentTime = snippet.startMs / 1000;
      element.play().then(
        () => {
          setActive(true);
        },
        () => {
          setActive(false);
        },
      );
    };
    element.ontimeupdate = () => {
      if (element.currentTime >= endsAt) stop();
    };
    element.onended = stop;
    if (element.readyState >= 1) start();
    else {
      element.onloadedmetadata = start;
      element.load();
    }
  };

  const move = (step: number) => {
    stop();
    setIndex((index + step + snippets.length) % snippets.length);
  };

  return (
    <div className="snippet" aria-label={`Listen to ${label}`}>
      <audio ref={audio} src={audioUrl} preload="none" />
      <button
        type="button"
        className="snippet-play"
        aria-pressed={active}
        aria-label={active ? 'Stop' : 'Play a few seconds'}
        onMouseDown={keepFocus}
        onClick={active ? stop : play}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          {active ? (
            <rect x="3" y="3" width="10" height="10" rx="1.5" />
          ) : (
            <path d="M3.5 1.8v12.4a.6.6 0 0 0 .9.5l10-6.2a.6.6 0 0 0 0-1L4.4 1.3a.6.6 0 0 0-.9.5z" />
          )}
        </svg>
        <span className="mono">{formatDuration(snippet.startMs)}</span>
        <span className="truncate">{snippet.text}</span>
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
    </div>
  );
}
