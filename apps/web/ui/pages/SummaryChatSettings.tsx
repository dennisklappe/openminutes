import { useEffect, useState } from 'react';
import type { SummaryChatSettingsDto } from '../../src/dto.js';
import { api } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

function SummaryChatForm({ saved }: { saved: SummaryChatSettingsDto }) {
  const form = useSettingsForm(saved, api.saveSummaryChatSettings);
  return (
    <SettingsCard
      form={form}
      title="Meeting chat"
      description="The chat is extra context for the summary. It is not retold in the notes, only links shared in it are listed under Resources."
    >
      <label className="check">
        <input
          type="checkbox"
          checked={form.draft.includeChat}
          onChange={(e) => {
            form.patch({ includeChat: e.target.checked });
          }}
        />
        <span>
          Give the summary model the meeting chat{' '}
          <span className="muted">Links shared in chat land in Resources. On by default.</span>
        </span>
      </label>
    </SettingsCard>
  );
}

export function SummaryChatSettings() {
  const [saved, setSaved] = useState<SummaryChatSettingsDto>();
  useEffect(() => {
    void api.summaryChatSettings().then(setSaved);
  }, []);
  return saved ? <SummaryChatForm saved={saved} /> : null;
}
