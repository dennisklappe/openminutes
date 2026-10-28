import { useEffect, useState, type SubmitEvent } from 'react';
import type { ApiKeyCreatedDto, ApiKeyDto, ApiKeyScope } from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { EXPIRY_CHOICES, expiryText, lastUsedText, scopeLabel } from '../apiKeys.js';
import { useConfirm } from '../Confirm.js';
import { Dialog } from '../Dialog.js';
import { formatDate } from '../format.js';
import { Panel } from '../Panel.js';
import '../participants/participants.css';

const NAME_MAX = 80;

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: ApiKeyCreatedDto) => void;
}) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ApiKeyScope>('read');
  const [expiry, setExpiry] = useState('never');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const expiresInDays = EXPIRY_CHOICES.find((choice) => choice.value === expiry)?.days ?? null;
    api
      .createApiKey({ name: name.trim(), scope, expiresInDays })
      .then(onCreated, (failure: unknown) => {
        setBusy(false);
        setError(errorMessage(failure));
      });
  };

  return (
    <Dialog title="Create an API key" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            maxLength={NAME_MAX}
            autoFocus
            autoComplete="off"
            placeholder="For example Zapier"
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>Access</span>
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as ApiKeyScope);
            }}
          >
            <option value="read">Read only: can look at meetings, people and settings</option>
            <option value="full">Full: can also change and delete them</option>
          </select>
          <small>
            Neither can create keys, change the password or connect accounts. Those stay in this
            app.
          </small>
        </label>
        <label className="field">
          <span>Expires</span>
          <select
            value={expiry}
            onChange={(e) => {
              setExpiry(e.target.value);
            }}
          >
            {EXPIRY_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
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
          <button className="primary" type="submit" disabled={!name.trim() || busy}>
            Create key
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function SecretDialog({ created, onClose }: { created: ApiKeyCreatedDto; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(created.secret).then(
      () => {
        setCopied(true);
      },
      () => {
        setFailed(true);
      },
    );
  };
  return (
    <Dialog title="Copy your key now" onClose={onClose}>
      <p className="warning" role="alert">
        This is the only time the key is shown. OpenMinutes keeps just a fingerprint, so a lost key
        cannot be recovered: create a new one instead.
      </p>
      <label className="field">
        <span>{created.key.name}</span>
        <input
          className="api-secret"
          readOnly
          value={created.secret}
          autoComplete="off"
          onFocus={(e) => {
            e.currentTarget.select();
          }}
        />
      </label>
      {failed && <p className="muted">Copying failed. Select the key above and copy it by hand.</p>}
      <div className="confirm-actions">
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy key'}
        </button>
        <button className="primary" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}

export function ApiKeysSettings() {
  const confirm = useConfirm();
  const [keys, setKeys] = useState<ApiKeyDto[]>();
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ApiKeyCreatedDto>();

  const load = () =>
    api.apiKeys().then(setKeys, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  useEffect(() => {
    void load();
  }, []);

  const revoke = async (key: ApiKeyDto) => {
    const confirmed = await confirm({
      title: `Revoke ${key.name}?`,
      body: (
        <p>
          Anything using this key stops working at once. This cannot be undone, but you can always
          create a new key.
        </p>
      ),
      confirmLabel: 'Revoke',
      destructive: true,
    });
    if (!confirmed) return;
    setError(undefined);
    api.revokeApiKey(key.id).then(load, (failure: unknown) => {
      setError(errorMessage(failure));
    });
  };

  return (
    <>
      <Panel
        title="API keys"
        description={
          <>
            Send a key as <code>Authorization: Bearer omk_...</code>. The API follows this app, see
            the API guide in the docs.
          </>
        }
        foot={
          <button
            className="primary"
            type="button"
            onClick={() => {
              setCreating(true);
            }}
          >
            Create key
          </button>
        }
      >
        {keys?.length === 0 && <p className="muted">No keys yet.</p>}
        {keys && keys.length > 0 && (
          <ul className="participant-list api-keys">
            {keys.map((key) => (
              <li key={key.id}>
                <div className="people-name">
                  <strong className="truncate">{key.name}</strong>
                  <button
                    type="button"
                    onClick={() => {
                      void revoke(key);
                    }}
                  >
                    Revoke
                  </button>
                </div>
                <span className="muted people-meta">
                  <code>{key.prefix}...</code> · {scopeLabel(key.scope)} · Created{' '}
                  {formatDate(key.createdAt)}
                </span>
                <span className="muted people-meta">
                  {lastUsedText(key)} · {expiryText(key)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
      </Panel>
      {creating && (
        <CreateDialog
          onClose={() => {
            setCreating(false);
          }}
          onCreated={(result) => {
            setCreating(false);
            setCreated(result);
            void load();
          }}
        />
      )}
      {created && (
        <SecretDialog
          created={created}
          onClose={() => {
            setCreated(undefined);
          }}
        />
      )}
    </>
  );
}
