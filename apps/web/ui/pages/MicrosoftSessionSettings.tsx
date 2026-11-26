import { useEffect, useState } from 'react';
import type { MicrosoftSessionDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Panel, type Notice } from '../Panel.js';
import { AlertIcon, CheckIcon } from '../icons.js';
import { BotCredentialsCard } from './BotCredentialsCard.js';

const headline = {
  missing: 'No Microsoft account: the bot joins Teams as a guest.',
  valid: 'Signed in: the bot joins Teams with its Microsoft account.',
  expired: 'Signed out: Teams meetings fail until you import a new session file.',
} as const;

const keepAliveText = {
  ok: 'Session refreshed',
  failed: 'Refresh failed',
  needs_attention: 'Needs attention',
} as const;

function KeepAlive({ keepAlive }: { keepAlive: MicrosoftSessionDto['keepAlive'] }) {
  if (!keepAlive) {
    return (
      <p className="hint">
        The bot opens Teams once a day to keep the session alive. Nothing has run yet.
      </p>
    );
  }
  return (
    <p className={`status-line status-${keepAlive.status === 'ok' ? 'valid' : 'expired'}`}>
      {keepAlive.status === 'ok' ? <CheckIcon /> : <AlertIcon />}
      {keepAliveText[keepAlive.status]}, last checked {new Date(keepAlive.at).toLocaleString()}
      {keepAlive.detail && `: ${keepAlive.detail}`}
    </p>
  );
}

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
    <>
      <Panel
        title="Bot Microsoft account"
        description={
          <>
            Use a dedicated work account with a Teams licence, never a personal one. Import a
            session file made on a computer with a browser, or save the email and password below,
            see the &quot;Signing the Teams bot in&quot; guide. Signed in, Teams shows the account
            name instead of the bot name.
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
          {state.status === 'expired' && state.credentials
            ? 'Signed out: the bot signs in again with the saved password at the next Teams meeting.'
            : headline[state.status]}
        </p>
        {state.expiresAt && (
          <p className="hint">
            The sign-in cookie runs until {new Date(state.expiresAt).toLocaleDateString()}.
            Microsoft or the tenant can end the session earlier.
          </p>
        )}
        {state.status !== 'missing' && <KeepAlive keepAlive={state.keepAlive} />}
        <label className="check">
          <input
            type="checkbox"
            checked={state.notify}
            onChange={(e) => {
              const notify = e.target.checked;
              act(notify ? 'Alert mail on.' : 'Alert mail off.', () =>
                api.setMicrosoftNotifications(notify),
              );
            }}
          />
          Email me when the session fails or is about to run out
        </label>
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
      <BotCredentialsCard
        credentials={state.credentials}
        description="Optional. When the session ends the bot signs in again by itself, with the authenticator code if the account needs one. Number matching, text message codes, security keys and passkeys cannot be automated. The details are stored encrypted on your own server and are never shown again."
        totpHint={
          <>
            The secret of an authenticator app other than Microsoft Authenticator: in My Sign-Ins,
            add a sign-in method, choose a different authenticator app and copy the secret key.
          </>
        }
        save={api.saveMicrosoftCredentials}
        remove={api.removeMicrosoftCredentials}
        onSaved={setState}
      />
    </>
  );
}
