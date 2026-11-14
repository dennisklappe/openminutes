import { useState } from 'react';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { Panel, type Notice } from '../Panel.js';
import { usePolling } from '../usePolling.js';
import {
  countsText,
  EVENT_CHOICES,
  filterSummary,
  HEALTH_LABELS,
  HEALTH_PILL,
  hostOf,
  lastAttemptsText,
} from '../webhooks.js';
import type { WebhookDto } from '../../src/dto.js';
import '../participants/participants.css';
import { WebhookDeliveries } from './WebhookDeliveries.js';
import {
  TestEventDialog,
  WebhookDialog,
  WebhookSecretDialog,
  type SavedWebhook,
} from './WebhookDialogs.js';

const eventNames = (hook: WebhookDto) =>
  hook.events.map((id) => EVENT_CHOICES.find((choice) => choice.id === id)?.label ?? id).join(', ');

export function WebhooksSettings() {
  const confirm = useConfirm();
  const { data: hooks, error: loadError, refresh } = usePolling(api.webhooks, 5000);
  const [dialog, setDialog] = useState<{ existing?: WebhookDto }>();
  const [testing, setTesting] = useState<WebhookDto>();
  const [secret, setSecret] = useState<{ name: string; secret: string }>();
  const [logOpen, setLogOpen] = useState<string>();
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState<Notice>();
  const [busyId, setBusyId] = useState<string>();

  const done = (text: string) => {
    setNotice({ ok: true, text });
    refresh();
  };
  const fail = (failure: unknown) => {
    setNotice({ ok: false, text: errorMessage(failure) });
  };
  const run = (id: string, action: () => Promise<unknown>, then: () => void) => {
    setBusyId(id);
    setNotice(undefined);
    action()
      .then(then, fail)
      .finally(() => {
        setBusyId(undefined);
      });
  };
  const showLog = (id: string) => {
    setLogOpen(id);
    setReload((n) => n + 1);
  };

  const saved = ({ webhook, secret: created }: SavedWebhook) => {
    setDialog(undefined);
    done(created ? `Added ${webhook.name}.` : `Saved ${webhook.name}.`);
    if (created) setSecret({ name: webhook.name, secret: created });
  };

  const remove = async (hook: WebhookDto) => {
    const confirmed = await confirm({
      title: `Delete ${hook.name}?`,
      body: (
        <p>
          OpenMinutes stops sending events to this address and deletes its delivery log. This cannot
          be undone.
        </p>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!confirmed) return;
    run(
      hook.id,
      () => api.deleteWebhook(hook.id),
      () => {
        if (logOpen === hook.id) setLogOpen(undefined);
        done(`Deleted ${hook.name}.`);
      },
    );
  };

  const rotate = async (hook: WebhookDto) => {
    const confirmed = await confirm({
      title: `Rotate the secret of ${hook.name}?`,
      body: (
        <p>
          The old secret stops working at once. Deliveries signed with the new one will fail on the
          receiver until you update it there.
        </p>
      ),
      confirmLabel: 'Rotate secret',
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(hook.id);
    setNotice(undefined);
    api
      .rotateWebhookSecret(hook.id)
      .then((result) => {
        setSecret({ name: hook.name, secret: result.secret });
        refresh();
      }, fail)
      .finally(() => {
        setBusyId(undefined);
      });
  };

  const ping = (hook: WebhookDto) => {
    run(
      hook.id,
      () => api.testWebhook(hook.id),
      () => {
        showLog(hook.id);
        done('Test ping queued. It shows in the deliveries below.');
      },
    );
  };

  const toggleActive = (hook: WebhookDto) => {
    run(
      hook.id,
      () => api.updateWebhook(hook.id, { active: !hook.active }),
      () => {
        done(hook.active ? `Paused ${hook.name}.` : `Turned ${hook.name} back on.`);
      },
    );
  };

  return (
    <>
      <Panel
        title="Webhooks"
        description={
          <>
            Send a signed message to another service when a meeting is transcribed, summarized or
            deleted. See the webhooks guide in the docs for the format and how to check the
            signature.
          </>
        }
        notice={notice}
        foot={
          <button
            className="primary"
            type="button"
            onClick={() => {
              setDialog({});
            }}
          >
            Add webhook
          </button>
        }
      >
        {hooks?.length === 0 && (
          <p className="muted">No webhooks yet. Add one to send events to another service.</p>
        )}
        {hooks && hooks.length > 0 && (
          <ul className="participant-list webhooks">
            {hooks.map((hook) => {
              const filters = filterSummary(hook.filter);
              const busy = busyId === hook.id;
              return (
                <li key={hook.id} className="webhook">
                  <div className="people-name">
                    <strong className="truncate">{hook.name}</strong>
                    <span className={`pill ${HEALTH_PILL[hook.health.state]}`}>
                      <i aria-hidden="true" />
                      {HEALTH_LABELS[hook.health.state]}
                    </span>
                  </div>
                  <span className="muted people-meta webhook-meta">
                    {hostOf(hook.url)} · <code>{hook.secretPrefix}...</code>
                  </span>
                  <span className="muted people-meta webhook-meta">{eventNames(hook)}</span>
                  {filters && (
                    <span className="muted people-meta webhook-meta">Only {filters}</span>
                  )}
                  {hook.allowPrivate && (
                    <span className="muted people-meta webhook-meta">
                      Private addresses allowed
                    </span>
                  )}
                  <span className="muted people-meta webhook-meta">
                    {countsText(hook.health)} · {lastAttemptsText(hook.health)}
                  </span>
                  {hook.health.state === 'disabled' && hook.health.disabledReason && (
                    <span className="error people-meta webhook-meta">
                      {hook.health.disabledReason}
                    </span>
                  )}
                  <div className="webhook-actions">
                    <button
                      type="button"
                      aria-expanded={logOpen === hook.id}
                      onClick={() => {
                        if (logOpen === hook.id) setLogOpen(undefined);
                        else showLog(hook.id);
                      }}
                    >
                      Deliveries
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDialog({ existing: hook });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        toggleActive(hook);
                      }}
                    >
                      {hook.active ? 'Pause' : 'Turn on'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        ping(hook);
                      }}
                    >
                      Send test ping
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTesting(hook);
                      }}
                    >
                      Send test event
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void rotate(hook);
                      }}
                    >
                      Rotate secret
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void remove(hook);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  {logOpen === hook.id && (
                    <WebhookDeliveries webhookId={hook.id} name={hook.name} reloadToken={reload} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {loadError && !hooks && (
          <p className="feedback error" role="alert">
            {errorMessage(loadError)}
          </p>
        )}
      </Panel>
      {dialog && (
        <WebhookDialog
          {...(dialog.existing && { existing: dialog.existing })}
          onClose={() => {
            setDialog(undefined);
          }}
          onSaved={saved}
        />
      )}
      {testing && (
        <TestEventDialog
          webhook={testing}
          onClose={() => {
            setTesting(undefined);
          }}
          onSent={() => {
            showLog(testing.id);
            setTesting(undefined);
            done('Test event queued. It shows in the deliveries below.');
          }}
        />
      )}
      {secret && (
        <WebhookSecretDialog
          name={secret.name}
          secret={secret.secret}
          onClose={() => {
            setSecret(undefined);
          }}
        />
      )}
    </>
  );
}
