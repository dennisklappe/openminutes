import { useEffect, useState } from 'react';
import type { SharedAccountsDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { Panel } from '../Panel.js';
import { SettingsCard } from '../SettingsCard.js';
import { accountText, parseWaitMinutes, waitSettingText } from '../sharedRoom.js';
import { useSettingsForm } from '../useSettingsForm.js';
import '../participants/participants.css';

function Form({
  saved,
  onSaved,
}: {
  saved: SharedAccountsDto;
  onSaved: (next: SharedAccountsDto) => void;
}) {
  const [minutes, setMinutes] = useState(String(saved.waitMinutes));
  const form = useSettingsForm({ waitMinutes: saved.waitMinutes }, async (draft) => {
    const next = await api.saveSharedAccounts(draft);
    onSaved(next);
    return { waitMinutes: next.waitMinutes };
  });
  const parsed = parseWaitMinutes(minutes);
  return (
    <SettingsCard
      form={form}
      title="Shared accounts"
      description="When two people sit in front of one screen they join as one participant. OpenMinutes asks how many people it is, then lists each voice as a person you can name."
    >
      <label className="field">
        <span>Wait for how many people on shared accounts (minutes)</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={1440}
          value={minutes}
          aria-invalid={parsed === undefined}
          onChange={(e) => {
            setMinutes(e.target.value);
            const next = parseWaitMinutes(e.target.value);
            if (next !== undefined) form.patch({ waitMinutes: next });
          }}
        />
        <small>
          {parsed === undefined
            ? 'Enter a whole number of minutes, 0 to 1440.'
            : `${waitSettingText(parsed)} 0 never waits.`}
        </small>
      </label>
    </SettingsCard>
  );
}

export function SharedAccountsSettings() {
  const confirm = useConfirm();
  const [saved, setSaved] = useState<SharedAccountsDto>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.sharedAccounts().then(setSaved, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  }, []);

  const remove = async (id: string, label: string) => {
    const confirmed = await confirm({
      title: `Forget ${label}?`,
      body: (
        <p>
          The next meeting from this account asks how many people it is again. The people already
          made for its voices stay in People.
        </p>
      ),
      confirmLabel: 'Forget',
      destructive: true,
    });
    if (!confirmed) return;
    api.removeSharedAccount(id).then(setSaved, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  };

  if (!saved) {
    return error ? (
      <p className="feedback error" role="alert">
        {error}
      </p>
    ) : null;
  }
  return (
    <>
      <Form saved={saved} onSaved={setSaved} />
      <Panel
        title="Remembered shared accounts"
        description="Accounts you said hold several people. A meeting from one of them skips the question."
      >
        {saved.accounts.length === 0 ? (
          <p className="muted">None yet. They appear when you answer the question in a meeting.</p>
        ) : (
          <ul className="participant-list remembered-accounts">
            {saved.accounts.map((account) => (
              <li key={account.id}>
                <div className="people-name">
                  <strong className="truncate">{accountText(account)}</strong>
                  <button
                    type="button"
                    onClick={() => {
                      void remove(account.id, account.label);
                    }}
                  >
                    Remove
                  </button>
                </div>
                {account.voices.length > 0 && (
                  <span className="muted people-meta">
                    {account.voices.map((voice) => voice.name).join(', ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
      </Panel>
    </>
  );
}
