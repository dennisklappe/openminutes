import { useEffect, useState } from 'react';
import type { SpeakerSettingsDto } from '../../src/dto.js';
import { api } from '../api.js';
import { AliasSettings } from '../participants/AliasSettings.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';
import { VoiceSettings } from './VoiceSettings.js';

function SpeakerForm({ saved }: { saved: SpeakerSettingsDto }) {
  const form = useSettingsForm(saved, api.saveSpeakerSettings);
  return (
    <SettingsCard
      form={form}
      title="Speaker names"
      description={
        <>
          Names come from the speaking indicator of the meeting and the voices in the audio. Lines
          where that is not clear are marked as uncertain, and you can fix any of them in the
          transcript. Read{' '}
          <a
            href="https://github.com/dennisklappe/openminutes/blob/main/docs/speakers.md"
            target="_blank"
            rel="noreferrer"
          >
            how speakers are decided
          </a>{' '}
          for the details.
        </>
      }
    >
      <label className="check">
        <input
          type="checkbox"
          checked={form.draft.refine}
          onChange={(e) => {
            form.patch({ refine: e.target.checked });
          }}
        />
        <span>
          Check uncertain speakers with the summary model{' '}
          <span className="muted">
            Only changes who is shown as the speaker, never the words. Sends just the uncertain
            lines with a few lines of context around them to the summary provider above, names and
            text but no audio, in small batches. This costs roughly one small request per 10
            uncertain lines. On by default, turn it off to keep every speaker as detected.
          </span>
        </span>
      </label>
    </SettingsCard>
  );
}

export function SpeakerSettings() {
  const [saved, setSaved] = useState<SpeakerSettingsDto>();
  useEffect(() => {
    void api.speakerSettings().then(setSaved);
  }, []);
  return (
    <>
      {saved && <SpeakerForm saved={saved} />}
      <VoiceSettings />
      <AliasSettings />
    </>
  );
}
