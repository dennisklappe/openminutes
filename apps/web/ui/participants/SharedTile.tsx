import { useState, type SubmitEvent } from 'react';
import type { InviteeDto, ParticipantDto, SubPersonDto } from '../../src/dto.js';
import { api, errorMessage, meetingUrl } from '../api.js';
import { Dialog } from '../Dialog.js';
import { MoreIcon, PencilIcon } from '../icons.js';
import { Menu } from '../Menu.js';
import {
  holdersOf,
  inviteeChoices,
  needsMove,
  noteText,
  personHref,
  splitOptions,
  subMeta,
  tileEmailState,
} from '../sharedRoom.js';
import { SnippetPlayer } from '../SnippetPlayer.js';
import { SPEAKER_COLORS } from '../speakers.js';
import { inviteeLabel, presence, validEmail } from './names.js';
import { VoiceFlow } from './VoiceFlow.js';

interface Props {
  meetingId: string;
  tile: ParticipantDto;
  invitees: InviteeDto[];
  /** The other participants of the meeting, who may have an invitee linked. */
  others: ParticipantDto[];
  onRename: () => void;
  onSplit: (count: 2 | 3) => void;
  onChanged: () => void;
  onError: (message: string) => void;
  /** A split is running for this tile. */
  splitting: boolean;
}

/** Name an unnamed person of a shared tile, or change who a named one is. */
function VoiceDialog({
  meetingId,
  tile,
  sub,
  change,
  onClose,
  onDone,
}: {
  meetingId: string;
  tile: ParticipantDto;
  sub: SubPersonDto;
  change: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Dialog title={change ? `Change who ${sub.name} is` : `Who is ${sub.name}?`} onClose={onClose}>
      <p className="muted">
        {change
          ? 'Use this when the voice got the wrong person. The lines of the voice move to the one you pick.'
          : 'Pick someone from this meeting or from People, or type a new name. A person you pick takes over this voice, its lines and its meetings.'}
      </p>
      <VoiceFlow
        meetingId={meetingId}
        tileId={tile.id}
        voiceId={sub.voiceId}
        label={sub.name}
        currentInvitees={sub.inviteeEmails}
        {...(change && { from: { personId: sub.personId, name: sub.name } })}
        onCancel={onClose}
        onDone={() => {
          onDone();
          onClose();
        }}
      />
    </Dialog>
  );
}

