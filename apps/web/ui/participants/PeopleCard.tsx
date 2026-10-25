import { useCallback, useEffect, useState } from 'react';
import type { InviteeDto, ParticipantDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { formatLength } from '../format.js';
import { PencilIcon } from '../icons.js';
import { Panel } from '../Panel.js';
import { AbsentList } from './AbsentList.js';
import { presence } from './names.js';
import { RenameDialog } from './RenameDialog.js';
import './participants.css';

interface Props {
  meetingId: string;
  transcriptSize: number;
  hasSummary: boolean;
  onChanged: () => void;
}

const renameCandidates = (person: ParticipantDto, all: InviteeDto[], absent: InviteeDto[]) =>
  all.filter(
    (invitee) =>
      invitee.email === person.inviteeEmail || absent.some((a) => a.email === invitee.email),
  );

export function PeopleCard({ meetingId, transcriptSize, hasSummary, onChanged }: Props) {
  const [people, setPeople] = useState<ParticipantDto[]>([]);
  const [invitees, setInvitees] = useState<InviteeDto[]>([]);
  const [absent, setAbsent] = useState<InviteeDto[]>([]);
  const [editing, setEditing] = useState<ParticipantDto>();
  const [error, setError] = useState<string>();
  const confirm = useConfirm();

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
  useEffect(load, [load, transcriptSize]);

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
  return (
    <Panel title="People">
      <ul className="participant-list">
        {people.map((person) => (
          <li key={person.id}>
            <div className="people-name">
              <strong className="truncate">{person.name}</strong>
              <button
                type="button"
                className="icon-button"
                aria-label={`Rename ${person.name}`}
                onClick={() => {
                  setEditing(person);
                }}
              >
                <PencilIcon />
              </button>
            </div>
            {person.originalName && (
              <span className="muted people-original">Joined as {person.originalName}</span>
            )}
            <span className="muted people-meta">
              {[presence(person), person.talkMs > 0 && `${formatLength(person.talkMs)} talking`]
                .filter(Boolean)
                .join(', ')}
            </span>
          </li>
        ))}
      </ul>
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
