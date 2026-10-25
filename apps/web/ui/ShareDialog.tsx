import { useEffect, useRef, useState } from 'react';
import type {
  MinutesParts,
  ShareEmailInput,
  ShareEmailOptionsDto,
  ShareEmailPreviewDto,
  ShareEmailResultDto,
} from '../src/dto.js';
import { api, errorMessage } from './api.js';
import { partsLabel } from './parts.js';

const parseAddresses = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

const peopleCount = (count: number) => `${String(count)} ${count === 1 ? 'person' : 'people'}`;

function Result({ result }: { result: ShareEmailResultDto }) {
  return (
    <div className="share-result">
      {result.sent.length > 0 && <p className="ok">Sent to {peopleCount(result.sent.length)}.</p>}
      {result.skipped.length > 0 && (
        <p className="muted">
          Skipped {result.skipped.join(', ')}: they already received this. Tick Send again to
          resend.
        </p>
      )}
      {result.failed.map((failure) => (
        <p key={failure.email} className="error">
          {failure.email}: {failure.error}
        </p>
      ))}
      {result.warnings.map((warning) => (
        <p key={warning} className="muted">
          {warning}
        </p>
      ))}
    </div>
  );
}

export function ShareDialog(props: {
  meetingId: string;
  /** What the card's Include choice puts in whatever is shared. */
  parts: MinutesParts;
  onClose: () => void;
}) {
  const { meetingId, parts, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<ShareEmailOptionsDto>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState('');
  const [format, setFormat] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [force, setForce] = useState(false);
  const [preview, setPreview] = useState<ShareEmailPreviewDto>();
  const [result, setResult] = useState<ShareEmailResultDto>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sharedUrl, setSharedUrl] = useState<string>();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    void api.shareEmailOptions(meetingId).then(
      (loaded) => {
        setOptions(loaded);
        setSubject(loaded.subject);
        setBody(loaded.body);
        setFormat(loaded.formats[0]?.id ?? '');
        setPicked(
          new Set(loaded.recipients.filter((r) => !r.declined && !r.sentAt).map((r) => r.email)),
        );
      },
      (failure: unknown) => {
        setError(errorMessage(failure));
      },
    );
  }, [meetingId]);

  if (!options) {
    return (
      <dialog ref={dialog} className="share-dialog" onClose={onClose}>
        <p className={error ? 'error' : 'muted'}>{error ?? 'Loading'}</p>
      </dialog>
    );
  }

  const input = (): ShareEmailInput => ({
    recipients: [...picked],
    extra: parseAddresses(extra),
    format,
    subject,
    body,
    force,
    ...parts,
  });

  const run = (action: () => Promise<void>) => {
    setError(undefined);
    setBusy(true);
    action()
      .catch((failure: unknown) => {
        setError(errorMessage(failure));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const willEmail = (() => {
    const sent = new Set(options.recipients.filter((r) => r.sentAt).map((r) => r.email));
    const people = new Set([...picked, ...parseAddresses(extra)]);
    return [...people].filter((email) => force || !sent.has(email)).length;
  })();
  const chosen = options.formats.find((option) => option.id === format);

  const showPreview = () => {
    run(async () => {
      setPreview(await api.previewShareEmail(meetingId, input()));
    });
  };

  const share = () => {
    run(async () => {
      setResult(await api.sendShareEmail(meetingId, input()));
      const refreshed = await api.shareEmailOptions(meetingId);
      setSharedUrl(refreshed.formats.find((option) => option.id === format)?.url ?? undefined);
    });
  };

  const toggle = (email: string) => {
    setPreview(undefined);
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(email)) next.add(email);
      return next;
    });
  };
  const allPicked = options.recipients.length > 0 && picked.size === options.recipients.length;
  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setPreview(undefined);
      set(value);
    };

  return (
    <dialog ref={dialog} className="share-dialog" onClose={onClose} aria-labelledby="share-title">
      <header>
        <h2 id="share-title">Share with attendees</h2>
        <button type="button" className="link" onClick={onClose}>
          Close
        </button>
      </header>

      {!options.configured ? (
        <p>
          Email is not set up yet. Pick a provider and a from address in{' '}
          <a href="#/settings/email">Settings, Email</a>.
        </p>
      ) : options.formats.length === 0 ? (
        <p>
          Nothing to share yet. Turn on a destination in{' '}
          <a href="#/settings/minutes">Settings, Minutes</a>.
        </p>
      ) : result ? (
        <>
          <Result result={result} />
          {sharedUrl && (
            <p>
              <a href={sharedUrl} target="_blank" rel="noreferrer">
                Open what was shared
              </a>
            </p>
          )}
          <div className="actions">
            <button type="button" className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <div className="share-form">
          <fieldset>
            <legend>Who</legend>
            {options.recipients.length === 0 && (
              <p className="muted">
                No attendee email addresses are known for this meeting. Add addresses below.
              </p>
            )}
            {options.recipients.length > 1 && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={allPicked}
                  onChange={() => {
                    setPreview(undefined);
                    setPicked(
                      allPicked ? new Set() : new Set(options.recipients.map((r) => r.email)),
                    );
                  }}
                />
                Select all
              </label>
            )}
            {options.recipients.map((person) => (
              <label className="check" key={person.email}>
                <input
                  type="checkbox"
                  checked={picked.has(person.email)}
                  onChange={() => {
                    toggle(person.email);
                  }}
                />
                <span>
                  {person.name} <span className="muted">{person.email}</span>
                  {person.declined && <span className="muted"> declined</span>}
                  {person.sentAt && <span className="muted"> already sent</span>}
                </span>
              </label>
            ))}
            <label className="field">
              <span>Other addresses</span>
              <input
                type="text"
                placeholder="name@example.com, other@example.com"
                value={extra}
                onChange={(e) => {
                  edited(setExtra)(e.target.value);
                }}
              />
            </label>
          </fieldset>

          <fieldset>
            <legend>What</legend>
            <label className="field">
              <span>Share as</span>
              <select
                value={format}
                onChange={(e) => {
                  edited(setFormat)(e.target.value);
                }}
              >
                {options.formats.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label} ({option.url ? 'will be updated' : 'will be created'})
                  </option>
                ))}
              </select>
              <small>
                {partsLabel(parts)}.{' '}
                {chosen?.url
                  ? 'The latest version of the minutes is used.'
                  : 'It is created when you press Share.'}{' '}
                Change this under Include on the Minutes card.
              </small>
            </label>
          </fieldset>

          <fieldset>
            <legend>Message</legend>
            <label className="field">
              <span>Subject</span>
              <input
                type="text"
                value={subject}
                onChange={(e) => {
                  edited(setSubject)(e.target.value);
                }}
              />
            </label>
            <label className="field">
              <span>Body</span>
              <textarea
                rows={6}
                value={body}
                onChange={(e) => {
                  edited(setBody)(e.target.value);
                }}
              />
              <small>
                Placeholders: {options.placeholders.map((name) => `{{${name}}}`).join(' ')}. Sent
                from {options.fromAddress}, one separate mail per person.
              </small>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => {
                  edited(setForce)(e.target.checked);
                }}
              />
              Send again to people who already received it
            </label>
          </fieldset>

          {preview && (
            <section className="share-preview" aria-label="Preview">
              <p>
                <strong>{preview.subject}</strong>
              </p>
              <iframe title="Email preview" sandbox="" srcDoc={preview.html} />
              {preview.alreadySent.length > 0 && (
                <p className="muted">Skipped, already sent: {preview.alreadySent.join(', ')}</p>
              )}
            </section>
          )}

          {error && <p className="error">{error}</p>}
          <p className="share-confirm" role="status">
            {willEmail > 0
              ? `Will email ${peopleCount(willEmail)}`
              : 'Pick at least one person who has not received this yet.'}
          </p>
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={busy || willEmail === 0}
              onClick={share}
            >
              {willEmail > 0 ? `Share with ${peopleCount(willEmail)}` : 'Share'}
            </button>
            <button type="button" disabled={busy || willEmail === 0} onClick={showPreview}>
              Preview email
            </button>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
