import { useEffect, useState } from 'react';
import type { MicrosoftSessionDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Panel, type Notice } from '../Panel.js';
import { AlertIcon, CheckIcon } from '../icons.js';

const headline = {
  missing: 'No Microsoft account: the bot joins Teams as a guest.',
  valid: 'Signed in: the bot joins Teams with its Microsoft account.',
  expired: 'Signed out: Teams meetings fail until you import a new session file.',
} as const;

export function MicrosoftSessionSettings() {
  const [state, setState] = useState<MicrosoftSessionDto>();
  const [notice, setNotice] = useState<Notice>();

  useEffect(() => {
    void api.microsoftSession().then(setState);
  }, []);

  if (!state) return null;

  const act = (done: string, action: () => Promise<MicrosoftSessionDto>) => {
    setNotice(undefined);
    action().then(
      (next) => {
        setState(next);
        setNotice({ ok: true, text: done });
      },
      (failure: unknown) => {
        setNotice({ ok: false, text: errorMessage(failure) });
      },
    );
  };

  return (
    <Panel
      title="Bot Microsoft account"
      description={
        <>
          Use a dedicated work account with a Teams licence, never a personal one. Make the session
          file on a computer with a browser and import it here, see the &quot;Signing the Teams bot
          in&quot; guide. Signed in, Teams shows the account name instead of the bot name.
        </>
      }
      notice={notice}
      foot={
        state.status !== 'missing' ? (
          <button
            type="button"
            onClick={() => {
              act('Session removed.', api.removeMicrosoftSession);
            }}
          >
            Remove session
          </button>
        ) : undefined
      }
    >
      <p className={`status-line status-${state.status}`}>
        {state.status === 'valid' ? <CheckIcon /> : <AlertIcon />}
        {headline[state.status]}
      </p>
      {state.expiresAt && (
        <p className="hint">
          The sign-in cookie runs until {new Date(state.expiresAt).toLocaleDateString()}. Microsoft
          or the tenant can end the session earlier.
        </p>
      )}
      <label className="field">
        <span>Session file</span>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) act('Session imported.', () => api.importMicrosoftSession(file));
            e.target.value = '';
          }}
        />
        <small>microsoft-session.json, made with scripts/microsoft-login.mjs</small>
      </label>
    </Panel>
  );
}
