import { useState, type SubmitEvent } from 'react';
import { api, errorMessage } from '../api.js';
import { Dialog } from '../Dialog.js';
import {
  emptyWebhookForm,
  EVENT_CHOICES,
  formProblem,
  formToInput,
  PLATFORM_CHOICES,
  webhookToForm,
  type WebhookForm,
} from '../webhooks.js';
import type { WebhookDto, WebhookEventName } from '../../src/dto.js';

const NAME_MAX = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SavedWebhook {
  webhook: WebhookDto;
  /** Only set after create: the signing secret, shown once. */
  secret?: string;
}

export function WebhookDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing?: WebhookDto;
  onClose: () => void;
  onSaved: (saved: SavedWebhook) => void;
}) {
  const [form, setForm] = useState<WebhookForm>(() =>
    existing ? webhookToForm(existing) : emptyWebhookForm(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const problem = formProblem(form);

  const patch = (change: Partial<WebhookForm>) => {
    setForm((current) => ({ ...current, ...change }));
  };
  const patchFilter = (change: Partial<WebhookForm['filter']>) => {
    setForm((current) => ({ ...current, filter: { ...current.filter, ...change } }));
  };
  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (problem || busy) return;
    setBusy(true);
    setError(undefined);
    const input = formToInput(form);
    const request = existing
      ? api.updateWebhook(existing.id, input).then((webhook) => ({ webhook }))
      : api.createWebhook(input);
    request.then(onSaved, (failure: unknown) => {
      setBusy(false);
      setError(errorMessage(failure));
    });
  };

  return (
    <Dialog wide title={existing ? `Edit ${existing.name}` : 'Add a webhook'} onClose={onClose}>
      <form onSubmit={submit} className="webhook-form">
        <label className="field">
          <span>Name</span>
          <input
            value={form.name}
            maxLength={NAME_MAX}
            autoFocus
            autoComplete="off"
            placeholder="For example Team chat"
            onChange={(e) => {
              patch({ name: e.target.value });
            }}
          />
        </label>
        <label className="field">
          <span>Address</span>
          <input
            type="url"
            inputMode="url"
            value={form.url}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com/openminutes"
            onChange={(e) => {
              patch({ url: e.target.value });
            }}
          />
          <small>OpenMinutes sends a POST with a JSON body to this address.</small>
        </label>

        <fieldset className="webhook-fieldset">
          <legend>Send when</legend>
          {EVENT_CHOICES.map((choice) => (
            <label className="check webhook-check" key={choice.id}>
              <input
                type="checkbox"
                checked={form.events.includes(choice.id)}
                onChange={() => {
                  patch({ events: toggle<WebhookEventName>(form.events, choice.id) });
                }}
              />
              <span>
                {choice.label}
                <small className="muted"> {choice.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="webhook-fieldset">
          <legend>Only for meetings that match</legend>
          <p className="muted people-meta">
            Leave everything empty to send every meeting. A meeting must match every box you fill
            in, and any one line inside a box. Upper and lower case do not matter.
          </p>
          <label className="field">
            <span>Title contains</span>
            <textarea
              rows={2}
              value={form.filter.titleContains}
              placeholder="One per line, for example client call"
              onChange={(e) => {
                patchFilter({ titleContains: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>Title does not contain</span>
            <textarea
              rows={2}
              value={form.filter.titleNotContains}
              placeholder="One per line, for example standup"
              onChange={(e) => {
                patchFilter({ titleNotContains: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>A participant contains</span>
            <textarea
              rows={2}
              value={form.filter.participantContains}
              placeholder="A name or email, one per line, for example @acme.com"
              onChange={(e) => {
                patchFilter({ participantContains: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>Company is</span>
            <textarea
              rows={2}
              value={form.filter.companies}
              placeholder="Exact company name, one per line"
              onChange={(e) => {
                patchFilter({ companies: e.target.value });
              }}
            />
          </label>
          <div className="webhook-platforms" role="group" aria-label="Platform">
            <span className="webhook-platforms-label">Platform</span>
            {PLATFORM_CHOICES.map((choice) => (
              <label className="check" key={choice.id}>
                <input
                  type="checkbox"
                  checked={form.filter.platforms.includes(choice.id)}
                  onChange={() => {
                    patchFilter({ platforms: toggle(form.filter.platforms, choice.id) });
                  }}
                />
                {choice.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="check webhook-check">
          <input
            type="checkbox"
            checked={form.allowPrivate}
            onChange={(e) => {
              patch({ allowPrivate: e.target.checked });
            }}
          />
          <span>
            Allow private addresses and plain http
            <small className="muted">
              {' '}
              For a service on your own network, such as n8n or Home Assistant.
            </small>
          </span>
        </label>
        {form.allowPrivate && (
          <p className="warning" role="note">
            With this on, OpenMinutes can reach other machines on the network it runs on. Turn it on
            only for an address you trust. Cloud metadata addresses stay blocked.
          </p>
        )}

        <label className="check webhook-check">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => {
              patch({ active: e.target.checked });
            }}
          />
          <span>
            Active
            <small className="muted"> Turn off to pause without deleting.</small>
          </span>
        </label>

        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {existing ? 'Save changes' : 'Add webhook'}
          </button>
        </div>
        {problem && <p className="muted people-meta webhook-problem">{problem}</p>}
      </form>
    </Dialog>
  );
}

export function WebhookSecretDialog({
  name,
  secret,
  onClose,
}: {
  name: string;
  secret: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(secret).then(
      () => {
        setCopied(true);
      },
      () => {
        setFailed(true);
      },
    );
  };
  return (
    <Dialog title="Copy your signing secret now" onClose={onClose}>
      <p className="warning" role="alert">
        This is the only time the secret is shown. Put it in the service that receives {name} so it
        can check the signature. Lost it? Rotate the secret to get a new one.
      </p>
      <label className="field">
        <span>Signing secret</span>
        <input
          className="api-secret"
          readOnly
          value={secret}
          autoComplete="off"
          onFocus={(e) => {
            e.currentTarget.select();
          }}
        />
      </label>
      {failed && (
        <p className="muted">Copying failed. Select the secret above and copy it by hand.</p>
      )}
      <div className="confirm-actions">
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy secret'}
        </button>
        <button className="primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

export function TestEventDialog({
  webhook,
  onClose,
  onSent,
}: {
  webhook: WebhookDto;
  onClose: () => void;
  onSent: () => void;
}) {
  const [event, setEvent] = useState<WebhookEventName>(webhook.events[0] ?? 'meeting.transcribed');
  const [meetingId, setMeetingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const trimmed = meetingId.trim();
  const invalid = trimmed !== '' && !UUID.test(trimmed);

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (invalid || busy) return;
    setBusy(true);
    setError(undefined);
    api
      .testWebhookEvent(webhook.id, { event, ...(trimmed && { meetingId: trimmed }) })
      .then(onSent, (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
      });
  };

  return (
    <Dialog title="Send a test event" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">
          Sends the real event for one of your meetings to {webhook.name}. Filters are ignored, and
          it is marked as a test in the log.
        </p>
        <label className="field">
          <span>Event</span>
          <select
            value={event}
            autoFocus
            onChange={(e) => {
              setEvent(e.target.value as WebhookEventName);
            }}
          >
            {EVENT_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label} ({choice.id})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Meeting id (optional)</span>
          <input
            value={meetingId}
            autoComplete="off"
            spellCheck={false}
            placeholder="Empty uses your latest transcribed meeting"
            aria-invalid={invalid}
            onChange={(e) => {
              setMeetingId(e.target.value);
            }}
          />
          <small>
            {invalid
              ? 'That is not a meeting id.'
              : 'The id is the last part of a meeting address.'}
          </small>
        </label>
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={invalid || busy}>
            Send test event
          </button>
        </div>
      </form>
    </Dialog>
  );
}
