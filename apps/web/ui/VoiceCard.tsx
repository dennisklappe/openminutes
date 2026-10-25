import { useState, type SyntheticEvent } from 'react';
import type { VoiceDto } from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { formatLength } from './format.js';
import { CheckIcon } from './icons.js';
import { SnippetPlayer } from './SnippetPlayer.js';
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
    <form className="voice" data-speaker-slot={slot} onSubmit={save}>
      <header>
        <i className="voice-dot" aria-hidden="true" />
        <strong className="truncate">{voice.name}</strong>
        <span className="muted">{formatLength(voice.durationMs)} speaking</span>
        {voice.confirmed && (
          <span className="voice-saved">
            <CheckIcon />
            Saved
          </span>
        )}
      </header>
      {voice.snippets.length > 0 && (
        <SnippetPlayer audioUrl={audioUrl} label={voice.name} snippets={voice.snippets} />
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
        <ul className="chips" aria-label="Suggested names">
          {voice.suggestions.map(({ name, source }) => (
            <li key={name}>
              <button
                type="button"
                className="chip"
                aria-pressed={draft.trim() === name}
                onClick={() => {
                  setDraft(name);
                }}
              >
                {name}
                <small>{sourceLabels[source]}</small>
              </button>
            </li>
          ))}
        </ul>
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
    </form>
  );
}
