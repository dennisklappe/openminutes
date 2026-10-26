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
  const form = useSettingsForm(
    { remember: settings.remember, check: settings.check },
    async (draft) => {
      const next = await api.saveVoiceSettings(draft);
      onChanged(next);
      return { remember: next.remember, check: next.check };
    },
  );

  const run = (action: Promise<VoiceSettingsDto>) => {
    action.then(onChanged, (failure: unknown) => {
      form.setNotice({ ok: false, text: errorMessage(failure) });
    });
  };

  const forgetAll = async () => {
    const confirmed = await confirm({
      title: 'Delete all voice data?',
      body: (
        <p>
          Every saved voice sample and voice profile is deleted. People, names and emails stay.
          Names will no longer be suggested for returning voices. This cannot be undone.
        </p>
      ),
      confirmLabel: 'Delete all voice data',
      destructive: true,
    });
    if (confirmed) run(api.forgetAllVoices());
  };

  return (
    <SettingsCard
      form={form}
      title="Voices"
      description={
        <>
          How OpenMinutes uses voices to tell people apart. Everyone you have named is listed under{' '}
          <a href="#/people">People</a>, where you verify their lines.
        </>
      }
      actions={
        settings.known.length > 0 && (
          <button
            type="button"
            className="danger"
            onClick={() => {
              void forgetAll();
            }}
          >
            Delete all voice data
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
        <span>
          Learn voices from lines I verify{' '}
          <span className="muted">
            When you name a speaker, assign a line or verify it under People, the voice of that line
            is saved to the person. Nothing is learned from lines you did not confirm.
          </span>
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={form.draft.check}
          onChange={(e) => {
            form.patch({ check: e.target.checked });
          }}
        />
        <span>
          Check lines against saved voices{' '}
          <span className="muted">
            In meetings with speaking indicators, each line is compared with the saved voices of the
            people in that meeting. Lines that sound like someone else are flagged under People for
            you to review. Only people with a saved voice are checked.
          </span>
        </span>
      </label>
      <p className="privacy-note">
        A voiceprint is a list of numbers that describes how a voice sounds. It counts as biometric
        data. It is stored only in your own database, never sent anywhere, and used only to suggest
        names and to flag doubtful lines. Both options are off by default. You can delete the voice
        data of one person on their page under People, or all of it here.
      </p>
      {settings.known.length > 0 && (
        <ul className="voice-settings-list" aria-label="Saved voices">
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
                aria-label={`Delete the voice data of ${voice.name}`}
                onClick={() => {
                  run(api.forgetVoice(voice.id));
                }}
              >
                Delete
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
