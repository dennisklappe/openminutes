import { Fragment, useCallback, useState } from 'react';
import type {
  CalendarAccountDto,
  CalendarProviderId,
  JoinRule,
  ProviderSettingsDto,
} from '../../src/dto.js';
import { api, errorMessage } from '../api.js';
import { useConfirm } from '../Confirm.js';
import { formatDate, joinRuleLabels } from '../format.js';
import { Panel } from '../Panel.js';
import { SettingsCard } from '../SettingsCard.js';
import { useSettingsForm } from '../useSettingsForm.js';
import { usePolling } from '../usePolling.js';

const providers: { id: CalendarProviderId; label: string; guide: string }[] = [
  {
    id: 'google',
    label: 'Google',
    guide: 'https://github.com/dennisklappe/openminutes/blob/main/docs/google-oauth.md',
  },
  {
    id: 'microsoft',
    label: 'Microsoft',
    guide: 'https://github.com/dennisklappe/openminutes/blob/main/docs/azure-app.md',
  },
];

function RouteNotice({ route }: { route: string }) {
  const [dismissed, setDismissed] = useState<string>();
  if (dismissed === route) return null;
  const params = new URLSearchParams(route.split('?')[1]);
  const error = params.get('error');
  const connected = providers.find((p) => p.id === params.get('connected'))?.label;
  if (!error && !connected) return null;
  return (
    <p className={error ? 'banner banner-error' : 'banner'}>
      <span>{error ?? `Connected ${connected}. Pick a join rule for each calendar below.`}</span>
      <button
        className="link"
        onClick={() => {
          setDismissed(route);
        }}
      >
        Dismiss
      </button>
    </p>
  );
}

