import { useEffect, useState } from 'react';
import type { PhoneSettingsDto } from '../../src/dto.js';
import { api } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

const MAX_CONSENT_LENGTH = 1000;

function PhoneForm({ saved }: { saved: PhoneSettingsDto }) {
  const form = useSettingsForm(
    { enabled: saved.enabled, consentText: saved.consentText },
    async (draft) => {
      const { enabled, consentText } = await api.savePhoneSettings(draft);
      return { enabled, consentText };
    },
  );
  return (
    <SettingsCard
      form={form}
      title="Phone recorder"
      description="Record a conversation with your phone's microphone and get minutes like any other meeting. The recorder shows the notice below before it starts."
      actions={
        <button
          type="button"
          onClick={() => {
            form.patch({ consentText: saved.defaults.consentText });
          }}
        >
          Reset to default
        </button>
      }
    >
      <label className="check">
        <input
          type="checkbox"
          checked={form.draft.enabled}
          onChange={(e) => {
            form.patch({ enabled: e.target.checked });
          }}
        />
        <span>Allow recording from a phone</span>
      </label>
      <label className="field">
        <span>Consent notice</span>
        <textarea
          rows={4}
          maxLength={MAX_CONSENT_LENGTH}
          value={form.draft.consentText}
          onChange={(e) => {
            form.patch({ consentText: e.target.value });
          }}
        />
      </label>
    </SettingsCard>
  );
}

export function PhoneSettings() {
  const [saved, setSaved] = useState<PhoneSettingsDto>();
  useEffect(() => {
    void api.phoneSettings().then(setSaved);
  }, []);
  return saved ? <PhoneForm saved={saved} /> : null;
}
