import { useEffect, useState } from 'react';
import type { LimitsDto } from '../../src/dto.js';
import { api } from '../api.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

function LimitsForm({ saved }: { saved: LimitsDto }) {
  const form = useSettingsForm(saved, api.saveLimits);
  const limits = form.draft;
  const number = (key: keyof LimitsDto, label: string, min: number, max: number, help?: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        required
        min={min}
        max={max}
        value={Number.isNaN(limits[key]) ? '' : limits[key]}
        onChange={(e) => {
          form.patch({ [key]: e.target.valueAsNumber });
        }}
      />
      {help && <small>{help}</small>}
    </label>
  );

  return (
    <SettingsCard
      form={form}
      title="Meeting limits"
      description="Each meeting at the same time needs about 1 CPU core and 1.5 GB of memory. Meetings over the limit wait in the queue until a slot is free."
    >
      <div className="field-row">
        {number(
          'lobbyTimeoutSeconds',
          'Lobby wait (seconds)',
          30,
          3600,
          'How long the bot waits to be let in. After that the meeting fails with "Nobody admitted the bot".',
        )}
        {number(
          'aloneTimeoutSeconds',
          'Leave when alone (seconds)',
          10,
          3600,
          'The bot leaves when it has been the only one in the meeting for this long.',
        )}
        {number(
          'maxDurationMinutes',
          'Leave after (minutes)',
          5,
          1440,
          'The longest the bot stays in one meeting.',
        )}
        {number('maxConcurrent', 'Parallel meetings', 1, 10, 'Meetings the bot joins at once.')}
      </div>
    </SettingsCard>
  );
}

export function LimitsSettings() {
  const [limits, setLimits] = useState<LimitsDto>();
  useEffect(() => {
    void api.limits().then(setLimits);
  }, []);
  return limits ? <LimitsForm saved={limits} /> : null;
}
