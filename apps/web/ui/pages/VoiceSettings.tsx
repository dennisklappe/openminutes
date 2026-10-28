import { useEffect, useState } from 'react';
import type { VoiceSettingsDto, VoiceTuningDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { formatWhen } from '../format.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';
import {
  TUNING_FIELDS,
  clampAll,
  clampTuning,
  tuningIsDefault,
  type TuningField,
} from '../voiceTuning.js';
import '../voices.css';

function TuningInput({
  field,
  value,
  fallback,
  onChange,
}: {
  field: TuningField;
  value: number;
  fallback: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  return (
    <label className="field">
      <span>{field.label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={field.min}
        max={field.max}
        step={field.step}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const typed = e.target.valueAsNumber;
          if (Number.isFinite(typed)) onChange(clampTuning(field, typed));
        }}
        onBlur={() => {
          setText(String(value));
        }}
      />
      <span className="muted">Default {fallback}</span>
    </label>
  );
}

function VoiceForm({
  settings,
  onChanged,
}: {
  settings: VoiceSettingsDto;
  onChanged: (next: VoiceSettingsDto) => void;
}) {
  const confirm = useConfirm();
  const form = useSettingsForm(
    { remember: settings.remember, check: settings.check, tuning: settings.tuning },
    async (draft) => {
      const next = await api.saveVoiceSettings({
        remember: draft.remember,
        check: draft.check,
        ...clampAll(draft.tuning, settings.tuningDefaults),
      });
      onChanged(next);
      return { remember: next.remember, check: next.check, tuning: next.tuning };
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

  const forgetOne = async (voice: VoiceSettingsDto['known'][number]) => {
    const confirmed = await confirm({
      title: `Delete the voice data of ${voice.name}?`,
      body: (
        <p>
          The saved voice samples and the voice profile of {voice.name} are deleted. The person,
          their name and emails stay. Their name will no longer be suggested for a returning voice.
          This cannot be undone.
        </p>
      ),
      confirmLabel: 'Delete voice data',
      destructive: true,
    });
    if (confirmed) run(api.forgetVoice(voice.id));
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
          Learn voices{' '}
          <span className="muted">
            When you name a speaker, assign a line or verify it under People, the voice of that line
            is saved to the person. Once someone has 30 seconds of verified speech in a language,
            lines in that language that are near certain are added to their voice by themselves,
            counted less than verified ones and kept to a limit. You can remove those under People.
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
      <fieldset className="tuning">
        <legend>Readiness and matching</legend>
        <p className="muted">
          These numbers decide when a voice profile counts as ready and how voices are matched.
          Change them only if profiles fill too slowly or match too loosely.
        </p>
        {TUNING_FIELDS.map((field) => (
          <TuningInput
            key={field.key}
            field={field}
            value={form.draft.tuning[field.key]}
            fallback={settings.tuningDefaults[field.key]}
            onChange={(value) => {
              form.patch({ tuning: { ...form.draft.tuning, [field.key]: value } });
            }}
          />
        ))}
        <button
          type="button"
          disabled={tuningIsDefault(form.draft.tuning, settings.tuningDefaults)}
          onClick={() => {
            const tuning: VoiceTuningDto = { ...settings.tuningDefaults };
            form.patch({ tuning });
          }}
        >
          Reset to defaults
        </button>
      </fieldset>
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
                  void forgetOne(voice);
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
