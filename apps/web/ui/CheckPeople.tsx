import { useCallback, useEffect, useState } from 'react';
import type { CheckOptionDto, CheckPeopleDto, CheckVoiceDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import {
  canConfirm,
  companyText,
  confirmInput,
  headline,
  initialChoices,
  matchText,
  type Choice,
} from './checkPeople.js';
import { formatLength } from './format.js';
import { Menu, type MenuItem } from './Menu.js';
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
}

const NEW = 'new';

function VoiceChoice(props: {
  voice: CheckVoiceDto;
  options: CheckOptionDto[];
  choice: Choice;
  onChoice: (choice: Choice) => void;
}) {
  const { voice, options, choice, onChoice } = props;
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
    if (option) {
      onChoice({
        kind: 'person',
        personId: option.personId,
        name: option.name,
        email: option.email,
      });
    }
  };

  return (
    <li className="check-voice">
      <header>
        <strong>{voice.label}</strong>
        <span className="muted">{formatLength(voice.durationMs)} speaking</span>
      </header>
      {picked && (
        <p className="check-pick">
          <strong>{picked}</strong>
          {company && <span className="muted">{company}</span>}
          {choice.kind === 'match' && match && <span className="muted">{matchText(match)}</span>}
          {match?.onCalendar && choice.kind === 'match' && (
            <span className="muted">on the invitation</span>
          )}
        </p>
      )}
      {!picked && choice.kind === 'none' && <p className="muted">Nobody matched this voice.</p>}
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
        <ul className="chips" aria-label="Invited to this meeting">
          {voice.attendees.map((attendee) => (
            <li key={attendee.email ?? attendee.name}>
              <button
                type="button"
                className="chip"
                aria-pressed={choice.kind !== 'none' && picked === attendee.name}
                onClick={() => {
                  onChoice({
                    kind: 'person',
                    personId: attendee.personId,
                    name: attendee.name,
                    email: attendee.email,
                  });
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

export function CheckPeople({ meetingId, transcriptSize, countItems, onChanged, onShown }: Props) {
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
