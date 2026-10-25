import { useEffect, useState } from 'react';
import type { CustomTemplate } from '@openminutes/minutes';
import type { MinutesSettingsDto } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { Panel, type Notice } from '../Panel.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';
import { CustomTemplateBuilder } from './CustomTemplateBuilder.js';
import { ExportSettings } from './ExportSettings.js';

interface TemplateDraft {
  template: string;
  includeTranscript: boolean;
  includeChat: boolean;
  linksTab: boolean;
  destinations: string[];
  custom: CustomTemplate | undefined;
}

const draftOf = (state: MinutesSettingsDto): TemplateDraft => ({
  template: state.template,
  includeTranscript: state.includeTranscript,
  includeChat: state.includeChat,
  linksTab: state.linksTab,
  destinations: state.destinations.filter((d) => d.enabled).map((d) => d.id),
  custom: state.custom,
});

function TemplateCard({
  state,
  version,
  onSaved,
}: {
  state: MinutesSettingsDto;
  version: number;
  onSaved: (next: MinutesSettingsDto) => void;
}) {
  const [previewHtml, setPreviewHtml] = useState('');
  const form = useSettingsForm(draftOf(state), async (draft) => {
    const { custom, ...rest } = draft;
    const next = await api.saveMinutesSettings({ ...rest, ...(custom && { custom }) });
    onSaved(next);
    return draftOf(next);
  });
  const { template, includeTranscript, includeChat, linksTab, destinations, custom } = form.draft;

  useEffect(() => {
    if (!custom) return;
    const timer = setTimeout(() => {
      void api
        .previewMinutes({ template, custom, includeTranscript, includeChat, linksTab })
        .then(({ html }) => {
          setPreviewHtml(html);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [template, custom, includeTranscript, includeChat, linksTab, version]);

  return (
    <SettingsCard
      form={form}
      title="Template"
      description="Used for share links and exports. The preview below shows a demo meeting."
    >
      <fieldset className="template-picker">
        {state.templates.map((option) => (
          <label className="check" key={option.id}>
            <input
              type="radio"
              name="minutes-template"
              checked={template === option.id}
              onChange={() => {
                form.patch({ template: option.id });
              }}
            />
            <span>
              <strong>{option.name}</strong> <span className="muted">{option.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input
          type="checkbox"
          checked={includeTranscript}
          onChange={(e) => {
            form.patch({ includeTranscript: e.target.checked });
          }}
        />
        <span>
          Include the full transcript by default{' '}
          <span className="muted">Always its own tab or section, after the minutes.</span>
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={includeChat}
          onChange={(e) => {
            form.patch({ includeChat: e.target.checked });
          }}
        />
        <span>
          Include the chat by default{' '}
          <span className="muted">
            A Chat tab or section of its own, when the meeting has chat.
          </span>
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={linksTab}
          onChange={(e) => {
            form.patch({ linksTab: e.target.checked });
          }}
        />
        <span>
          Include a Links tab by default{' '}
          <span className="muted">
            The share link to these minutes, links in the summary and the meeting chat, and links to
            exported documents.
          </span>
        </span>
      </label>
      <fieldset className="template-picker">
        <legend>Destinations</legend>
        <p className="muted">Where the Minutes card on a meeting can put the minutes.</p>
        {state.destinations.map((option) => (
          <label className="check" key={option.id}>
            <input
              type="checkbox"
              disabled={!option.available}
              checked={option.available && destinations.includes(option.id)}
              onChange={(e) => {
                form.patch({
                  destinations: e.target.checked
                    ? [...destinations, option.id]
                    : destinations.filter((id) => id !== option.id),
                });
              }}
            />
            <span>
              {option.label}
              {option.unavailableReason && !option.available && (
                <span className="muted"> {option.unavailableReason}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      {template === 'custom' && custom && (
        <CustomTemplateBuilder
          value={custom}
          choices={state.customChoices}
          onChange={(next) => {
            form.patch({ custom: next });
          }}
        />
      )}
      <iframe className="minutes-preview" title="Minutes preview" sandbox="" srcDoc={previewHtml} />
    </SettingsCard>
  );
}

export function MinutesSettings() {
  const [state, setState] = useState<MinutesSettingsDto>();
  const [feedback, setFeedback] = useState<Notice>();
  const [version, setVersion] = useState(0);

  const apply = (next: MinutesSettingsDto) => {
    setState(next);
    setVersion((current) => current + 1);
  };

  useEffect(() => {
    void api.minutesSettings().then(apply);
  }, []);

  const run = (done: string, action: () => Promise<MinutesSettingsDto>) => {
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
      <TemplateCard state={state} version={version} onSaved={apply} />

      <Panel
        title="Logo"
        description="Shown first on every minutes document. Optional."
        notice={feedback}
        foot={
          state.hasLogo && (
            <button
              type="button"
              onClick={() => {
                run('Logo removed.', api.removeMinutesLogo);
              }}
            >
              Remove logo
            </button>
          )
        }
      >
        {state.hasLogo && (
          <img
            className="logo-preview"
            alt="Minutes logo"
            src={`/api/settings/minutes/logo?v=${version}`}
          />
        )}
        <label className="field">
          <span>{state.hasLogo ? 'Replace logo' : 'Upload logo'}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) run('Logo saved.', () => api.uploadMinutesLogo(file));
              e.target.value = '';
            }}
          />
          <small>PNG, JPEG or SVG, up to 512 KB.</small>
        </label>
      </Panel>
      <ExportSettings />
    </>
  );
}
