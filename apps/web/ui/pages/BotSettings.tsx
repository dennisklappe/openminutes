import { useEffect, useState } from 'react';
import type { BotSettingsDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Panel, type Notice } from '../Panel.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';

interface Identity {
  name: string;
  joinMessage: string;
  joinMessageEnabled: boolean;
}

const identityOf = ({ name, joinMessage, joinMessageEnabled }: BotSettingsDto): Identity => ({
  name,
  joinMessage,
  joinMessageEnabled,
});

function IdentityCard({
  state,
  onSaved,
}: {
  state: BotSettingsDto;
  onSaved: (next: BotSettingsDto) => void;
}) {
  const form = useSettingsForm(identityOf(state), async (draft) => {
    const next = await api.saveBotSettings(draft);
    onSaved(next);
    return identityOf(next);
  });
  const { name, joinMessage, joinMessageEnabled } = form.draft;
  return (
    <SettingsCard
      form={form}
      title="Identity"
      description="How the bot shows up when it joins a meeting."
      actions={
        <button
          type="button"
          onClick={() => {
            form.set({
              name: state.defaults.name,
              joinMessage: state.defaults.joinMessage,
              joinMessageEnabled: true,
            });
          }}
        >
          Use defaults
        </button>
      }
    >
      <label className="field">
        <span>Display name</span>
        <input
          type="text"
          maxLength={64}
          placeholder={state.defaults.name}
          value={name}
          onChange={(e) => {
            form.patch({ name: e.target.value });
          }}
        />
        <small>Shown to everyone in the participant list.</small>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={joinMessageEnabled}
          onChange={(e) => {
            form.patch({ joinMessageEnabled: e.target.checked });
          }}
        />
        Post a chat message when the bot joins
      </label>
      <label className="field">
        <span>Join message</span>
        <input
          type="text"
          maxLength={500}
          disabled={!joinMessageEnabled}
          value={joinMessage}
          onChange={(e) => {
            form.patch({ joinMessage: e.target.value });
          }}
        />
        <small>
          Posted in the meeting chat when the bot joins. {'{{name}}'} becomes the bot name.
        </small>
      </label>
    </SettingsCard>
  );
}

export function BotSettings() {
  const [state, setState] = useState<BotSettingsDto>();
  const [feedback, setFeedback] = useState<Notice>();
  const [imageVersion, setImageVersion] = useState(0);

  const apply = (next: BotSettingsDto) => {
    setState(next);
    setImageVersion((version) => version + 1);
  };

  useEffect(() => {
    void api.botSettings().then(apply);
  }, []);

  const run = (done: string, action: () => Promise<BotSettingsDto>) => {
    setFeedback(undefined);
    action().then(
      (next) => {
        apply(next);
        setFeedback({ ok: true, text: done });
      },
      (failure: unknown) => {
        setFeedback({ ok: false, text: errorMessage(failure) });
      },
    );
  };

  if (!state) return null;

  return (
    <>
      <IdentityCard state={state} onSaved={setState} />

      <Panel
        title="Camera image"
        description="Optional. With an image the bot turns its camera on and shows it as its video. Without one it joins with the camera off."
        notice={feedback}
        foot={
          state.hasCameraImage && (
            <button
              type="button"
              onClick={() => {
                run('Image removed.', api.removeBotCamera);
              }}
            >
              Remove image
            </button>
          )
        }
      >
        {state.hasCameraImage && (
          <img
            className="camera-preview"
            alt="Camera image the bot shows"
            src={`/api/settings/bot/camera?v=${imageVersion}`}
          />
        )}
        <label className="field">
          <span>{state.hasCameraImage ? 'Replace image' : 'Upload image'}</span>
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) run('Image saved.', () => api.uploadBotCamera(file));
              e.target.value = '';
            }}
          />
          <small>PNG or JPEG, up to 2 MB. 16:9 works best.</small>
        </label>
      </Panel>
    </>
  );
}
