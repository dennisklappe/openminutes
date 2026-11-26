import { useEffect, useState } from 'react';
import type { GoogleSessionDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';
import { AlertIcon, CheckIcon } from '../icons.js';
import { BotCredentialsCard } from './BotCredentialsCard.js';

const headline = {
  missing: 'No Google account: the bot joins Google Meet as a guest.',
  valid: 'Signed in: the bot joins Google Meet with its Google account.',
  expired: 'Signed out: Google Meet meetings fail until the bot signs in again.',
} as const;

const keepAliveText = {
  ok: 'Session refreshed',
  failed: 'Refresh failed',
  needs_attention: 'Needs attention',
} as const;

function KeepAlive({ state }: { state: GoogleSessionDto }) {
  const { keepAlive } = state;
  if (!keepAlive) {
    return (
      <p className="hint">
        The bot visits Google once a day to keep the session alive. Nothing has run yet.
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

function SessionCard({
  state,
  onChanged,
}: {
  state: GoogleSessionDto;
  onChanged: (next: GoogleSessionDto) => void;
}) {
  const form = useSettingsForm({ notify: state.notify }, async (draft) => {
    const next = await api.setGoogleNotifications(draft.notify);
    onChanged(next);
    return { notify: next.notify };
  });
  const act = (done: string, action: () => Promise<GoogleSessionDto>) => {
    form.setNotice(undefined);
    action().then(
      (next) => {
        onChanged(next);
        form.setNotice({ ok: true, text: done });
      },
      (failure: unknown) => {
        form.setNotice({ ok: false, text: errorMessage(failure) });
      },
    );
  };
  return (
    <SettingsCard
      form={form}
      title="Bot Google account"
      description={
        <>
          Use a dedicated Google account, never a personal one. Sign in with the email and password
          below, or import a session file made on a computer with a browser, see the &quot;Signing
          the Meet bot in&quot; guide.
        </>
      }
      actions={
        state.status !== 'missing' && (
          <button
            type="button"
            onClick={() => {
              act('Session removed.', api.removeGoogleSession);
            }}
          >
            Remove session
          </button>
        )
      }
    >
      <p className={`status-line status-${state.status}`}>
        {state.status === 'valid' ? <CheckIcon /> : <AlertIcon />}
        {headline[state.status]}
      </p>
      <KeepAlive state={state} />
      <label className="check">
        <input
          type="checkbox"
          checked={form.draft.notify}
          onChange={(e) => {
            form.patch({ notify: e.target.checked });
          }}
        />
        Email me when the session fails or is about to run out
      </label>
      <label className="field">
        <span>Session file (fallback)</span>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) act('Session imported.', () => api.importGoogleSession(file));
            e.target.value = '';
          }}
        />
        <small>google-session.json</small>
      </label>
    </SettingsCard>
  );
}

export function GoogleSessionSettings() {
  const [state, setState] = useState<GoogleSessionDto>();

  useEffect(() => {
    void api.googleSession().then(setState);
  }, []);

  if (!state) return null;

  return (
    <>
      <SessionCard state={state} onChanged={setState} />
      <BotCredentialsCard
        credentials={state.credentials}
        description="Optional. The bot signs in again by itself whenever the session ends. The details are stored encrypted on your own server and are never shown again. Use the dedicated bot account only."
        save={api.saveGoogleCredentials}
        remove={api.removeGoogleCredentials}
        onSaved={setState}
      />
    </>
  );
}
