import { useEffect, useState } from 'react';
import type { EmailSettingsDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';
import { ProviderSection } from './ProviderSection.js';

interface SenderDraft {
  fromName: string;
  fromAddress: string;
  ownerAddress: string;
  subject: string;
  body: string;
}

const draftOf = (state: EmailSettingsDto): SenderDraft => ({
  fromName: state.fromName,
  fromAddress: state.fromAddress,
  ownerAddress: state.ownerAddress,
  subject: state.subject,
  body: state.body,
});

function Sender({
  state,
  onSaved,
}: {
  state: EmailSettingsDto;
  onSaved: (s: EmailSettingsDto) => void;
}) {
  const form = useSettingsForm(draftOf(state), async (draft) => {
    const next = await api.saveEmailSettings(draft);
    onSaved(next);
    return draftOf(next);
  });
  const { fromName, fromAddress, ownerAddress, subject, body } = form.draft;
  const domain = state.sendingDomain;

  const sendTest = () => {
    form.setNotice(undefined);
    api.sendTestEmail().then(
      (result) => {
        form.setNotice(
          result.ok
            ? { ok: true, text: `Test mail ${result.detail ?? 'sent'}.` }
            : { ok: false, text: result.error ?? 'The test mail failed' },
        );
      },
      (failure: unknown) => {
        form.setNotice({ ok: false, text: errorMessage(failure) });
      },
    );
  };

  return (
    <SettingsCard
      form={form}
      title="Sender and message"
      description="Minutes are sent from this address, one separate mail per person. The test mail only ever goes to your own address."
      actions={
        <button
          type="button"
          disabled={!state.ownerAddress || form.dirty}
          title={form.dirty ? 'Save your changes first' : undefined}
          onClick={sendTest}
        >
          Send test mail to me
        </button>
      }
    >
      <div className="field-row">
        <label className="field">
          <span>From name</span>
          <input
            type="text"
            value={fromName}
            placeholder="OpenMinutes"
            onChange={(e) => {
              form.patch({ fromName: e.target.value });
            }}
          />
        </label>
        <label className="field">
          <span>From address</span>
          <input
            type="text"
            value={fromAddress}
            placeholder={domain ? `minutes@${domain}` : 'minutes@example.com'}
            onChange={(e) => {
              form.patch({ fromAddress: e.target.value });
            }}
          />
          {domain && <small>Must be on {domain}. Typing just the name adds the domain.</small>}
        </label>
      </div>
      <label className="field">
        <span>Your own address</span>
        <input
          type="email"
          value={ownerAddress}
          onChange={(e) => {
            form.patch({ ownerAddress: e.target.value });
          }}
        />
        <small>
          Test mails go here and nowhere else. Save the provider above and these changes first.
        </small>
      </label>
      <label className="field">
        <span>Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => {
            form.patch({ subject: e.target.value });
          }}
        />
      </label>
      <label className="field">
        <span>Message</span>
        <textarea
          rows={7}
          value={body}
          onChange={(e) => {
            form.patch({ body: e.target.value });
          }}
        />
        <small>Placeholders: {state.placeholders.map((name) => `{{${name}}}`).join(' ')}.</small>
      </label>
      <div className="actions">
        <button
          type="button"
          className="link"
          onClick={() => {
            form.patch({ subject: state.defaults.subject, body: state.defaults.body });
          }}
        >
          Reset to the default text
        </button>
      </div>
    </SettingsCard>
  );
}

function GmailHint({ state }: { state: EmailSettingsDto }) {
  const { connected, sendAccounts } = state.google;
  if (sendAccounts.length > 0) {
    return (
      <p className="hint">
        Sending allowed for <strong>{sendAccounts.join(', ')}</strong>. Mail goes out from that
        account, so use its address as the from address below.
      </p>
    );
  }
  return (
    <div className="inline-action">
      <p className="hint">
        No connected Google account can send mail yet. Connect a Google account under Calendar
        accounts with mail permission.
      </p>
      <a className="button" href="/api/oauth/google/start?scope=gmail">
        {connected ? 'Allow sending mail' : 'Connect a Google account'}
      </a>
    </div>
  );
}

export function EmailSettings() {
  const [state, setState] = useState<EmailSettingsDto>();

  const load = () => {
    void api.emailSettings().then(setState);
  };
  useEffect(load, []);

  return (
    <>
      <ProviderSection
        client={api.emailProviderSettings}
        onSaved={load}
        aside={(provider) => provider.id === 'gmail' && state && <GmailHint state={state} />}
      />
      {state && <Sender state={state} onSaved={setState} />}
    </>
  );
}