function RedirectUri({ uri }: { uri: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(uri).then(() => {
      setCopied(true);
    });
  };
  return (
    <div className="field">
      <span>Redirect URI</span>
      <div className="copy">
        <code className="mono">{uri}</code>
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

interface CredentialsDraft {
  clientId: string;
  clientSecret: string;
  tenant: string;
}

const credentialsOf = (settings: ProviderSettingsDto): CredentialsDraft => ({
  clientId: settings.clientId ?? '',
  clientSecret: '',
  tenant: settings.tenant ?? 'common',
});

function ProviderCard({
  id,
  label,
  guide,
  settings,
  hasAccounts,
  onSaved,
}: {
  id: CalendarProviderId;
  label: string;
  guide: string;
  settings: ProviderSettingsDto;
  hasAccounts: boolean;
  onSaved: () => void;
}) {
  const ready = Boolean(settings.clientId && settings.hasClientSecret);
  const form = useSettingsForm(credentialsOf(settings), async (draft) => {
    await api.saveProvider(id, {
      clientId: draft.clientId,
      ...(draft.clientSecret && { clientSecret: draft.clientSecret }),
      ...(id === 'microsoft' && { tenant: draft.tenant }),
    });
    onSaved();
    return { ...draft, clientSecret: '' };
  });
  const { clientId, clientSecret, tenant } = form.draft;

  return (
    <SettingsCard
      form={form}
      title={label}
      description={
        <>
          Register this redirect URI in your own {label} app.{' '}
          <a href={guide} target="_blank" rel="noreferrer">
            Step by step guide
          </a>
        </>
      }
      actions={
        ready && !form.dirty ? (
          <a className="button" href={`/api/oauth/${id}/start`}>
            {hasAccounts ? `Connect another ${label} account` : `Connect ${label}`}
          </a>
        ) : (
          <>
            <button type="button" disabled>
              Connect {label}
            </button>
            <span className="hint">Save the credentials first.</span>
          </>
        )
      }
    >
      <RedirectUri uri={settings.redirectUri} />
      <div className="field-row">
        <label className="field">
          <span>Client ID</span>
          <input
            required
            value={clientId}
            onChange={(e) => {
              form.patch({ clientId: e.target.value });
            }}
          />
        </label>
        <label className="field">
          <span>Client secret</span>
          <input
            type="password"
            autoComplete="off"
            required={!settings.hasClientSecret}
            placeholder={settings.hasClientSecret ? 'Saved, leave blank to keep' : ''}
            value={clientSecret}
            onChange={(e) => {
              form.patch({ clientSecret: e.target.value });
            }}
          />
        </label>
        {id === 'microsoft' && (
          <label className="field">
            <span>Tenant</span>
            <input
              required
              value={tenant}
              onChange={(e) => {
                form.patch({ tenant: e.target.value });
              }}
            />
          </label>
        )}
      </div>
    </SettingsCard>
  );
}

function AccountCard({
  account,
  onChanged,
}: {
  account: CalendarAccountDto;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const form = useSettingsForm(
    Object.fromEntries(account.calendars.map((c) => [c.id, c.joinRule])) as Record<
      string,
      JoinRule
    >,
    async (draft) => {
      const changed = account.calendars.filter((c) => draft[c.id] !== c.joinRule);
      await Promise.all(changed.map((c) => api.setJoinRule(c.id, draft[c.id] ?? c.joinRule)));
      onChanged();
      return draft;
    },
  );
  const run = (action: () => Promise<unknown>) => {
    form.setNotice(undefined);
    action().then(onChanged, (failure: unknown) => {
      form.setNotice({ ok: false, text: errorMessage(failure) });
    });
  };
  const disconnect = async () => {
    const confirmed = await confirm({
      title: `Disconnect ${account.email}?`,
      body: <p>Meetings queued from this account are cancelled.</p>,
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (confirmed) run(() => api.disconnect(account.id));
  };

  return (
    <SettingsCard
      form={form}
      title={account.email}
      description={
        account.lastSyncedAt ? `Synced ${formatDate(account.lastSyncedAt)}` : 'Not synced yet'
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              run(() => api.syncAccount(account.id));
            }}
          >
            Sync now
          </button>
          <button type="button" className="danger" onClick={() => void disconnect()}>
            Disconnect
          </button>
        </>
      }
    >
      {account.error && <p className="feedback error">{account.error}</p>}
      <ul className="calendars">
        {account.calendars.map((calendar) => (
          <li key={calendar.id}>
            <span className="title">{calendar.name}</span>
            <select
              aria-label={`Join rule for ${calendar.name}`}
              value={form.draft[calendar.id] ?? calendar.joinRule}
              onChange={(e) => {
                form.patch({ [calendar.id]: e.target.value as JoinRule });
              }}
            >
              {(Object.keys(joinRuleLabels) as JoinRule[]).map((rule) => (
                <option key={rule} value={rule}>
                  {joinRuleLabels[rule]}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}

function SkippedSeries() {
  const load = useCallback(() => api.skippedSeries(), []);
  const { data, refresh } = usePolling(load, 10_000);
  const [error, setError] = useState<string>();
  if (!data || data.length === 0) return null;
  return (
    <Panel
      title="Recurring meetings the bot skips"
      description="You chose not to join these series, for example a weekly meeting that happens in person. New occurrences from your calendar are skipped automatically."
      notice={error ? { ok: false, text: error } : undefined}
    >
      <ul className="accounts">
        {data.map((series) => (
          <li key={series.id} className="account">
            <div className="account-head">
              <div>
                <strong>{series.title}</strong>
                <p className="muted">Skipped since {formatDate(series.since)}</p>
              </div>
              <button
                onClick={() => {
                  api.rejoinSeries(series.id).then(refresh, (failure: unknown) => {
                    setError(errorMessage(failure));
                  });
                }}
              >
                Join this series again
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function CalendarSection({ route }: { route: string }) {
  const load = useCallback(() => api.accounts(), []);
  const { data, error, refresh } = usePolling(load, 10_000);

  if (error && !data) return <p className="error">{error.message}</p>;
  if (!data) return null;

  return (
    <>
      <RouteNotice route={route} />
      {providers.map(({ id, label, guide }) => {
        const accounts = data.accounts.filter((a) => a.provider === id);
        return (
          <Fragment key={id}>
            <ProviderCard
              id={id}
              label={label}
              guide={guide}
              settings={data.providers[id]}
              hasAccounts={accounts.length > 0}
              onSaved={refresh}
            />
            {accounts.map((account) => (
              <AccountCard key={account.id} account={account} onChanged={refresh} />
            ))}
          </Fragment>
        );
      })}
      <SkippedSeries />
    </>
  );
}
