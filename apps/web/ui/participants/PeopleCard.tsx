import { useCallback, useEffect, useRef, useState } from 'react';
import type { InviteeDto, ParticipantDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { formatLength } from '../format.js';
import { MoreIcon, PencilIcon } from '../icons.js';
import { Menu } from '../Menu.js';
import { Panel } from '../Panel.js';
import { AbsentList } from './AbsentList.js';
import { flattenPeople, SPLIT_POLL_MS, splitFailedText, splitProgress } from '../sharedRoom.js';
import { presence } from './names.js';
import { RenameDialog } from './RenameDialog.js';
import { SharedNote, VoiceRow } from './SharedTile.js';
import './participants.css';

interface Props {
  meetingId: string;
  transcriptSize: number;
  /** Changes when the people were edited elsewhere on the page. */
  reloadKey?: number;
  hasSummary: boolean;
  onChanged: () => void;
}

const renameCandidates = (person: ParticipantDto, all: InviteeDto[], absent: InviteeDto[]) =>
  all.filter(
    (invitee) =>
      person.inviteeEmails.includes(invitee.email) || absent.some((a) => a.email === invitee.email),
  );

export function PeopleCard({ meetingId, transcriptSize, reloadKey, hasSummary, onChanged }: Props) {
  const [people, setPeople] = useState<ParticipantDto[]>([]);
  const [invitees, setInvitees] = useState<InviteeDto[]>([]);
  const [absent, setAbsent] = useState<InviteeDto[]>([]);
  const [editing, setEditing] = useState<ParticipantDto>();
  const [error, setError] = useState<string>();
  const [splitting, setSplitting] = useState<{ tileId: string; startedAt: number }>();
  const confirm = useConfirm();
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const load = useCallback(() => {
    api.participants(meetingId).then(
      (data) => {
        setPeople(data.participants);
        setInvitees(data.invitees);
        setAbsent(data.absent);
      },
      () => {
        setPeople([]);
        setAbsent([]);
      },
    );
  }, [meetingId]);
  useEffect(load, [load, transcriptSize, reloadKey]);

  // While a split runs in the worker, look again until the tile has its people or time is up.
  useEffect(() => {
    if (!splitting) return;
    const tile = people.find((person) => person.id === splitting.tileId);
    const progress = splitProgress(tile?.room, splitting.startedAt, Date.now());
    if (progress === 'done') {
      setSplitting(undefined);
      changed.current();
      return;
    }
    if (progress === 'failed') {
      setSplitting(undefined);
      setError(splitFailedText);
      return;
    }
    const timer = setTimeout(load, SPLIT_POLL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [splitting, people, load]);

  const split = (tileId: string, count: 2 | 3) => {
    setError(undefined);
    api.roomCount(meetingId, tileId, { count }).then(
      (answer) => {
        if (answer.splitting) setSplitting({ tileId, startedAt: Date.now() });
        else {
          load();
          onChanged();
        }
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  };

  const regenerate = async () => {
    const confirmed = await confirm({
      title: 'Regenerate the summary?',
      body: (
        <p>
          Names in the current summary were replaced. Regenerating writes a new version from the
          transcript, using the new names. Earlier versions are kept.
        </p>
      ),
      confirmLabel: 'Regenerate summary',
    });
    if (!confirmed) return;
    api.summarize(meetingId, {}).then(onChanged, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  };

  if (people.length === 0) return null;
  const { rows, notes } = flattenPeople(people);
  return (
    <Panel title="People">
      <ul className="participant-list">
        {rows.map((row) =>
          row.kind === 'voice' ? (
            <VoiceRow
              key={row.sub.voiceId}
              meetingId={meetingId}
              tile={row.tile}
              sub={row.sub}
              invitees={invitees}
              others={people.filter((other) => other.id !== row.tile.id)}
              onChanged={() => {
                load();
                onChanged();
              }}
            />
          ) : (
            <li key={row.person.id}>
              <div className="people-name">
                <strong className="truncate">{row.person.name}</strong>
                <span className="sub-actions">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Rename ${row.person.name}`}
                    onClick={() => {
                      setEditing(row.person);
                    }}
                  >
                    <PencilIcon />
                  </button>
                  {row.person.canSplit && (
                    <Menu
                      trigger={<MoreIcon />}
                      label={`More for ${row.person.name}`}
                      align="end"
                      className="icon-menu"
                      items={[2, 3].map((count) => ({
                        label: `Split into ${String(count)} people`,
                        onSelect: () => {
                          split(row.person.id, count as 2 | 3);
                        },
                      }))}
                    />
                  )}
                </span>
              </div>
              {row.person.originalName && (
                <span className="muted people-original">Joined as {row.person.originalName}</span>
              )}
              <span className="muted people-meta">
                {[
                  presence(row.person),
                  row.person.talkMs > 0 && `${formatLength(row.person.talkMs)} talking`,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
              {splitting?.tileId === row.person.id && (
                <span className="muted people-meta" role="status">
                  Looking for the voices
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {notes.map((tile) => (
        <SharedNote
          key={tile.id}
          meetingId={meetingId}
          tile={tile}
          splitting={splitting?.tileId === tile.id || !!tile.room?.splitting}
          onRename={() => {
            setEditing(tile);
          }}
          onSplit={(count) => {
            split(tile.id, count);
          }}
          onChanged={() => {
            load();
            onChanged();
          }}
          onError={setError}
        />
      ))}
      <AbsentList
        meetingId={meetingId}
        absent={absent}
        people={people}
        onChanged={load}
        onError={setError}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {editing && (
        <RenameDialog
          meetingId={meetingId}
          person={editing}
          shared={editing.room !== undefined}
          invitees={renameCandidates(editing, invitees, absent)}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={() => {
            load();
            onChanged();
            if (hasSummary) void regenerate();
          }}
        />
      )}
    </Panel>
  );
}
