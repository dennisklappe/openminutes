import { useCallback, useEffect, useState } from 'react';
import type { CheckOptionDto, CheckPeopleDto, CheckSampleDto, CheckVoiceDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import {
  canConfirm,
  companyText,
  confirmInput,
  headline,
  initialChoices,
  matchText,
  optionChoice,
  type Choice,
} from './checkPeople.js';
import { formatDuration, formatLength } from './format.js';
import { Menu, type MenuItem } from './Menu.js';
import { useClip } from './useClip.js';
import { NAME_MAX } from './voices.js';
import './voices.css';

interface Props {
  meetingId: string;
  /** Looks again when the transcript changed, for instance after a re-run. */
  transcriptSize: number;
  /** The ways to change the number of people, from the re-run speakers flow of the page. */
  countItems: MenuItem[];
  onChanged: () => void;
  /** Tells the page whether the card is up, so it can keep "Who is who?" out of the way. */
  onShown?: (shown: boolean) => void;
  /** The audio of the meeting, left out when it was deleted: the lines then show as text only. */
  audioUrl?: string | undefined;
  /** Jumps the transcript to a line. */
  onShowLine?: ((segmentId: string) => void) | undefined;
}

const NEW = 'new';

function Sample(props: {
  sample: CheckSampleDto;
  label: string;
  audioUrl?: string | undefined;
  onShowLine?: ((segmentId: string) => void) | undefined;
}) {
  const { sample, label, audioUrl, onShowLine } = props;
  const { audio, active, play, stop } = useClip(sample, sample.endMs - sample.startMs);
  return (
    <li className="check-sample">
      {audioUrl && (
        <>
          <audio ref={audio} src={audioUrl} preload="none" />
          <button
            type="button"
            className="check-sample-play"
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
      {onShowLine && (
        <button
          type="button"
          className="check-sample-show"
          onClick={() => {
            onShowLine(sample.id);
          }}
        >
          Show in transcript
        </button>
      )}
    </li>
  );
}

function VoiceChoice(props: {
  voice: CheckVoiceDto;
  options: CheckOptionDto[];
  choice: Choice;
  onChoice: (choice: Choice) => void;
  audioUrl?: string | undefined;
  onShowLine?: ((segmentId: string) => void) | undefined;
}) {
  const { voice, options, choice, onChoice, audioUrl, onShowLine } = props;
  const [changing, setChanging] = useState(!voice.match);
  const { match } = voice;
  const nameId = `check-name-${voice.id}`;
  const picked =
    choice.kind === 'person' ? choice.name : choice.kind === 'new' ? undefined : match?.name;
  const company = choice.kind === 'match' && match ? companyText(match) : undefined;

  const pick = (value: string) => {
    if (value === NEW) {
      onChoice({ kind: 'new', name: '' });
      return;
    }
    if (value === '') {
      onChoice(match ? { kind: 'match' } : { kind: 'none' });
      return;
    }
    const option = options[Number(value)];
    if (option) onChoice(optionChoice(option));
  };

  return (
    <li className="check-voice">
      <header>
        <strong>{voice.label}</strong>
        <span className="muted">{formatLength(voice.durationMs)} speaking</span>
      </header>
      {picked && (
        <div className="check-pick">
          {choice.kind === 'match' && match ? (
            <p>{matchText(match)}</p>
          ) : (
            <p>
              <strong>{picked}</strong>
            </p>
          )}
          {match?.onCalendar && choice.kind === 'match' && (
            <p className="muted">On the invitation</p>
          )}
          {company && <p className="muted">{company}</p>}
        </div>
      )}
      {!picked && choice.kind === 'none' && <p className="muted">Nobody matched this voice.</p>}
      {voice.samples.length > 0 ? (
        <>
          <p className="muted">{audioUrl ? 'Listen to this voice' : 'What this voice said'}</p>
          <ul className="check-samples">
            {voice.samples.map((sample) => (
              <Sample
                key={sample.id}
                sample={sample}
                label={voice.label}
                audioUrl={audioUrl}
                onShowLine={onShowLine}
              />
            ))}
          </ul>
          {!audioUrl && (
            <p className="muted">The audio was deleted, so these lines cannot be played.</p>
          )}
        </>
      ) : (
        <p className="muted">No clear line to play for this voice.</p>
      )}
      {!changing && (
        <p>
          <button
            type="button"
            onClick={() => {
              setChanging(true);
            }}
          >
            Change this person
          </button>
        </p>
      )}
      {changing && (
        <div className="check-fields">
          <select
            aria-label={`Who is ${voice.label}?`}
            value={choice.kind === 'new' ? NEW : ''}
            onChange={(e) => {
              pick(e.target.value);
            }}
          >
            <option value="">{match ? `Keep ${match.name}` : 'Pick a person'}</option>
            {options.map((option, index) => (
              <option key={`${option.source}-${option.email ?? option.name}`} value={String(index)}>
                {option.name}
                {option.source === 'calendar' ? ' (invited)' : ''}
              </option>
            ))}
            <option value={NEW}>New person...</option>
          </select>
          {choice.kind === 'new' && (
            <>
              <input
                id={nameId}
                aria-label="Name"
                value={choice.name}
                maxLength={NAME_MAX}
                placeholder="Name"
                autoComplete="off"
                onChange={(e) => {
                  onChoice({ ...choice, name: e.target.value });
                }}
              />
              <input
                aria-label="Email (optional)"
                type="email"
                value={choice.email ?? ''}
                placeholder="Email (optional)"
                autoComplete="off"
                onChange={(e) => {
                  onChoice({ ...choice, email: e.target.value });
                }}
              />
            </>
          )}
        </div>
      )}
      {changing && !match && voice.attendees.length > 0 && (
        <ul className="chips" aria-label="Invited to this meeting, tap one to pick them">
          {voice.attendees.map((attendee) => (
            <li key={attendee.email ?? attendee.name}>
              <button
                type="button"
                className="chip"
                aria-pressed={choice.kind !== 'none' && picked === attendee.name}
                aria-label={`${attendee.name}, invited`}
                onClick={() => {
                  onChoice(optionChoice(attendee));
                }}
              >
                {attendee.name}
                <small>Invited</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function CheckPeople({
  meetingId,
  transcriptSize,
  countItems,
  onChanged,
  onShown,
  audioUrl,
  onShowLine,
}: Props) {
  const [data, setData] = useState<CheckPeopleDto>();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(() => {
    api.checkPeople(meetingId).then(
      (loaded) => {
        setData(loaded);
        setChoices(initialChoices(loaded.voices));
      },
      () => {
        setData(undefined);
      },
    );
  }, [meetingId]);
  useEffect(load, [load, transcriptSize]);

  const shown = data?.show === true;
  useEffect(() => {
    onShown?.(shown);
  }, [shown, onShown]);

  if (!data?.show) return null;

  const finish = (action: Promise<CheckPeopleDto>) => {
    setBusy(true);
    action.then(
      (answer) => {
        setBusy(false);
        setError(undefined);
        setData(answer);
        onChanged();
      },
      (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <section className="panel card who" aria-labelledby="check-title">
      <header className="card-head">
        <h3 id="check-title">Check the people</h3>
        <p>{headline(data.voices)}</p>
      </header>
      <div className="card-body">
        <ul className="check-list">
          {data.voices.map((voice) => (
            <VoiceChoice
              key={voice.id}
              voice={voice}
              options={data.options}
              audioUrl={audioUrl}
              onShowLine={onShowLine}
              choice={choices[voice.id] ?? { kind: 'none' }}
              onChoice={(choice) => {
                setChoices((current) => ({ ...current, [voice.id]: choice }));
              }}
            />
          ))}
        </ul>
        {data.rememberEnabled && (
          <p className="muted">
            Confirming also teaches these voices to Learn voices. Only the names you confirm are
            learned.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="card-foot">
        <div className="actions">
          <button
            className="primary"
            disabled={busy || !canConfirm(data.voices, choices)}
            onClick={() => {
              finish(api.confirmCheckPeople(meetingId, confirmInput(data.voices, choices)));
            }}
          >
            Confirm
          </button>
          {countItems.length > 0 && (
            <Menu
              trigger="Change number of people"
              label="Change number of people"
              items={countItems}
            />
          )}
          <button
            disabled={busy}
            onClick={() => {
              finish(api.dismissCheckPeople(meetingId));
            }}
          >
            Dismiss
          </button>
        </div>
      </footer>
    </section>
  );
}
