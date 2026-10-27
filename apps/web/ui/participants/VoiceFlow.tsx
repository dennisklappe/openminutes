import { useEffect, useState, type SubmitEvent } from 'react';
import type { ParticipantDto, RoomChangePreviewDto, RoomReviewDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { NamePicker } from '../NamePicker.js';
import type { PickerOption } from '../review.js';
import {
  holdersOf,
  invitedOptions,
  inviteeChoices,
  needsMove,
  withoutTileEmail,
  type InviteeChoice,
} from '../sharedRoom.js';
import { inviteeLabel, validEmail } from './names.js';

/** The person a voice is changed away from. Without it the voice is named for the first time. */
export interface VoiceFrom {
  personId: string;
  name: string;
}

interface Props {
  meetingId: string;
  /** The shared tile the voice belongs to. */
  tileId: string;
  voiceId: string;
  /** What the voice is called now, such as "Voice 2 (Ann and Sam)". */
  label: string;
  from?: VoiceFrom;
  /** The invitees the voice's person has now, left out of the list of invitees to pick. */
  currentInvitees?: string[];
  onDone: () => void;
  onCancel?: () => void;
}

interface Context {
  review: RoomReviewDto;
  tile: ParticipantDto | undefined;
  choices: InviteeChoice[];
}

/** The review (people to pick, theirs emails) and the invitees of the meeting for one voice. */
function useVoiceContext(meetingId: string, tileId: string, setError: (message: string) => void) {
  const [context, setContext] = useState<Context>();
  useEffect(() => {
    Promise.all([api.roomReview(meetingId, tileId), api.participants(meetingId)]).then(
      ([review, roster]) => {
        const tile = roster.participants.find((person) => person.id === tileId);
        // Nobody is this voice yet, so every invitee that is linked anywhere counts as taken.
        const choices = inviteeChoices(
          tile ? withoutTileEmail(roster.invitees, tile) : roster.invitees,
          { voiceId: '', inviteeEmails: [] },
          tile?.room?.subs ?? [],
          holdersOf(roster.participants.filter((person) => person.id !== tileId)),
        );
        setContext({ review, tile, choices });
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  }, [meetingId, tileId, setError]);
  return context;
}

/** What the voice becomes: a person, a typed name, or nobody. */
type Target = PickerOption | 'unnamed';

const targetName = (target: Target) => (target === 'unnamed' ? 'an unnamed voice' : target.name);

function EmailFields({
  choices,
  known,
  ticked,
  typed,
  onTick,
  onType,
}: {
  choices: InviteeChoice[];
  /** The emails the picked person has already. */
  known: string[];
  ticked: string[];
  typed: string;
  onTick: (email: string, on: boolean) => void;
  onType: (value: string) => void;
}) {
  return (
    <fieldset className="field email-choices">
      <legend>Email (optional)</legend>
      {known.length > 0 && <p className="muted">Already has {known.join(', ')}.</p>}
      {choices.length > 0 && (
        <>
          <p className="muted">Invitees of this meeting:</p>
          {choices.map(({ invitee, takenBy }) => (
            <label className="check" key={invitee.email}>
              <input
                type="checkbox"
                checked={ticked.some((own) => own.toLowerCase() === invitee.email.toLowerCase())}
                onChange={(e) => {
                  onTick(invitee.email, e.target.checked);
                }}
              />
              <span>
                {inviteeLabel(invitee)}
                {takenBy && (
                  <span className="muted"> taken by {takenBy}, tick to move it here</span>
                )}
              </span>
            </label>
          ))}
        </>
      )}
      <label className="field">
        <span>Another address</span>
        <input
          type="email"
          value={typed}
          autoComplete="off"
          placeholder="name@example.com"
          aria-invalid={!validEmail(typed.trim())}
          onChange={(e) => {
            onType(e.target.value);
          }}
        />
      </label>
    </fieldset>
  );
}

/**
 * Names a voice of a shared tile, or changes who a named one is: pick a person (from the meeting,
 * from People, or a new name), then optionally the emails, in one go. Changing says in plain
 * words what happens and lists the emails that were linked in this meeting.
 */
export function VoiceFlow({
  meetingId,
  tileId,
  voiceId,
  label,
  from,
  currentInvitees,
  onDone,
  onCancel,
}: Props) {
  const [error, setError] = useState<string>();
  const context = useVoiceContext(meetingId, tileId, setError);
  const [preview, setPreview] = useState<RoomChangePreviewDto>();
  const [target, setTarget] = useState<Target>();
  const [ticked, setTicked] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [remove, setRemove] = useState<string[]>();
  const [busy, setBusy] = useState(false);
  const [showTaken, setShowTaken] = useState(false);

  const fromId = from?.personId;
  useEffect(() => {
    if (!fromId) return;
    api.roomChangePreview(meetingId, voiceId).then(setPreview, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  }, [meetingId, voiceId, fromId]);

  const typedOk = validEmail(typed.trim());
  const removing = remove ?? preview?.emails.filter((entry) => entry.suggested).map((e) => e.email);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!target || busy || !typedOk || !context) return;
    const emails = {
      ...(ticked.length > 0 && { inviteeEmails: ticked }),
      ...(typed.trim() !== '' && { email: typed.trim() }),
      ...(needsMove(context.choices, ticked) && { move: true }),
    };
    const who =
      target === 'unnamed'
        ? undefined
        : target.personId
          ? { personId: target.personId }
          : { newName: target.name };
    const drop = removing && removing.length > 0 ? { removeEmails: removing } : {};
    setBusy(true);
    setError(undefined);
    const run = from
      ? api.changeRoomVoice(
          meetingId,
          voiceId,
          who ? { ...who, ...emails, ...drop } : { unnamed: true, ...drop },
        )
      : who
        ? api.nameRoomVoice(meetingId, voiceId, { ...who, ...emails })
        : Promise.resolve();
    run.then(onDone, (failure: unknown) => {
      setBusy(false);
      setError(errorMessage(failure));
    });
  };

  const known =
    target && target !== 'unnamed' && target.personId
      ? (context?.review.people.find((p) => p.id === target.personId)?.emails ?? [])
      : [];

  if (!target) {
    return (
      <div className="voice-flow">
        {from && preview && <p className="muted">Currently: {from.name}. Pick who it really is.</p>}
        {context ? (
          <NamePicker
            roster={context.review.roster.filter((entry) => entry.personId !== fromId)}
            people={context.review.people.filter((person) => person.id !== fromId)}
            invited={invitedOptions(
              context.choices,
              context.review.people,
              { personId: fromId, inviteeEmails: currentInvitees },
              showTaken,
            )}
            onShowTaken={context.choices.some((c) => c.takenBy) ? setShowTaken : undefined}
            label={`Who is ${label}`}
            busy={busy}
            onPick={(option) => {
              // An invitee is picked with the address: it goes to that person only.
              if (option.email) setTicked([option.email]);
              setTarget(option);
            }}
          />
        ) : (
          !error && <p className="muted">Loading</p>
        )}
        {from && (
          <div className="review-picker-more">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setTarget('unnamed');
              }}
            >
              Unnamed again
            </button>
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {onCancel && (
          <div className="confirm-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form className="voice-flow" onSubmit={submit}>
      <p>
        {from ? (
          <>
            {label} becomes <strong>{target === 'unnamed' ? 'unnamed again' : target.name}</strong>.
          </>
        ) : (
          <>
            {label} is <strong>{targetName(target)}</strong>.
          </>
        )}
      </p>
      {from && preview && (
        <ul className="voice-effects" aria-label="What changes">
          <li>
            {preview.lines} {preview.lines === 1 ? 'line' : 'lines'} of this voice move from{' '}
            {from.name} to {targetName(target)}.
          </li>
          <li>
            {preview.samples} voice {preview.samples === 1 ? 'sample' : 'samples'} learned from this
            meeting {preview.samples === 1 ? 'is' : 'are'} removed from the voice profile of{' '}
            {from.name}, and that profile is built again.
          </li>
          {preview.keptLines > 0 && (
            <li>
              {preview.keptLines} {preview.keptLines === 1 ? 'line' : 'lines'} you set by hand stay
              where {preview.keptLines === 1 ? 'it is' : 'they are'}.
            </li>
          )}
          <li>Other meetings of {from.name} are not touched.</li>
        </ul>
      )}
      {from && preview && preview.emails.length > 0 && (
        <fieldset className="field email-choices" aria-label="Emails to remove">
          <legend>These emails were linked in this meeting</legend>
          <p className="muted">
            Tick the ones to remove from {from.name}. Nothing else is deleted.
          </p>
          {preview.emails.map((entry) => (
            <label className="check" key={entry.email}>
              <input
                type="checkbox"
                checked={(removing ?? []).some((own) => own.toLowerCase() === entry.email)}
                onChange={(e) => {
                  setRemove(
                    e.target.checked
                      ? [...(removing ?? []), entry.email]
                      : (removing ?? []).filter((own) => own.toLowerCase() !== entry.email),
                  );
                }}
              />
              <span>{entry.email}</span>
            </label>
          ))}
        </fieldset>
      )}
      {target !== 'unnamed' && context && (
        <EmailFields
          choices={context.choices}
          known={known}
          ticked={ticked}
          typed={typed}
          onTick={(email, on) => {
            setTicked(
              on
                ? [...ticked, email]
                : ticked.filter((own) => own.toLowerCase() !== email.toLowerCase()),
            );
          }}
          onType={setTyped}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="confirm-actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setTarget(undefined);
            setError(undefined);
          }}
        >
          Back
        </button>
        <button
          type="submit"
          className="primary"
          disabled={busy || !typedOk || (!!from && !preview)}
        >
          {from ? 'Change who this is' : 'Name the voice'}
        </button>
      </div>
    </form>
  );
}
