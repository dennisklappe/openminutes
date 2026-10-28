import type { ReactNode, SubmitEventHandler } from 'react';
import { formatDuration, formatLength } from './format.js';
import { useClip } from './useClip.js';

export interface VoiceSample {
  /** The transcript segment, when the sample can be shown in the transcript. */
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
}

function Sample(props: {
  sample: VoiceSample;
  label: string;
  audioUrl?: string | undefined;
  onShowLine?: ((segmentId: string) => void) | undefined;
}) {
  const { sample, label, audioUrl, onShowLine } = props;
  const { audio, active, play, stop } = useClip(sample, sample.endMs - sample.startMs);
  const id = sample.id;
  return (
    <li className="voice-sample">
      {audioUrl && (
        <>
          <audio ref={audio} src={audioUrl} preload="none" />
          <button
            type="button"
            className="voice-sample-play"
            aria-pressed={active}
            aria-label={`${active ? 'Stop' : 'Play'} ${label} at ${formatDuration(sample.startMs)}`}
            onClick={active ? stop : play}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {active ? (
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
              ) : (
                <path d="M3.5 1.8v12.4a.6.6 0 0 0 .9.5l10-6.2a.6.6 0 0 0 0-1L4.4 1.3a.6.6 0 0 0-.9.5z" />
              )}
            </svg>
            <span className="mono">{formatDuration(sample.startMs)}</span>
          </button>
        </>
      )}
      <p>
        {!audioUrl && <span className="mono muted">{formatDuration(sample.startMs)} </span>}
        {sample.text}
      </p>
      {onShowLine && id && (
        <button
          type="button"
          className="voice-sample-show"
          onClick={() => {
            onShowLine(id);
          }}
        >
          Show in transcript
        </button>
      )}
    </li>
  );
}

/** A few lines of one voice, each playable from the meeting audio when there is any. */
export function VoiceSamples(props: {
  samples: readonly VoiceSample[];
  label: string;
  audioUrl?: string | undefined;
  onShowLine?: ((segmentId: string) => void) | undefined;
}) {
  const { samples, label, audioUrl, onShowLine } = props;
  if (samples.length === 0) return <p className="muted">No clear line to play for this voice.</p>;
  return (
    <>
      <p className="muted">{audioUrl ? 'Listen to this voice' : 'What this voice said'}</p>
      <ul className="voice-samples">
        {samples.map((sample) => (
          <Sample
            key={`${sample.id ?? ''}-${String(sample.startMs)}`}
            sample={sample}
            label={label}
            audioUrl={audioUrl}
            onShowLine={onShowLine}
          />
        ))}
      </ul>
      {!audioUrl && (
        <p className="muted">The audio was deleted, so these lines cannot be played.</p>
      )}
    </>
  );
}

export interface VoiceChip {
  key: string;
  name: string;
  /** The small line under the name, like "Invited". */
  note: string;
  pressed: boolean;
  label?: string;
}

/** Names to pick with one tap: the invited people or the suggestions for a voice. */
export function VoiceChips(props: {
  label: string;
  chips: readonly VoiceChip[];
  onPick: (key: string) => void;
}) {
  return (
    <ul className="chips" aria-label={props.label}>
      {props.chips.map((chip) => (
        <li key={chip.key}>
          <button
            type="button"
            className="chip"
            aria-pressed={chip.pressed}
            {...(chip.label && { 'aria-label': chip.label })}
            onClick={() => {
              props.onPick(chip.key);
            }}
          >
            {chip.name}
            <small>{chip.note}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface FrameProps {
  /** A form when the card saves by itself, a list item when the list has one Confirm. */
  as: 'form' | 'li';
  slot: number;
  label: string;
  durationMs: number;
  badge?: ReactNode;
  onSubmit?: SubmitEventHandler<HTMLFormElement>;
  children: ReactNode;
}

/** The card every voice is shown in: colour dot, name, time spoken, then its content. */
export function VoiceFrame({ as, slot, label, durationMs, badge, onSubmit, children }: FrameProps) {
  const body = (
    <>
      <header>
        <i className="voice-dot" aria-hidden="true" />
        <strong className="truncate">{label}</strong>
        <span className="muted">{formatLength(durationMs)} speaking</span>
        {badge}
      </header>
      {children}
    </>
  );
  return as === 'form' ? (
    <form className="voice" data-speaker-slot={slot} onSubmit={onSubmit}>
      {body}
    </form>
  ) : (
    <li className="voice" data-speaker-slot={slot}>
      {body}
    </li>
  );
}