/** The emails of one sub-person: their own, a meeting invitee, or the account's address. */
function EmailDialog({
  meetingId,
  tile,
  sub,
  invitees,
  others,
  onClose,
  onSaved,
}: {
  meetingId: string;
  tile: ParticipantDto;
  sub: SubPersonDto;
  invitees: InviteeDto[];
  others: ParticipantDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const room = tile.room;
  const [links, setLinks] = useState<string[]>(sub.inviteeEmails);
  const [typed, setTyped] = useState(
    sub.email && sub.email.toLowerCase() !== room?.tileEmail?.toLowerCase() ? sub.email : '',
  );
  const [useTile, setUseTile] = useState(
    !!sub.email && sub.email.toLowerCase() === room?.tileEmail?.toLowerCase(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!room) return null;
  const choices = inviteeChoices(
    invitees,
    { ...sub, inviteeEmails: links },
    room.subs,
    holdersOf(others),
  );
  const account = tileEmailState(room, sub);
  const typedOk = validEmail(typed.trim());

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy || !typedOk) return;
    const email =
      useTile && room.tileEmail ? room.tileEmail : typed.trim() === '' ? null : typed.trim();
    setBusy(true);
    api
      .renameParticipant(meetingId, sub.participantId, {
        name: sub.name,
        inviteeEmails: links,
        email,
        ...(needsMove(choices, links) && { move: true }),
      })
      .then(
        () => {
          onSaved();
          onClose();
        },
        (failure: unknown) => {
          setBusy(false);
          setError(errorMessage(failure));
        },
      );
  };

  return (
    <Dialog title={`Emails of ${sub.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">
          Each person has their own addresses. The address of {tile.name} is not shared with them
          unless you give it to one person here.
        </p>
        {choices.length > 0 && (
          <fieldset className="field email-choices">
            <legend>Invitees of this meeting</legend>
            {choices.map(({ invitee, mine, takenBy }) => (
              <label className="check" key={invitee.email}>
                <input
                  type="checkbox"
                  checked={mine}
                  onChange={(e) => {
                    setLinks(
                      e.target.checked
                        ? [...links, invitee.email]
                        : links.filter((own) => own.toLowerCase() !== invitee.email.toLowerCase()),
                    );
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
          </fieldset>
        )}
        <label className="field">
          <span>Another address</span>
          <input
            type="email"
            value={typed}
            autoComplete="off"
            placeholder="name@example.com"
            aria-invalid={!typedOk}
            disabled={useTile}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
          />
          <small>Optional.</small>
        </label>
        {account.kind !== 'none' && (
          <label className="check">
            <input
              type="checkbox"
              checked={useTile}
              disabled={account.kind === 'taken'}
              onChange={(e) => {
                setUseTile(e.target.checked);
              }}
            />
            <span>
              Use the address of the account ({account.email})
              {account.kind === 'taken' && <span className="muted"> taken by {account.by}</span>}
            </span>
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !typedOk}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** One voice of a shared tile as a person of the list, with a small tag for the tile it joined from. */
export function VoiceRow({
  meetingId,
  tile,
  sub,
  invitees,
  others,
  onChanged,
}: {
  meetingId: string;
  tile: ParticipantDto;
  sub: SubPersonDto;
  invitees: InviteeDto[];
  others: ParticipantDto[];
  onChanged: () => void;
}) {
  const [dialog, setDialog] = useState<'name' | 'change' | 'email'>();
  const href = personHref(sub);
  const room = tile.room;
  // When the person also is a participant of their own, the addresses belong to that row.
  const addresses = sub.seatSeparate
    ? []
    : [...new Set([...sub.emails, ...sub.inviteeEmails, ...(sub.email ? [sub.email] : [])])];
  return (
    <li
      className="sub-person voice-row"
      data-speaker-slot={(sub.number - 1) % SPEAKER_COLORS}
      data-unnamed={sub.unnamed || undefined}
    >
      <div className="people-name">
        <span className="sub-name">
          <span className="sub-title">
            <span className="voice-dot" aria-hidden="true" />
            {href ? (
              <a className="sub-link" href={href}>
                {sub.name}
              </a>
            ) : (
              <strong className="sub-label">{sub.name}</strong>
            )}
          </span>
          <span className="shared-marker" title={`Joined from the shared account ${tile.name}`}>
            via {tile.name}
          </span>
          {sub.unnamed && <span className="unnamed-tag">Unnamed</span>}
        </span>
        <span className="sub-actions">
          {sub.unnamed && (
            <button
              type="button"
              onClick={() => {
                setDialog('name');
              }}
            >
              Name
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Emails of ${sub.name}`}
            onClick={() => {
              setDialog('email');
            }}
          >
            <PencilIcon />
          </button>
          {!sub.unnamed && (
            <Menu
              trigger={<MoreIcon />}
              label={`More for ${sub.name}`}
              align="end"
              className="icon-menu"
              items={[
                {
                  label: 'Change who this is',
                  onSelect: () => {
                    setDialog('change');
                  },
                },
              ]}
            />
          )}
        </span>
      </div>
      <span className="muted people-meta">{subMeta(sub)}</span>
      {sub.seatSeparate ? (
        !sub.unnamed && (
          <span className="muted people-meta same-person">
            Same person as the participant above. Wrong?{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setDialog('change');
              }}
            >
              Change who this is
            </button>
          </span>
        )
      ) : (
        <span className="muted people-meta">
          {addresses.length > 0 ? addresses.join(', ') : 'No email'}
        </span>
      )}
      {room?.hasAudio && sub.snippets.length > 0 && (
        <SnippetPlayer
          audioUrl={meetingUrl(meetingId, 'audio')}
          label={sub.name}
          snippets={sub.snippets}
        />
      )}
      {(dialog === 'name' || dialog === 'change') && (
        <VoiceDialog
          meetingId={meetingId}
          tile={tile}
          sub={sub}
          change={dialog === 'change'}
          onClose={() => {
            setDialog(undefined);
          }}
          onDone={onChanged}
        />
      )}
      {dialog === 'email' && (
        <EmailDialog
          meetingId={meetingId}
          tile={tile}
          sub={sub}
          invitees={invitees}
          others={others}
          onClose={() => {
            setDialog(undefined);
          }}
          onSaved={onChanged}
        />
      )}
    </li>
  );
}

/** A quiet note about a shared account: who joined from it and what can be said about the tile. */
export function SharedNote({
  meetingId,
  tile,
  onRename,
  onSplit,
  onChanged,
  onError,
  splitting,
}: Omit<Props, 'invitees' | 'others'>) {
  const room = tile.room;
  if (!room) return null;
  const splits = splitOptions(room);
  const onePerson = () => {
    api.dismissRoom(meetingId, tile.id).then(onChanged, (failure: unknown) => {
      onError(errorMessage(failure));
    });
  };
  return (
    <details className="shared-note">
      <summary>{noteText(tile, room.subs.length)}</summary>
      {tile.originalName && (
        <span className="muted people-original">Joined as {tile.originalName}</span>
      )}
      <span className="muted people-meta">{[presence(tile)].filter(Boolean).join(', ')}</span>
      {splitting && (
        <p className="muted" role="status">
          Looking for the voices
        </p>
      )}
      <div className="shared-actions">
        <button type="button" onClick={onePerson} disabled={splitting}>
          It is one person
        </button>
        {splits.map((count) => (
          <button
            key={count}
            type="button"
            disabled={splitting}
            onClick={() => {
              onSplit(count);
            }}
          >
            Split into {count} people
          </button>
        ))}
        <button type="button" aria-label={`Rename ${tile.name}`} onClick={onRename}>
          Rename the account
        </button>
      </div>
    </details>
  );
}
