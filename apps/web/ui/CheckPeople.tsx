import { useCallback, useEffect, useState } from 'react';
import type { CheckOptionDto, CheckPeopleDto, CheckVoiceDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import {
  attendeeChips,
  canConfirm,
  companyText,
  confirmInput,
  headline,
  initialChoices,
  matchText,
  optionChoice,
  type Choice,
} from './checkPeople.js';
import { Menu, type MenuItem } from './Menu.js';
import { SPEAKER_COLORS } from './speakers.js';
import { VoiceChips, VoiceFrame, VoiceSamples } from './VoiceFrame.js';
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

function VoiceChoice(props: {
  voice: CheckVoiceDto;
  slot: number;
  options: CheckOptionDto[];
  choice: Choice;
  onChoice: (choice: Choice) => void;
  audioUrl?: string | undefined;
  onShowLine?: ((segmentId: string) => void) | undefined;
}) {
  const { voice, slot, options, choice, onChoice, audioUrl, onShowLine } = props;
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
    <VoiceFrame as="li" slot={slot} label={voice.label} durationMs={voice.durationMs}>
      {picked && (
        <div className="voice-pick">
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
      <VoiceSamples
        samples={voice.samples}
        label={voice.label}
        audioUrl={audioUrl}
        onShowLine={onShowLine}
      />
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
        <div className="voice-name voice-fields">
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
        <VoiceChips
          label="Invited to this meeting, tap one to pick them"
          chips={attendeeChips(voice.attendees, choice, picked)}
          onPick={(key) => {
            const attendee = voice.attendees.find((a) => (a.email ?? a.name) === key);
            if (attendee) onChoice(optionChoice(attendee));
          }}
        />
      )}
    </VoiceFrame>
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
        <div className="voices">
          {data.voices.map((voice, index) => (
            <VoiceChoice
              key={voice.id}
              slot={index % SPEAKER_COLORS}
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
        </div>
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
