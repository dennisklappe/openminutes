import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../api.js';
import { formatDate } from '../format.js';
import { usePolling } from '../usePolling.js';
import {
  attemptsText,
  canReplay,
  DELIVERY_FILTERS,
  DELIVERY_LABELS,
  DELIVERY_PILL,
  eventLabel,
  kindLabel,
  payloadText,
  resultText,
} from '../webhooks.js';
import type { DeliveryDto, DeliveryStatus } from '../../src/dto.js';

function DeliveryRow({
  delivery,
  onReplay,
  busy,
}: {
  delivery: DeliveryDto;
  onReplay: (delivery: DeliveryDto) => void;
  busy: boolean;
}) {
  const kind = kindLabel(delivery.kind);
  return (
    <li className="webhook-delivery">
      <div className="webhook-delivery-head">
        <span className={`pill ${DELIVERY_PILL[delivery.status]}`}>
          <i aria-hidden="true" />
          {DELIVERY_LABELS[delivery.status]}
        </span>
        <strong>{eventLabel(delivery.event)}</strong>
        {kind && <span className="muted">{kind}</span>}
        <time className="muted webhook-delivery-time" dateTime={delivery.createdAt}>
          {formatDate(delivery.createdAt)}
        </time>
      </div>
      <p className="muted people-meta">
        {resultText(delivery)} · Attempt {attemptsText(delivery)}
        {delivery.status === 'failed' && delivery.nextAttemptAt
          ? ` · Next try ${formatDate(delivery.nextAttemptAt)}`
          : ''}
      </p>
      {delivery.lastError && (
        <p className="error people-meta webhook-error">{delivery.lastError}</p>
      )}
      <div className="webhook-delivery-actions">
        <details className="webhook-payload">
          <summary>Payload</summary>
          <pre tabIndex={0}>{payloadText(delivery.payload)}</pre>
        </details>
        {canReplay(delivery) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onReplay(delivery);
            }}
          >
            Replay
          </button>
        )}
      </div>
    </li>
  );
}

/** The delivery log of one webhook. It reloads every few seconds while it is on screen. */
export function WebhookDeliveries({
  webhookId,
  name,
  reloadToken,
}: {
  webhookId: string;
  name: string;
  /** Change this to reload at once, for example after a test was queued. */
  reloadToken: number;
}) {
  const [status, setStatus] = useState<'' | DeliveryStatus>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(() => api.webhookDeliveries(webhookId, status), [webhookId, status]);
  const { data, error: loadError, refresh } = usePolling(load, 3000);

  useEffect(() => {
    refresh();
  }, [reloadToken, refresh]);

  const replay = (delivery: DeliveryDto) => {
    setBusy(true);
    setError(undefined);
    api
      .replayWebhookDelivery(webhookId, delivery.id)
      .then(refresh, (failure: unknown) => {
        setError(errorMessage(failure));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const shownError = error ?? (loadError ? errorMessage(loadError) : undefined);

  return (
    <div className="webhook-log" role="region" aria-label={`Deliveries of ${name}`}>
      <div className="webhook-log-head">
        <h4>Deliveries</h4>
        <label className="webhook-log-filter">
          <span className="sr-only">Show</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | DeliveryStatus);
            }}
          >
            {DELIVERY_FILTERS.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {data?.length === 0 && (
        <p className="muted">
          {status
            ? 'No deliveries with this status.'
            : 'Nothing sent yet. Send a test ping to try it.'}
        </p>
      )}
      {data && data.length > 0 && (
        <ul className="webhook-deliveries">
          {data.map((delivery) => (
            <DeliveryRow key={delivery.id} delivery={delivery} onReplay={replay} busy={busy} />
          ))}
        </ul>
      )}
      {shownError && (
        <p className="feedback error" role="alert">
          {shownError}
        </p>
      )}
      <p className="muted people-meta">Kept for 30 days. This list updates by itself.</p>
    </div>
  );
}
