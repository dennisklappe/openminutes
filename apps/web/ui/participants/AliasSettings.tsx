import { useEffect, useState } from 'react';
import type { ParticipantAliasDto, ParticipantAliasesDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Panel, type Notice } from '../Panel.js';
import { NAME_MAX } from './names.js';
import './participants.css';

function AliasRow({
  alias,
  run,
}: {
  alias: ParticipantAliasDto;
  run: (action: Promise<ParticipantAliasesDto>) => void;
}) {
  const [draft, setDraft] = useState(alias.displayName);
  const name = draft.trim();
  return (
    <li>
      <span className="alias-from">{alias.originalName}</span>
      <input
        aria-label={`Name for ${alias.originalName}`}
        value={draft}
        maxLength={NAME_MAX}
        autoComplete="off"
        onChange={(e) => {
          setDraft(e.target.value);
        }}
      />
      <button
        disabled={name === '' || name === alias.displayName}
        onClick={() => {
          run(api.saveParticipantAlias(alias.id, name));
        }}
      >
        Save
      </button>
      <button
        className="danger"
        aria-label={`Forget ${alias.originalName}`}
        onClick={() => {
          run(api.deleteParticipantAlias(alias.id));
        }}
      >
        Forget
      </button>
    </li>
  );
}

export function AliasSettings() {
  const [aliases, setAliases] = useState<ParticipantAliasDto[]>();
  const [feedback, setFeedback] = useState<Notice>();

  useEffect(() => {
    api.participantAliases().then(
      (data) => {
        setAliases(data.aliases);
      },
      (failure: unknown) => {
        setFeedback({ ok: false, text: errorMessage(failure) });
      },
    );
  }, []);

  const run = (action: Promise<ParticipantAliasesDto>) => {
    action.then(
      (data) => {
        setAliases(data.aliases);
        setFeedback(undefined);
      },
      (failure: unknown) => {
        setFeedback({ ok: false, text: errorMessage(failure) });
      },
    );
  };

  if (!aliases) return null;
  return (
    <Panel
      title="People"
      description="Names you chose to remember when renaming a participant. New meetings use them automatically, so a Meet display name like Marketing Acme shows up as Carla."
      notice={feedback}
    >
      {aliases.length === 0 ? (
        <p className="muted">
          Nothing remembered yet. Rename a participant on a meeting page and keep Remember for next
          time checked.
        </p>
      ) : (
        <ul className="alias-list" aria-label="Remembered names">
          {aliases.map((alias) => (
            <AliasRow key={`${alias.id}-${alias.displayName}`} alias={alias} run={run} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
