import { useEffect, useState } from 'react';
import type { VoiceSettingsDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { formatWhen } from '../format.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';
import '../voices.css';

function VoiceForm({
  settings,
  onChanged,
}: {
  settings: VoiceSettingsDto;
  onChanged: (next: VoiceSettingsDto) => void;
}) {
  const confirm = useConfirm();
  const form = useSettingsForm({ remember: settings.remember }, async (draft) => {
    const next = await api.saveVoiceSettings(draft.remember);
    onChanged(next);
    return { remember: next.remember };
  });

  const run = (action: Promise<VoiceSettingsDto>) => {
    action.then(onChanged, (failure: unknown) => {
      form.setNotice({ ok: false, text: errorMessage(failure) });
    });
  };

  const forgetAll = async () => {
    const confirmed = await confirm({
      title: 'Forget all remembered voices?',
      body: <p>Names will no longer be suggested for returning voices. This cannot be undone.</p>,
      confirmLabel: 'Forget all',
      destructive: true,
    });
    if (confirmed) run(api.forgetAllVoices());
  };

  return (
    <SettingsCard
      form={form}
      title="Recognise voices"
      description="After you name a voice in a phone recording, OpenMinutes can suggest that name when the same voice shows up again."
      actions={
        settings.known.length > 0 && (
          <button
            type="button"
            className="danger"
            onClick={() => {
              void forgetAll();
            }}
          >
            Forget all
          </button>
        )
      }
    >
      <label className="check">
        <input
          type="checkbox"
          checked={form.draft.remember}
          onChange={(e) => {
            form.patch({ remember: e.target.checked });
          }}
        />
        <span>Remember voices of people I name</span>
      </label>
      <p className="privacy-note">
        A voiceprint is a list of numbers that describes how a voice sounds. It is stored only in
        your own database, never sent anywhere, and used only to suggest names. Off by default. You
        can delete any voice, or all of them, at any time.
      </p>
      {settings.known.length > 0 && (
        <ul className="voice-settings-list" aria-label="Remembered voices">
          {settings.known.map((voice) => (
            <li key={voice.id}>
              <span>
                {voice.name}{' '}
                <span className="muted">
                  {voice.samples} {voice.samples === 1 ? 'sample' : 'samples'}, updated{' '}
                  {formatWhen(voice.updatedAt)}
                </span>
              </span>
              <button
                type="button"
                className="danger"
                aria-label={`Forget ${voice.name}`}
                onClick={() => {
                  run(api.forgetVoice(voice.id));
                }}
              >
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  );
}

export function VoiceSettings() {
  const [settings, setSettings] = useState<VoiceSettingsDto>();
  useEffect(() => {
    void api.voiceSettings().then(setSettings);
  }, []);
  return settings ? <VoiceForm settings={settings} onChanged={setSettings} /> : null;
}
