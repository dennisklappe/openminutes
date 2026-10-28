import { useState, type SyntheticEvent } from 'react';
import type { VoiceDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { CheckIcon } from './icons.js';
import { VoiceChips, VoiceFrame, VoiceSamples } from './VoiceFrame.js';
import { canSave, initialName, NAME_MAX, sourceLabels } from './voices.js';

interface Props {
  meetingId: string;
  voice: VoiceDto;
  slot: number;
  rememberEnabled: boolean;
  audioUrl: string;
  onSaved: () => void;
}

export function VoiceCard({ meetingId, voice, slot, rememberEnabled, audioUrl, onSaved }: Props) {
  const [draft, setDraft] = useState(initialName(voice));
  const [remember, setRemember] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const inputId = `voice-${voice.id}`;

  const save = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!canSave(voice, draft, remember) || saving) return;
    setSaving(true);
    api.nameVoice(meetingId, voice.id, { name: draft.trim(), remember }).then(
      () => {
        setSaving(false);
        setError(undefined);
        onSaved();
      },
      (failure: unknown) => {
        setSaving(false);
        setError(errorMessage(failure));
      },
    );
  };

  return (
    <VoiceFrame
      as="form"
      slot={slot}
      label={voice.name}
      durationMs={voice.durationMs}
      onSubmit={save}
      badge={
        voice.confirmed && (
          <span className="voice-saved">
            <CheckIcon />
            Saved
          </span>
        )
      }
    >
      {voice.snippets.length > 0 && (
        <VoiceSamples samples={voice.snippets} label={voice.name} audioUrl={audioUrl} />
      )}
      <label htmlFor={inputId}>Who is this?</label>
      <div className="voice-name">
        <input
          id={inputId}
          value={draft}
          maxLength={NAME_MAX}
          placeholder="Name"
          autoComplete="off"
          enterKeyHint="done"
          onChange={(e) => {
            setDraft(e.target.value);
          }}
        />
        <button
          className="primary"
          type="submit"
          disabled={saving || !canSave(voice, draft, remember)}
        >
          Save
        </button>
      </div>
      {voice.suggestions.length > 0 && (
        <VoiceChips
          label="Suggested names"
          chips={voice.suggestions.map(({ name, source }) => ({
            key: name,
            name,
            note: sourceLabels[source],
            pressed: draft.trim() === name,
          }))}
          onPick={setDraft}
        />
      )}
      {rememberEnabled && (
        <label className="check">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => {
              setRemember(e.target.checked);
            }}
          />
          <span>Remember this voice</span>
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </VoiceFrame>
  );
}
